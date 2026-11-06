package dominikmech.projecttiles.settings

import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindIntText
import com.intellij.ui.dsl.builder.bindItem
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel
import dominikmech.projecttiles.services.ProjectService
import dominikmech.projecttiles.ui.DashboardView

class ProjectTilesConfigurable : BoundConfigurable("Project Tiles") {
    private val state get() = ProjectTilesSettings.getInstance().state

    override fun createPanel(): DialogPanel = panel {
        group("Dashboard") {
            row { checkBox("Open projects in a new window by default").bindSelected(state::openInNewWindow) }
            row("Preferred number of columns:") { intTextField(1..6).bindIntText(state::columns).columns(4) }
            row("Tile size:") { comboBox(listOf("normal", "compact")).bindItem({ state.tileSize ?: "normal" }, { state.tileSize = it ?: "normal" }) }
            row { checkBox("Show the folder path").bindSelected(state::showPath) }
            row { checkBox("Show languages (when off, projects are not scanned)").bindSelected(state::showLanguages) }
            row { checkBox("Show git status and fetch / pull / push buttons (when off, git is never run)").bindSelected(state::showGit) }
        }
        group("Git") {
            row { checkBox("Run git fetch before computing ahead/behind (uses the network)").bindSelected(state::fetchRemote) }
            row("Reuse git info for (minutes):") { intTextField(0..1440).bindIntText(state::metadataCacheMinutes).columns(6) }
        }
        group("Languages") {
            row("Reuse a language scan for (hours):") { intTextField(0..720).bindIntText(state::languageCacheHours).columns(6) }
            row("Max files scanned per project:") { intTextField(100..1_000_000).bindIntText(state::maxFilesScanned).columns(8) }
            row("Ignored directories:") {
                textField().bindText({ state.languageIgnoreDirs ?: "" }, { state.languageIgnoreDirs = it }).resizableColumn()
                    .comment("Comma-separated, matched by folder name")
            }
        }
        row {
            comment("Projects are stored in ${ProjectService.getInstance().dataFile}, shared with VS Code and its forks.")
        }
    }

    override fun apply() {
        val scanInputs = { listOf(state.languageIgnoreDirs, state.maxFilesScanned, state.fetchRemote, state.showGit, state.showLanguages) }
        val before = scanInputs()
        super.apply()
        if (scanInputs() != before) ProjectService.getInstance().metadata.invalidate()
        DashboardView.refreshAllViews()
    }
}
