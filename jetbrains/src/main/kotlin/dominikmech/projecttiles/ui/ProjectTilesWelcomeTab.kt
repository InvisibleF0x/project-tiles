package dominikmech.projecttiles.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.WelcomeScreen
import com.intellij.openapi.wm.WelcomeScreenTab
import com.intellij.openapi.wm.WelcomeTabFactory
import com.intellij.openapi.wm.impl.welcomeScreen.TabbedWelcomeScreen
import javax.swing.JComponent

/** "Projects" tab on the welcome screen: the dashboard instead of the plain recent-projects list. */
class ProjectTilesWelcomeTabFactory : WelcomeTabFactory {
    override fun createWelcomeTabs(ws: WelcomeScreen, parentDisposable: Disposable): List<WelcomeScreenTab> = listOf(
        object : TabbedWelcomeScreen.DefaultWelcomeScreenTab(WebAssets.strings().get("title").asString, ProjectTilesIcons.Tiles) {
            override fun buildComponent(): JComponent {
                val view = DashboardView(null)
                Disposer.register(parentDisposable, view)
                return view.component
            }
        },
    )
}
