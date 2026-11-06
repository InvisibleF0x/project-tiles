package dominikmech.projecttiles.services

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import dominikmech.projecttiles.domain.CatalogData
import dominikmech.projecttiles.domain.Collection
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.ProjectCatalog
import dominikmech.projecttiles.domain.ProjectInput
import dominikmech.projecttiles.domain.ProjectMetadata
import dominikmech.projecttiles.domain.isShown
import dominikmech.projecttiles.settings.ProjectTilesSettings
import dominikmech.projecttiles.storage.CatalogRepository
import dominikmech.projecttiles.storage.MetadataCacheStore
import dominikmech.projecttiles.storage.sharedCatalogFile
import dominikmech.projecttiles.storage.sharedDataDirectory
import dominikmech.projecttiles.storage.sharedLogoDirectory
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope

/**
 * The single place that mutates the catalog, persists it and keeps the logo store consistent.
 * Nothing runs until a dashboard asks: the catalog is read lazily.
 */
@Service(Service.Level.APP)
class ProjectService(val scope: CoroutineScope) {
    private val dataDir: Path = sharedDataDirectory()
    private val repository = CatalogRepository(sharedCatalogFile(dataDir))
    val logos = LogoStore(sharedLogoDirectory(dataDir))
    val metadata: MetadataService = run {
        val settings = ProjectTilesSettings.getInstance()
        MetadataService(
            GitInfoProvider(fetchRemote = { settings.fetchRemote }),
            { LanguageDetector(settings.ignoreDirs, settings.maxFilesScanned) },
            logos,
            MetadataCacheStore(Path.of(PathManager.getSystemPath(), "project-tiles", "metadata-cache.json")),
            MetadataOptions(
                gitTtlMs = { settings.gitTtlMs },
                languagesTtlMs = { settings.languagesTtlMs },
                gitEnabled = { project -> isShown(project.show?.git, settings.showGit) },
                languagesEnabled = { project -> isShown(project.show?.languages, settings.showLanguages) },
            ),
        )
    }

    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val lock = Any()
    @Volatile
    private var catalog = ProjectCatalog(null, ::newId)
    private val loaded = lazy { catalog = ProjectCatalog(repository.load(), ::newId) }

    val dataFile: Path get() = repository.location

    /** Blocking (reads a small file once); call off the EDT. */
    fun ensureLoaded() {
        loaded.value
    }

    /** Fires after every persisted change and after another editor changed the file. */
    fun onDidChange(listener: () -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }

    /** Follows the shared data file so changes made in VS Code (or by hand) show up here. Returns a disposer. */
    fun watchExternalChanges(): () -> Unit {
        val fileName = repository.location.fileName.toString()
        val watcher = DirectoryWatcher(300, accept = { _, name -> name == fileName }) { reloadIfChangedExternally() }
        java.nio.file.Files.createDirectories(dataDir)
        watcher.sync(listOf(dataDir))
        return { watcher.close() }
    }

    /** Picks up changes another editor made while nothing here was watching. */
    fun syncFromDisk() {
        ensureLoaded()
        reloadIfChangedExternally()
    }

    private fun reloadIfChangedExternally() {
        if (!loaded.isInitialized()) return
        try {
            val data = repository.loadIfChangedExternally() ?: return
            synchronized(lock) { catalog = ProjectCatalog(data, ::newId) }
            fire()
        } catch (_: Exception) {
            // half-written or invalid file: keep the current state, the next change will retry
        }
    }

    val projects: List<Project> get() = catalog.projects.toList()
    val collections: List<Collection> get() = catalog.collections.toList()

    fun getProject(id: String): Project? = catalog.getProject(id)

    fun findByPath(folder: String): Project? = catalog.findProjectByPath(folder)

    fun newId(): String = UUID.randomUUID().toString()

    /** Creates (when [id] is unknown) or updates a project, importing a picked logo image if needed. */
    fun saveProject(id: String, input: ProjectInput): Project {
        val saved = synchronized(lock) {
            val cleaned = input.copy(logo = materializeLogo(id, input.logo))
            val existing = catalog.getProject(id)
            val saved = if (existing != null) catalog.updateProject(id, cleaned)!! else catalog.addProjectWithId(id, cleaned)
            val computedChanged = existing?.show?.git != saved.show?.git || existing?.show?.languages != saved.show?.languages
            if (existing == null || existing.path != saved.path || existing.languages != saved.languages || existing.logo?.kind != saved.logo?.kind || computedChanged) {
                metadata.invalidate(saved.path)
            }
            saved
        }
        persist()
        return saved
    }

    fun removeProject(id: String) = mutate {
        catalog.removeProject(id).also { if (it) logos.remove(id) }
    }

    fun moveProject(id: String, collectionId: String?, index: Int) = mutate { catalog.moveProject(id, collectionId, index) }

    fun saveCollection(id: String?, name: String, color: String?, description: String?) = mutate {
        val existing = id?.let { catalog.getCollection(it) }
        if (existing != null) catalog.updateCollection(existing.id, name, color, description) else catalog.addCollection(name, color, description)
        true
    }

    fun removeCollection(id: String) = mutate { catalog.removeCollection(id) }

    fun moveCollection(id: String, index: Int) = mutate { catalog.moveCollection(id, index) }

    fun toggleCollection(id: String, collapsed: Boolean) = mutate { catalog.setCollapsed(id, collapsed) != null }

    fun importLogo(id: String, sourceFile: Path): String = logos.importImage(id, sourceFile)

    /** The file that should be rendered as the project's logo, if any. */
    fun logoFile(project: Project, meta: ProjectMetadata?): Path? = when {
        project.logo?.kind == Logo.IMAGE && project.logo.value != null -> runCatching { logos.resolve(project.logo.value) }.getOrNull()
        project.logo?.kind == Logo.AUTO && meta?.autoLogoPath != null && logos.contains(meta.autoLogoPath) -> Path.of(meta.autoLogoPath)
        else -> null
    }

    private fun materializeLogo(id: String, logo: Logo?): Logo? {
        if (logo == null || logo.kind == Logo.NONE) {
            logos.remove(id)
            return null
        }
        return when (logo.kind) {
            Logo.IMAGE -> when {
                logo.value.isNullOrEmpty() -> null
                Path.of(logo.value).isAbsolute -> Logo(Logo.IMAGE, logos.importImage(id, Path.of(logo.value)))
                else -> logo
            }
            Logo.EMOJI -> {
                logos.remove(id)
                logo.value?.trim()?.ifEmpty { null }?.let { Logo(Logo.EMOJI, it) }
            }
            else -> {
                logos.remove(id)
                Logo(Logo.AUTO)
            }
        }
    }

    private inline fun mutate(change: () -> Boolean) {
        val snapshot = synchronized(lock) { if (change()) catalog.snapshot() else null } ?: return
        persist(snapshot)
    }

    private fun persist(snapshot: CatalogData = synchronized(lock) { catalog.snapshot() }) {
        repository.save(snapshot)
        fire()
    }

    private fun fire() = listeners.forEach { runCatching { it() } }

    companion object {
        fun getInstance(): ProjectService = service()
    }
}
