package dominikmech.projecttiles.ui

import com.intellij.ide.RecentProjectsManager
import com.intellij.ide.RecentProjectsManagerBase
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.ProjectInput
import dominikmech.projecttiles.services.ProjectService
import java.nio.file.Files
import java.nio.file.Path

/** "Add recent…": picks any number of projects from the IDE's own recent-projects list and adds them. */
object RecentProjectsImport {
    fun run(project: Project?) {
        val strings = WebAssets.strings()
        val service = ProjectService.getInstance()
        service.ensureLoaded()
        val manager = RecentProjectsManager.getInstance() as? RecentProjectsManagerBase ?: return
        val names = mutableMapOf<String, String>()
        val candidates = manager.getRecentPaths()
            .filter { service.findByPath(it) == null && runCatching { Files.isDirectory(Path.of(it)) }.getOrDefault(false) }
            .map { recent ->
                val path = Path.of(recent).toString()
                val name = manager.getProjectName(recent)
                names[path] = name
                FolderCandidate(path, "$name  —  $path", false)
            }
        if (candidates.isEmpty()) {
            Messages.showInfoMessage(project, strings.get("addRecentNone").asString, "Project Tiles")
            return
        }
        val chosen = FolderImport.choose(project, strings.get("addRecentTitle").asString, candidates)
        if (chosen.isEmpty()) return
        ApplicationManager.getApplication().executeOnPooledThread {
            for (path in chosen) service.saveProject(service.newId(), ProjectInput(name = names[path] ?: "", path = path, logo = Logo(Logo.AUTO)))
        }
    }
}
