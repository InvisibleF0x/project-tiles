package dominikmech.projecttiles.storage

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dominikmech.projecttiles.domain.ProjectMetadata
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Lets tiles render instantly from the last known state while a background refresh runs. Derived
 * data, so it is per IDE rather than shared. Writes are debounced and atomic; a corrupt file means an empty cache.
 */
class MetadataCacheStore(private val location: Path, private val debounceMs: Long = 1000) {
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "Project Tiles cache writer").apply { isDaemon = true } }
    private var pending: Map<String, ProjectMetadata>? = null
    private var timer: ScheduledFuture<*>? = null

    fun load(): MutableMap<String, ProjectMetadata> {
        val result = mutableMapOf<String, ProjectMetadata>()
        val entries = runCatching {
            JsonParser.parseString(Files.readString(location)).asJsonObject.getAsJsonObject("entries")
        }.getOrNull() ?: return result
        for ((key, value) in entries.entrySet()) {
            val meta = runCatching { compactGson.fromJson(value, ProjectMetadata::class.java) }.getOrNull() ?: continue
            // Gson bypasses constructors: repair anything a hand edit or an older version left out.
            @Suppress("SENSELESS_COMPARISON", "USELESS_ELVIS")
            result[key] = meta.copy(languages = meta.languages ?: emptyList())
        }
        return result
    }

    @Synchronized
    fun scheduleSave(entries: Map<String, ProjectMetadata>) {
        pending = HashMap(entries)
        timer?.cancel(false)
        timer = scheduler.schedule({ flush() }, debounceMs, TimeUnit.MILLISECONDS)
    }

    fun flush() {
        val entries = synchronized(this) { pending.also { pending = null } } ?: return
        val file = JsonObject().apply {
            addProperty("version", 1)
            add("entries", JsonObject().also { obj ->
                for ((key, meta) in entries) {
                    // `checking` is a transient UI flag; never persist it.
                    val clean = meta.git?.sync?.let { meta.copy(git = meta.git.copy(sync = it.copy(checking = null))) } ?: meta
                    obj.add(key, compactGson.toJsonTree(clean))
                }
            })
        }
        runCatching {
            Files.createDirectories(location.parent)
            val tmp = location.resolveSibling("${location.fileName}.${ProcessHandle.current().pid()}.tmp")
            Files.writeString(tmp, compactGson.toJson(file))
            Files.move(tmp, location, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
    }
}
