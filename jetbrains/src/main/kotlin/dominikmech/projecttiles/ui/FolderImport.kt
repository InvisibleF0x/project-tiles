package dominikmech.projecttiles.ui

import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.CheckBoxList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import javax.swing.JComponent
import kotlin.io.path.isDirectory
import kotlin.io.path.name

/** A folder offered for adding, with whether it starts ticked. */
data class FolderCandidate(val path: String, val label: String, val checked: Boolean) {
    override fun toString() = label
}

/** Pickers behind "Add folders" (several at once) and "All subfolders of a folder". Call on the EDT. */
object FolderImport {
    fun pickFolders(project: Project?): List<String> {
        val descriptor = FileChooserDescriptor(false, true, false, false, false, true)
        return FileChooser.chooseFiles(descriptor, project, null).map { it.toNioPath().toString() }
    }

    fun pickParent(project: Project?): Path? =
        FileChooser.chooseFile(FileChooserDescriptorFactory.createSingleFolderDescriptor(), project, null)?.toNioPath()

    /** Lets the user tick folders in a list; returns the ticked paths (empty when cancelled). */
    fun choose(project: Project?, title: String, candidates: List<FolderCandidate>): List<String> {
        val dialog = ChoiceDialog(project, title, candidates)
        return if (dialog.showAndGet()) dialog.chosen().map { it.path } else emptyList()
    }

    private class ChoiceDialog(project: Project?, title: String, private val candidates: List<FolderCandidate>) : DialogWrapper(project) {
        private val list = CheckBoxList<FolderCandidate>().apply { candidates.forEach { addItem(it, it.label, it.checked) } }

        init {
            this.title = title
            init()
        }

        fun chosen(): List<FolderCandidate> = candidates.filter { list.isItemSelected(it) }

        override fun createCenterPanel(): JComponent = JBScrollPane(list).apply { preferredSize = JBUI.size(560, 360) }
    }
}

/** A subfolder of the folder being imported; [isGit] when it has a `.git` entry, so it is most likely a project. */
data class Subfolder(val path: String, val name: String, val isGit: Boolean)

private val SKIPPED = setOf("node_modules", "\$RECYCLE.BIN", "System Volume Information")

/** The direct subfolders of [parent] (hidden ones skipped), git repositories first, then by name; like the VS Code extension. */
fun listSubfolders(parent: Path): List<Subfolder> =
    Files.list(parent).use { stream ->
        stream.filter { it.isDirectory() && !it.name.startsWith(".") && it.name !in SKIPPED }
            .map { Subfolder(it.toString(), it.name, Files.exists(it.resolve(".git"))) }
            .toList()
    }.sortedWith(compareBy<Subfolder> { !it.isGit }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })

/** Turns drag data (file URIs or plain paths) into absolute local paths; anything else is dropped. Mirrors the VS Code extension. */
fun pathsFromDropped(items: List<String>, windows: Boolean = SystemInfo.isWindows): List<String> {
    val out = mutableListOf<String>()
    for (raw in items) {
        val item = raw.trim()
        if (item.isEmpty() || item.startsWith("#")) continue
        val candidate = when {
            item.startsWith("file://", ignoreCase = true) -> runCatching { fileUriToPath(item, windows) }.getOrNull()
            Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(item) -> null
            else -> item
        } ?: continue
        val absolute = if (windows) Regex("^([a-zA-Z]:[\\\\/]|\\\\\\\\)").containsMatchIn(candidate) else candidate.startsWith("/")
        if (absolute && candidate !in out) out += candidate
    }
    return out
}

private fun fileUriToPath(uri: String, windows: Boolean): String {
    val parsed = URI(uri)
    var path = URLDecoder.decode(parsed.rawPath.replace("+", "%2B"), StandardCharsets.UTF_8)
    if (!windows) return path
    val host = parsed.host
    if (!host.isNullOrEmpty()) return "\\\\$host${path.replace('/', '\\')}"
    if (Regex("^/[a-zA-Z]:").containsMatchIn(path)) path = path.substring(1)
    return path.replace('/', '\\')
}
