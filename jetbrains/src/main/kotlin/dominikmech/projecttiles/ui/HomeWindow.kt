package dominikmech.projecttiles.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.startup.ProjectActivity
import dominikmech.projecttiles.settings.ProjectTilesSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The Home window of 2026.3+ IDEs (the non-modal welcome screen before that) is an ordinary frame around a hidden
 * "welcome" project. The platform only offers an internal check for it, so it is looked up reflectively: if
 * JetBrains renames it, the dashboard simply stops opening there on its own.
 */
object HomeWindow {
    private const val PROVIDER = "com.intellij.openapi.wm.ex.WelcomeScreenProjectProvider"
    // 2026.2+ calls it isWelcomeScreenProject, 2025.2 isSingleWelcomeScreenProject.
    private val CHECKS = listOf("isWelcomeScreenProject", "isSingleWelcomeScreenProject")

    private val check: ((Project) -> Boolean)? by lazy { resolve() }

    fun isHome(project: Project): Boolean = check?.let { runCatching { it(project) }.getOrDefault(false) } ?: false

    /** Opens the dashboard in every Home window that is already showing. */
    fun openDashboardEverywhere() {
        ProjectManager.getInstance().openProjects.filter { !it.isDisposed && isHome(it) }.forEach { DashboardOpener.getInstance(it).open() }
    }

    private fun resolve(): ((Project) -> Boolean)? {
        val loaders = listOf(HomeWindow::class.java.classLoader, Project::class.java.classLoader, ApplicationManager.getApplication().javaClass.classLoader)
        for (loader in loaders.distinct()) {
            val provider = runCatching { Class.forName(PROVIDER, true, loader) }.getOrNull() ?: continue
            val companion = runCatching { provider.getField("Companion").get(null) }.getOrNull() ?: continue
            val method = CHECKS.firstNotNullOfOrNull { name -> runCatching { companion.javaClass.getMethod(name, Project::class.java) }.getOrNull() } ?: continue
            return { project -> method.invoke(companion, project) as Boolean }
        }
        logger<HomeWindow>().info("Home window detection is not available in this IDE")
        return null
    }
}

/** Shows the dashboard in place of the Home window's start page (and its agent prompt). */
class HomeWindowDashboard : ProjectActivity {
    override suspend fun execute(project: Project) {
        if (!ProjectTilesSettings.getInstance().openInHomeWindow || !HomeWindow.isHome(project)) return
        withContext(Dispatchers.EDT) {
            if (!project.isDisposed) DashboardOpener.getInstance(project).open()
        }
    }
}
