package dominikmech.projecttiles.services

import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.ProjectMetadata
import dominikmech.projecttiles.storage.MetadataCacheStore
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

class MetadataOptions(
    /** Git info older than this is refreshed when the dashboard opens. */
    val gitTtlMs: () -> Long,
    /** Language scans are expensive; they are reused for this long. */
    val languagesTtlMs: () -> Long,
    val quickConcurrency: Int = 8,
    /** `git fetch` calls wait on the network, not the CPU. */
    val fetchConcurrency: Int = 8,
    val scanConcurrency: Int = 2,
)

/**
 * @param force ignore TTLs
 * @param network allow `git fetch`; only opening the dashboard and the manual refresh pass this
 * @param gitOnly redo just the local git part (a repository changed on disk)
 */
data class RefreshOptions(val force: Boolean = false, val network: Boolean = false, val gitOnly: Boolean = false)

typealias MetadataListener = (Project, ProjectMetadata) -> Unit

/** How long after our own `git fetch` repository watchers should ignore `.git` activity. */
private const val SELF_CHANGE_GRACE_MS = 5000L

/**
 * Gathers per-project metadata in two phases so tiles fill up immediately:
 * 1. quick – existence, local git state, manual languages, auto logo;
 * 2. slow – `git fetch` + recount for all repositories at once, and the language scans alongside.
 * Results are cached in memory and on disk and streamed to the listener as each phase completes.
 */
class MetadataService(
    private val git: GitInfoProvider,
    private val languages: () -> LanguageDetector,
    private val logos: LogoStore,
    private val store: MetadataCacheStore?,
    private val options: MetadataOptions,
) {
    private val cache = ConcurrentHashMap<String, ProjectMetadata>()
    private val inFlight = ConcurrentHashMap.newKeySet<String>()
    private val fetching = ConcurrentHashMap.newKeySet<String>()
    private val quietUntil = ConcurrentHashMap<String, Long>()
    private val loaded = lazy { store?.load()?.forEach { (k, v) -> cache.putIfAbsent(k, v) } }

    fun ensureLoaded() {
        loaded.value
    }

    fun cached(project: Project): ProjectMetadata? = cache[project.path]

    fun invalidate(projectPath: String? = null) {
        if (projectPath == null) cache.clear() else cache.remove(projectPath)
        persist()
    }

    /** Marks git info stale without dropping what is displayed (used when a repo changes on disk). */
    fun markGitStale(projectPath: String) {
        cache.computeIfPresent(projectPath) { _, meta -> meta.copy(fetchedAt = 0) }
    }

    /** True while our own `git fetch` is touching the repository (or just did), so watchers can ignore the echo. */
    fun isSelfChange(projectPath: String): Boolean =
        projectPath in fetching || (quietUntil[projectPath] ?: 0) > System.currentTimeMillis()

    private class Task(val project: Project, var git: Boolean, var languages: Boolean, val manual: Boolean, var logo: Boolean, val network: Boolean)

    suspend fun refresh(projects: List<Project>, onResult: MetadataListener, opts: RefreshOptions = RefreshOptions()) = withContext(Dispatchers.IO) {
        ensureLoaded()
        val now = System.currentTimeMillis()
        val gitTtl = options.gitTtlMs()
        val langTtl = options.languagesTtlMs()
        val plan = projects.filter { it.path !in inFlight }.map { p ->
            val cached = cache[p.path]
            val git = opts.force || cached == null || now - cached.fetchedAt > gitTtl
            val languages = !opts.gitOnly && (opts.force || cached == null || now - cached.languagesAt > langTtl)
            // Looked for again together with the git part, not on every open.
            val logo = p.logo?.kind == Logo.AUTO && (git || (cached?.autoLogoPath != null && !logos.contains(cached.autoLogoPath)))
            Task(p, git, languages, !p.languages.isNullOrEmpty(), logo, opts.network)
        }.filter { it.git || it.languages || it.logo }
        if (plan.isEmpty()) return@withContext
        plan.forEach { inFlight.add(it.project.path) }
        try {
            pool(plan, options.quickConcurrency) { quickPhase(it, onResult) }
            coroutineScope {
                val fetches = async { pool(plan.filter { it.git }, options.fetchConcurrency) { fetchPhase(it, onResult) } }
                val scans = async { pool(plan.filter { it.languages }, options.scanConcurrency) { scanPhase(it, onResult) } }
                awaitAll(fetches, scans)
            }
        } finally {
            plan.forEach { inFlight.remove(it.project.path) }
            persist()
        }
    }

    private fun quickPhase(t: Task, onResult: MetadataListener) {
        val project = t.project
        val folder = Path.of(project.path)
        val previous = cache[project.path]
        var meta = previous ?: ProjectMetadata(exists = true, git = null, languages = emptyList())
        if (!isProjectPath(folder)) {
            meta = meta.copy(exists = false, git = null, languages = emptyList())
            cache[project.path] = meta
            onResult(project, meta)
            t.git = false
            t.languages = false
            t.logo = false
            return
        }
        meta = meta.copy(exists = true)
        if (t.git) {
            var git = runCatching { git.quickInfo(folder) }.getOrNull()
            val sync = git?.sync
            if (t.network && sync != null && this.git.fetchEnabled()) {
                git = git!!.copy(sync = sync.copy(checking = true))
            } else {
                // Offline recount: keep "fetched" from the previous run when it was against the same upstream.
                val before = previous?.git?.sync
                if (sync != null && before != null && before.upstream == sync.upstream) {
                    git = git!!.copy(sync = sync.copy(fetched = before.fetched))
                }
                t.git = false // nothing left to do in the slow phase
            }
            meta = meta.copy(git = git, fetchedAt = System.currentTimeMillis())
        }
        if (t.manual) {
            meta = meta.copy(languages = LanguageDetector.sharesFromNames(project.languages.orEmpty()), languagesAt = System.currentTimeMillis())
            t.languages = false
        }
        val autoLogo = if (t.logo) runCatching { logos.discover(project.id, folder) }.getOrNull()?.toString() else meta.autoLogoPath
        meta = when {
            autoLogo != null -> meta.copy(autoLogoPath = autoLogo)
            project.logo?.kind != Logo.AUTO -> meta.copy(autoLogoPath = null)
            else -> meta
        }
        cache[project.path] = meta
        onResult(project, meta)
    }

    private fun fetchPhase(t: Task, onResult: MetadataListener) {
        val project = t.project
        fetching.add(project.path)
        val sync = try {
            runCatching { git.fetchAndCount(Path.of(project.path)) }.getOrNull()
        } finally {
            fetching.remove(project.path)
            quietUntil[project.path] = System.currentTimeMillis() + SELF_CHANGE_GRACE_MS
        }
        val current = cache[project.path] ?: return // invalidated meanwhile
        val git = current.git ?: return
        val meta = current.copy(git = git.copy(sync = sync ?: git.sync?.copy(checking = null)))
        cache[project.path] = meta
        onResult(project, meta)
    }

    private fun scanPhase(t: Task, onResult: MetadataListener) {
        val project = t.project
        val shares = runCatching { languages().detect(Path.of(project.path)) }.getOrNull() ?: return
        val current = cache[project.path] ?: return
        val meta = current.copy(languages = shares, languagesAt = System.currentTimeMillis())
        cache[project.path] = meta
        onResult(project, meta)
    }

    private fun persist() {
        store?.scheduleSave(cache)
    }

    private suspend fun <T> pool(items: List<T>, limit: Int, work: (T) -> Unit) = coroutineScope {
        val semaphore = Semaphore(limit.coerceAtLeast(1))
        items.map { item -> async(Dispatchers.IO) { semaphore.withPermit { work(item) } } }.awaitAll()
    }

    private fun isProjectPath(p: Path): Boolean = Files.isDirectory(p) || (p.toString().lowercase().endsWith(".code-workspace") && Files.isRegularFile(p))
}
