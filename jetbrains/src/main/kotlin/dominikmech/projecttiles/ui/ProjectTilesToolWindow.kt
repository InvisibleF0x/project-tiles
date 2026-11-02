package dominikmech.projecttiles.ui

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JButton
import javax.swing.JPanel

const val TOOL_WINDOW_ID = "Project Tiles"

/** Holds two shortcuts in case the tool window is ever left open; see [ProjectTilesToolWindowListener]. */
class ProjectTilesToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val strings = WebAssets.strings()
        val buttons = JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
            add(JButton(strings.get("title").asString).apply { addActionListener { DashboardOpener.getInstance(project).open() } })
            add(JButton(strings.get("addCurrent").asString).apply { addActionListener { DashboardOpener.getInstance(project).open()?.addCurrent() } })
        }
        val panel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(12)
            add(buttons, BorderLayout.NORTH)
            add(JBLabel(""), BorderLayout.CENTER)
        }
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(panel, null, false))
    }
}

/** Turns the side-bar icon into a launcher: showing the tool window opens the dashboard tab and hides it again. */
class ProjectTilesToolWindowListener(private val project: Project) : ToolWindowManagerListener {
    override fun toolWindowShown(toolWindow: ToolWindow) {
        if (toolWindow.id != TOOL_WINDOW_ID) return
        DashboardOpener.getInstance(project).open()
        toolWindow.hide()
    }
}
