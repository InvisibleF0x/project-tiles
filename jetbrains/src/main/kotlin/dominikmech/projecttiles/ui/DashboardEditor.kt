package dominikmech.projecttiles.ui

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import java.beans.PropertyChangeListener
import javax.swing.Icon
import javax.swing.JComponent

object ProjectTilesIcons {
    @JvmField
    val Tiles: Icon = IconLoader.getIcon("/icons/projectTiles.svg", ProjectTilesIcons::class.java)
}

/** File type of the dashboard tab; only gives the tab its icon. */
object DashboardFileType : FileType {
    override fun getName() = "Project Tiles Dashboard"
    override fun getDescription() = "Project Tiles dashboard"
    override fun getDefaultExtension() = ""
    override fun getIcon(): Icon = ProjectTilesIcons.Tiles
    override fun isBinary() = true
    override fun isReadOnly() = true
}

/** The in-memory "file" an editor tab needs; one per project window. */
class DashboardFile : LightVirtualFile(WebAssets.strings().get("title").asString, DashboardFileType, "") {
    init {
        isWritable = false
    }
}

class DashboardEditor(project: Project, private val file: DashboardFile) : UserDataHolderBase(), FileEditor {
    val view = DashboardView(project)

    override fun getComponent(): JComponent = view.component
    override fun getPreferredFocusedComponent(): JComponent = view.component
    override fun getName() = "Project Tiles"
    override fun getFile(): VirtualFile = file
    override fun setState(state: FileEditorState) = Unit
    override fun isModified() = false
    override fun isValid() = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) = Unit
    override fun removePropertyChangeListener(listener: PropertyChangeListener) = Unit
    override fun dispose() = Disposer.dispose(view)
}

class DashboardEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile) = file is DashboardFile
    override fun acceptRequiresReadAction() = false
    override fun createEditor(project: Project, file: VirtualFile): FileEditor = DashboardEditor(project, file as DashboardFile)
    override fun getEditorTypeId() = "project-tiles-dashboard"
    override fun getPolicy() = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}

/** Opens (or focuses) the single dashboard tab of a project window. */
@Service(Service.Level.PROJECT)
class DashboardOpener(private val project: Project) {
    private var file: DashboardFile? = null

    fun open(): DashboardView? {
        val manager = FileEditorManager.getInstance(project)
        val target = file?.takeIf { it.isValid } ?: DashboardFile().also { file = it }
        return manager.openFile(target, true).filterIsInstance<DashboardEditor>().firstOrNull()?.view
    }

    companion object {
        fun getInstance(project: Project): DashboardOpener = project.service()
    }
}
