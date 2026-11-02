package dominikmech.projecttiles.ui

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.vfs.LocalFileSystem
import java.nio.file.Path
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/** Opens a tab in the IDE's Terminal tool window (optional dependency on the bundled Terminal plugin). */
object TerminalLauncher {
    private val TERMINAL = PluginId.getId("org.jetbrains.plugins.terminal")

    /** False when the Terminal plugin is missing or disabled; the caller then falls back to a system terminal. */
    fun open(project: Project, folder: Path): Boolean {
        if (!PluginManagerCore.isLoaded(TERMINAL)) return false
        val directory = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(folder) ?: return false
        return try {
            TerminalToolWindowManager.getInstance(project).openTerminalIn(directory)
            true
        } catch (e: LinkageError) {
            thisLogger().info("Project Tiles: terminal plugin API unavailable", e)
            false
        }
    }
}

/** The operating system's own terminal, used on the welcome screen (no project, so no Terminal tool window). */
object ExternalTerminal {
    fun open(folder: Path) {
        val command = when {
            SystemInfo.isWindows -> GeneralCommandLine("cmd.exe", "/c", "start", "cmd.exe")
            SystemInfo.isMac -> GeneralCommandLine("open", "-a", "Terminal", folder.toString())
            else -> GeneralCommandLine("x-terminal-emulator")
        }.withWorkingDirectory(folder)
        runCatching { command.createProcess() }.onFailure { thisLogger().warn("Project Tiles: cannot start a terminal", it) }
    }
}
