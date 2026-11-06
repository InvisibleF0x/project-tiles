package dominikmech.projecttiles.ui

import com.intellij.ide.RecentProjectsManager
import com.intellij.ide.RecentProjectsManagerBase
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.CheckBoxList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.ProjectInput
import dominikmech.projecttiles.services.ProjectService
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.JComponent

/** "Add recent…": picks any number of projects from the IDE's own recent-projects list and adds them. */
object RecentProjectsImport {
    fun run(project: Project?) {
        val strings = WebAssets.strings()
        val service = ProjectService.getInstance()
        service.ensureLoaded()
        val manager = RecentProjectsManager.getInstance() as? RecentProjectsManagerBase ?: return
        val candidates = manager.getRecentPaths()
            .filter { service.findByPath(it) == null && runCatching { Files.isDirectory(Path.of(it)) }.getOrDefault(false) }
            .map { Candidate(Path.of(it).toString(), manager.getProjectName(it)) }
        if (candidates.isEmpty()) {
            Messages.showInfoMessage(project, strings.get("addRecentNone").asString, "Project Tiles")
            return
        }
        val dialog = Dialog(project, strings.get("addRecentTitle").asString, candidates)
        if (!dialog.showAndGet()) return
        val chosen = dialog.chosen()
        if (chosen.isEmpty()) return
        ApplicationManager.getApplication().executeOnPooledThread {
            for (c in chosen) service.saveProject(service.newId(), ProjectInput(name = c.name, path = c.path, logo = Logo(Logo.AUTO)))
        }
    }

    private data class Candidate(val path: String, val name: String) {
        override fun toString() = "$name  —  $path"
    }

    private class Dialog(project: Project?, title: String, private val candidates: List<Candidate>) : DialogWrapper(project) {
        private val list = CheckBoxList<Candidate>().apply { candidates.forEach { addItem(it, it.toString(), false) } }

        init {
            this.title = title
            init()
        }

        fun chosen(): List<Candidate> = candidates.filter { list.isItemSelected(it) }

        override fun createCenterPanel(): JComponent = JBScrollPane(list).apply { preferredSize = JBUI.size(560, 360) }
    }
}
