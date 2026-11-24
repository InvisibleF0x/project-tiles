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

    /** Runs [command] in a new Terminal tab called [tabName], started in [folder]. Call on the EDT. */
    fun run(project: Project, folder: Path, tabName: String, command: String): Boolean {
        if (!PluginManagerCore.isLoaded(TERMINAL)) return false
        return try {
            TerminalToolWindowManager.getInstance(project).createShellWidget(folder.toString(), tabName, true, true).sendCommandToExecute(command)
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
        start(command)
    }

    /** Opens a system terminal in [folder] that runs [command] and stays open afterwards. */
    fun run(folder: Path, command: String) {
        val line = when {
            SystemInfo.isWindows -> GeneralCommandLine("cmd.exe", "/c", "start", "cmd.exe", "/k", command)
            SystemInfo.isMac -> {
                val script = "cd ${shellQuote(folder.toString())} && $command"
                GeneralCommandLine("osascript", "-e", "tell application \"Terminal\" to do script \"${appleScriptEscape(script)}\"", "-e", "tell application \"Terminal\" to activate")
            }
            else -> GeneralCommandLine("x-terminal-emulator", "-e", "sh", "-c", "$command; exec \"\${SHELL:-sh}\"")
        }.withWorkingDirectory(folder)
        start(line)
    }

    private fun start(command: GeneralCommandLine) {
        runCatching { command.createProcess() }.onFailure { thisLogger().warn("Project Tiles: cannot start a terminal", it) }
    }

    private fun shellQuote(s: String) = "'" + s.replace("'", "'\\''") + "'"

    private fun appleScriptEscape(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")
}
