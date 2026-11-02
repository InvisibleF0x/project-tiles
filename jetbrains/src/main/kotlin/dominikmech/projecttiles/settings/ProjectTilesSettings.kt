package dominikmech.projecttiles.settings

import com.intellij.openapi.components.BaseState
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.SimplePersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

class ProjectTilesState : BaseState() {
    var openInNewWindow by property(false)
    var columns by property(3)
    var tileSize by string("normal")
    var fetchRemote by property(true)
    var metadataCacheMinutes by property(10)
    var languageCacheHours by property(12)
    var maxFilesScanned by property(15000)
    var languageIgnoreDirs by string(DEFAULT_IGNORE_DIRS.joinToString(", "))
}

@Service(Service.Level.APP)
@State(name = "ProjectTiles", storages = [Storage("projectTiles.xml")])
class ProjectTilesSettings : SimplePersistentStateComponent<ProjectTilesState>(ProjectTilesState()) {
    val openInNewWindow get() = state.openInNewWindow
    val columns get() = state.columns.coerceIn(1, 6)
    val tileSize get() = if (state.tileSize == "compact") "compact" else "normal"
    val fetchRemote get() = state.fetchRemote
    val gitTtlMs get() = state.metadataCacheMinutes.coerceAtLeast(0) * 60_000L
    val languagesTtlMs get() = state.languageCacheHours.coerceAtLeast(0) * 3_600_000L
    val maxFilesScanned get() = state.maxFilesScanned.coerceAtLeast(100)
    val ignoreDirs: List<String> get() = (state.languageIgnoreDirs ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() }

    companion object {
        fun getInstance(): ProjectTilesSettings = service()
    }
}

val DEFAULT_IGNORE_DIRS = listOf(
    ".git", ".svn", ".hg", "node_modules", "bower_components", "vendor", "Library", "Temp", "Logs", "UserSettings",
    "obj", "bin", "build", "Build", "Builds", "dist", "out", "target", ".idea", ".vs", ".vscode", "__pycache__",
    ".venv", "venv", "env", ".next", ".nuxt", "coverage", ".gradle", "Pods", "DerivedData", ".dart_tool", ".cache",
    ".godot", ".import",
)
