package dominikmech.projecttiles.ui

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.actions.RevealFileAction
import com.intellij.ide.impl.OpenProjectTask
import com.intellij.ide.impl.ProjectUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project as IdeProject
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.ProjectCatalog
import dominikmech.projecttiles.domain.ProjectInput
import dominikmech.projecttiles.domain.ProjectMetadata
import dominikmech.projecttiles.services.DirectoryWatcher
import dominikmech.projecttiles.services.ProjectService
import dominikmech.projecttiles.services.RefreshOptions
import dominikmech.projecttiles.settings.ProjectTilesSettings
import dominikmech.projecttiles.storage.asJsonObjectOrNull
import dominikmech.projecttiles.storage.boolean
import dominikmech.projecttiles.storage.compactGson
import dominikmech.projecttiles.storage.string
import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import javax.swing.JComponent
import javax.swing.SwingConstants
import kotlin.io.path.extension
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.isDirectory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter

/** The dashboard page in a JCEF browser; [ideProject] is null on the welcome screen. */
class DashboardView(private val ideProject: IdeProject?) : Disposable {
    private val service = ProjectService.getInstance()
    private val settings = ProjectTilesSettings.getInstance()
    private val browser: JBCefBrowser? = if (JBCefApp.isSupported()) JBCefBrowser() else null
    val component: JComponent = browser?.component ?: JBLabel("Project Tiles needs JCEF (the embedded browser), which this IDE runtime does not provide.", SwingConstants.CENTER).apply {
        border = JBUI.Borders.empty(24)
    }

    @Volatile
    private var ready = false
    @Volatile
    private var disposed = false
    private var pendingEdit: String? = null
    private var pendingDraft: Map<String, Any?>? = null
    private val busyCount = AtomicInteger()
    private val disposers = CopyOnWriteArrayList<() -> Unit>()
    private val logoCache = ConcurrentHashMap<Path, Pair<Long, String>>()

    /** Repository activity (pull, commit, checkout…) refreshes just that tile's git part. */
    private val gitWatcher = DirectoryWatcher(1500) { gitDir -> onRepositoryChanged(gitDir) }
    private val gitDirs = ConcurrentHashMap<Path, String>()

    init {
        all += this
        if (browser != null) {
            Disposer.register(this, browser)
            val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
            Disposer.register(this, query)
            query.addHandler { raw ->
                onMessage(raw)
                null
            }
            browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                    if (frame.isMain) {
                        cefBrowser.executeJavaScript("window.__ptSend = function (s) { ${query.inject("s")} }; window.__ptFlush();", cefBrowser.url, 0)
                    }
                }
            }, browser.cefBrowser)
            browser.loadHTML(WebAssets.page())
            ApplicationManager.getApplication().messageBus.connect(this).subscribe(LafManagerListener.TOPIC, LafManagerListener { applyTheme() })
        }
        disposers += service.onDidChange { if (ready) launch { pushState() } }
        disposers += { gitWatcher.close() }
        // Gather metadata (including the one network check) while the page loads; the first state
        // message then carries whatever is already known.
        launch {
            service.ensureLoaded()
            disposers += service.watchExternalChanges()
            refreshMetadata(force = false, only = null, gitOnly = false, network = true)
        }
    }

    override fun dispose() {
        disposed = true
        all -= this
        disposers.forEach { runCatching { it() } }
        disposers.clear()
    }

    /** Opens the project editor form once the page is ready (`"new"` with a draft for a fresh one). */
    fun showEditor(editing: String?, draft: Map<String, Any?>? = null) {
        pendingEdit = editing
        pendingDraft = draft
        if (ready) launch { pushState() }
    }

    fun refreshView() {
        if (ready) launch { pushState() }
    }

    fun refreshAll() = launch { refreshMetadata(force = true, only = null, gitOnly = false, network = true) }

    private fun launch(block: suspend () -> Unit) {
        if (disposed) return
        service.scope.launch(Dispatchers.IO) {
            try {
                block()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                thisLogger().warn("Project Tiles: ${e.message}", e)
            }
        }
    }

    private suspend fun refreshMetadata(force: Boolean, only: Project?, gitOnly: Boolean, network: Boolean) {
        setBusy(true)
        try {
            val projects = only?.let { listOf(it) } ?: service.projects
            service.metadata.refresh(projects, { project, meta -> post(metaMessage(project, meta)) }, RefreshOptions(force, network, gitOnly))
        } finally {
            setBusy(false)
        }
    }

    private fun setBusy(busy: Boolean) {
        val count = if (busy) busyCount.incrementAndGet() else busyCount.decrementAndGet()
        if ((busy && count == 1) || (!busy && count == 0)) post(mapOf("type" to "busy", "busy" to busy))
    }

    private suspend fun pushState() {
        service.ensureLoaded()
        service.metadata.ensureLoaded()
        val currentKey = currentFolder()?.let(ProjectCatalog::pathKey)
        val meta = linkedMapOf<String, ProjectMetadata>()
        val projects = service.projects.map { p ->
            val cached = service.metadata.cached(p)
            if (cached != null) meta[p.id] = cached
            projectView(p, cached, currentKey)
        }
        val state = JsonObject().apply {
            add("collections", compactGson.toJsonTree(service.collections))
            add("projects", compactGson.toJsonTree(projects))
            add("meta", compactGson.toJsonTree(meta))
            add("settings", compactGson.toJsonTree(mapOf("openInNewWindow" to settings.openInNewWindow, "tileSize" to settings.tileSize, "columns" to settings.columns)))
            add("strings", WebAssets.strings())
            pendingEdit?.let { addProperty("editing", it) }
            pendingDraft?.let { if (pendingEdit != null) add("draft", compactGson.toJsonTree(it)) }
        }
        pendingEdit = null
        pendingDraft = null
        post(mapOf("type" to "state", "state" to state))
        syncGitWatcher()
        refreshMetadata(force = false, only = null, gitOnly = false, network = false)
    }

    private fun projectView(p: Project, meta: ProjectMetadata?, currentKey: String?): JsonElement =
        compactGson.toJsonTree(p).asJsonObject.apply {
            addProperty("isCurrent", currentKey != null && ProjectCatalog.pathKey(p.path) == currentKey)
            logoUri(p, meta)?.let { addProperty("logoUri", it) }
        }

    private fun metaMessage(project: Project, meta: ProjectMetadata): Map<String, Any?> = buildMap {
        put("type", "meta")
        put("id", project.id)
        put("meta", meta)
        logoUri(project, meta)?.let { put("logoUri", it) }
    }

    /** Logos are inlined as data: URIs (the page may not load files); cached per file version. */
    private fun logoUri(project: Project, meta: ProjectMetadata?): String? {
        val file = service.logoFile(project, meta) ?: return null
        return try {
            val stamp = file.getLastModifiedTime().toMillis()
            logoCache[file]?.takeIf { it.first == stamp }?.second ?: run {
                val mime = when (file.extension.lowercase()) {
                    "svg" -> "image/svg+xml"
                    "jpg", "jpeg" -> "image/jpeg"
                    "gif" -> "image/gif"
                    "webp" -> "image/webp"
                    "ico" -> "image/x-icon"
                    else -> "image/png"
                }
                "data:$mime;base64,${Base64.getEncoder().encodeToString(Files.readAllBytes(file))}".also { logoCache[file] = stamp to it }
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun post(message: Any) {
        val cef = browser?.cefBrowser ?: return
        if (disposed) return
        cef.executeJavaScript("window.postMessage(${compactGson.toJson(message)}, '*');", cef.url, 0)
    }

    private fun applyTheme() {
        val css = compactGson.toJson(WebAssets.themeCss())
        browser?.cefBrowser?.let { it.executeJavaScript("document.getElementById('theme').textContent = $css;", it.url, 0) }
    }

    private fun syncGitWatcher() {
        gitDirs.clear()
        for (p in service.projects) {
            val gitDir = runCatching { Path.of(p.path).resolve(".git") }.getOrNull() ?: continue
            if (gitDir.isDirectory()) gitDirs[gitDir] = p.path
        }
        gitWatcher.sync(gitDirs.keys)
    }

    private fun onRepositoryChanged(gitDir: Path) {
        val projectPath = gitDirs[gitDir] ?: return
        if (service.metadata.isSelfChange(projectPath)) return // echo of our own `git fetch`
        val project = service.projects.find { it.path == projectPath } ?: return
        service.metadata.markGitStale(projectPath)
        launch { refreshMetadata(force = false, only = project, gitOnly = true, network = false) }
    }

    private fun onMessage(raw: String) {
        val m = runCatching { JsonParser.parseString(raw).asJsonObjectOrNull() }.getOrNull() ?: return
        val type = m.string("type") ?: return
        val idElement = m.get("id")
        if (idElement != null && !idElement.isJsonNull && m.string("id") == null) return // cheap shape check: untrusted input
        launch { handle(type, m) }
    }

    private suspend fun handle(type: String, m: JsonObject) {
        val id = m.string("id")
        when (type) {
            "ready" -> {
                ready = true
                service.syncFromDisk()
                pushState()
                if (busyCount.get() > 0) post(mapOf("type" to "busy", "busy" to true))
            }
            "open" -> service.getProject(id ?: return)?.let { openProject(it, m.boolean("newWindow") == true) }
            "terminal" -> service.getProject(id ?: return)?.let { openTerminal(it) }
            "reveal" -> service.getProject(id ?: return)?.let { p ->
                val path = Path.of(p.path)
                if (path.isDirectory()) RevealFileAction.openDirectory(path) else RevealFileAction.openFile(path)
            }
            "saveProject" -> {
                val patch = m.getAsJsonObject("patch") ?: return
                val logo = patch.get("logo")?.asJsonObjectOrNull()?.let { l -> l.string("kind")?.let { Logo(it, l.string("value")) } }
                service.saveProject(
                    id ?: service.newId(),
                    ProjectInput(
                        name = patch.string("name") ?: "",
                        path = patch.string("path") ?: return,
                        description = patch.string("description"),
                        logo = logo,
                        languages = patch.getAsJsonArray("languages")?.mapNotNull { e -> e.takeIf { it.isJsonPrimitive }?.asString },
                        color = patch.string("color"),
                        collectionId = patch.string("collectionId"),
                    ),
                )
            }
            "removeProject" -> service.removeProject(id ?: return)
            "moveProject" -> service.moveProject(id ?: return, m.string("collectionId"), m.get("index")?.asInt ?: 0)
            "saveCollection" -> service.saveCollection(id, m.string("name") ?: "", m.string("color"), m.string("description"))
            "removeCollection" -> service.removeCollection(id ?: return)
            "moveCollection" -> service.moveCollection(id ?: return, m.get("index")?.asInt ?: 0)
            "toggleCollection" -> service.toggleCollection(id ?: return, m.boolean("collapsed") == true)
            "pickLogo" -> {
                val descriptor = FileChooserDescriptorFactory.singleFile()
                    .withExtensionFilter("Images", "png", "jpg", "jpeg", "svg", "webp", "gif", "ico")
                val file = withContext(Dispatchers.EDT) { FileChooser.chooseFile(descriptor, ideProject, null) } ?: return
                val projectId = id ?: service.newId()
                val fileName = service.importLogo(projectId, file.toNioPath())
                val logoUri = logoUri(Project(projectId, "", "", logo = Logo(Logo.IMAGE, fileName)), null) ?: return
                post(mapOf("type" to "logoPicked", "id" to projectId, "fileName" to fileName, "logoUri" to logoUri))
            }
            "pickFolder" -> {
                val folder = withContext(Dispatchers.EDT) {
                    FileChooser.chooseFile(FileChooserDescriptorFactory.singleDir(), ideProject, null)
                } ?: return
                post(mapOf("type" to "folderPicked", "path" to folder.toNioPath().toString(), "name" to folder.name))
            }
            "refresh" -> refreshMetadata(force = true, only = id?.let(service::getProject), gitOnly = false, network = true)
            "addCurrent" -> addCurrent()
        }
    }

    private fun currentFolder(): String? = ideProject?.basePath?.let { Path.of(it).toString() }

    /** Edits the open project's existing entry, or opens a form pre-filled with it. */
    fun addCurrent() {
        val folder = currentFolder() ?: return
        service.ensureLoaded()
        val existing = service.findByPath(folder)
        if (existing != null) {
            showEditor(existing.id)
        } else {
            showEditor("new", mapOf("name" to ProjectCatalog.baseName(folder), "path" to folder, "logo" to Logo(Logo.AUTO)))
        }
    }

    private suspend fun openProject(project: Project, newWindow: Boolean) {
        var path = Path.of(project.path)
        // A VS Code .code-workspace file cannot be opened here; open the folder that holds it.
        if (!path.isDirectory() && path.toString().lowercase().endsWith(".code-workspace")) path = path.parent
        if (ideProject != null && ProjectCatalog.pathKey(project.path) == currentFolder()?.let(ProjectCatalog::pathKey)) return
        val task = OpenProjectTask.build().withForceOpenInNewFrame(newWindow).withProjectToClose(if (newWindow) null else ideProject)
        ProjectUtil.openOrImportAsync(path, task)
    }

    private suspend fun openTerminal(project: Project) {
        val folder = Path.of(project.path).let { if (it.isDirectory()) it else it.parent }
        withContext(Dispatchers.EDT) {
            if (ideProject == null || !TerminalLauncher.open(ideProject, folder)) {
                ExternalTerminal.open(folder)
            }
        }
    }

    companion object {
        private val all = CopyOnWriteArrayList<DashboardView>()

        fun refreshAllViews() = all.forEach { it.refreshView() }

        fun manualRefreshAll() = all.forEach { it.refreshAll() }
    }
}
