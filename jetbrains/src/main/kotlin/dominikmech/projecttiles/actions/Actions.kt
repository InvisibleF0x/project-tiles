package dominikmech.projecttiles.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.vfs.LocalFileSystem
import dominikmech.projecttiles.services.ProjectService
import dominikmech.projecttiles.ui.DashboardOpener
import dominikmech.projecttiles.ui.DashboardView
import dominikmech.projecttiles.ui.RecentProjectsImport

/** Base for actions that need a project window (the dashboard tab lives in one). */
abstract class ProjectAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}

class OpenDashboardAction : ProjectAction() {
    override fun actionPerformed(e: AnActionEvent) {
        DashboardOpener.getInstance(e.project ?: return).open()
    }
}

class AddCurrentProjectAction : ProjectAction() {
    override fun actionPerformed(e: AnActionEvent) {
        DashboardOpener.getInstance(e.project ?: return).open()?.addCurrent()
    }
}

class AddRecentProjectsAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        RecentProjectsImport.run(e.project)
    }
}

class RefreshAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        e.project?.let { DashboardOpener.getInstance(it).open() }
        DashboardView.manualRefreshAll()
    }
}

class OpenDataFileAction : ProjectAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val service = ProjectService.getInstance()
        service.ensureLoaded()
        val file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(service.dataFile) ?: return
        FileEditorManager.getInstance(project).openFile(file, true)
    }
}
