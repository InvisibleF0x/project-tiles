package dominikmech.projecttiles.services

import java.io.IOException
import java.nio.file.ClosedWatchServiceException
import java.nio.file.FileSystems
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds.ENTRY_CREATE
import java.nio.file.StandardWatchEventKinds.ENTRY_DELETE
import java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY
import java.nio.file.WatchKey
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Watches a set of directories (non-recursively) on one daemon thread and reports, debounced per
 * directory, that something inside changed. Used for the shared projects.json folder and for each
 * repository's `.git` directory while a dashboard is open. [accept] filters by file name.
 */
class DirectoryWatcher(
    private val debounceMs: Long,
    private val accept: (dir: Path, fileName: String) -> Boolean = { _, _ -> true },
    private val onChange: (dir: Path) -> Unit,
) : AutoCloseable {
    private val service = FileSystems.getDefault().newWatchService()
    private val keys = ConcurrentHashMap<Path, WatchKey>()
    private val timers = ConcurrentHashMap<Path, ScheduledFuture<*>>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "Project Tiles watcher debounce").apply { isDaemon = true } }
    @Volatile
    private var closed = false

    init {
        Thread({ loop() }, "Project Tiles directory watcher").apply { isDaemon = true }.start()
    }

    /** Makes the watched set equal to [dirs]; directories that do not exist are skipped. */
    fun sync(dirs: Collection<Path>) {
        val wanted = dirs.toSet()
        for ((dir, key) in keys) {
            if (dir !in wanted) {
                key.cancel()
                keys.remove(dir)
            }
        }
        for (dir in wanted) {
            if (closed || keys.containsKey(dir)) continue
            try {
                keys[dir] = dir.register(service, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)
            } catch (_: IOException) {
                // missing or unreadable: nothing to watch
            }
        }
    }

    private fun loop() {
        while (!closed) {
            val key = try {
                service.take()
            } catch (_: InterruptedException) {
                return
            } catch (_: ClosedWatchServiceException) {
                return
            }
            val dir = key.watchable() as Path
            val relevant = key.pollEvents().any { event -> (event.context() as? Path)?.let { accept(dir, it.toString()) } ?: true }
            if (!key.reset()) keys.remove(dir)
            if (relevant) schedule(dir)
        }
    }

    private fun schedule(dir: Path) {
        timers.remove(dir)?.cancel(false)
        timers[dir] = scheduler.schedule({
            timers.remove(dir)
            if (!closed) onChange(dir)
        }, debounceMs, TimeUnit.MILLISECONDS)
    }

    override fun close() {
        closed = true
        runCatching { service.close() }
        scheduler.shutdownNow()
    }
}
