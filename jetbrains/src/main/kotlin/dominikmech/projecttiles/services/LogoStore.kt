package dominikmech.projecttiles.services

import dominikmech.projecttiles.domain.SAFE_ID
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.io.path.extension
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

private val AUTO_LOGO_CANDIDATES = listOf(
    "logo.png", "logo.svg", "logo.jpg", "logo.jpeg", "logo.webp",
    "icon.png", "icon.svg", "icon.jpg", "icon.ico",
    ".vscode/logo.png", ".vscode/icon.png", ".idea/icon.png", ".idea/icon.svg",
    "assets/logo.png", "assets/icon.png", "public/favicon.svg", "public/favicon.ico", "public/logo.png",
    "Assets/logo.png", "Assets/icon.png", "media/icon.png", "docs/logo.png",
)

private const val MAX_AUTO_LOGO_BYTES = 2L * 1024 * 1024

class LogoStore(val root: Path) {
    /** Returns the stored file name. */
    fun importImage(projectId: String, sourceFile: Path): String {
        requireSafeId(projectId)
        Files.createDirectories(root)
        remove(projectId)
        val ext = sourceFile.extension.lowercase().ifEmpty { "png" }
        val fileName = "$projectId.$ext"
        Files.copy(sourceFile, root.resolve(fileName), StandardCopyOption.REPLACE_EXISTING)
        return fileName
    }

    fun remove(projectId: String) {
        requireSafeId(projectId)
        val entries = runCatching { root.listDirectoryEntries() }.getOrNull() ?: return
        entries.filter { it.name.startsWith("$projectId.") }.forEach { runCatching { Files.deleteIfExists(it) } }
    }

    /** Absolute path of a stored file; refuses anything that would leave the store directory. */
    fun resolve(fileName: String): Path {
        val resolved = root.resolve(fileName).normalize()
        require(resolved.parent == root.normalize()) { "Project Tiles: invalid logo file name \"$fileName\"" }
        return resolved
    }

    fun contains(file: String): Boolean = runCatching { Path.of(file).toAbsolutePath().normalize().parent == root.toAbsolutePath().normalize() }.getOrDefault(false)

    /**
     * Looks for a conventional logo file inside the project (a handful of stats) and mirrors it
     * into the store. Returns the absolute path of the copy.
     */
    fun discover(projectId: String, projectFolder: Path): Path? {
        requireSafeId(projectId)
        for (candidate in AUTO_LOGO_CANDIDATES) {
            val file = projectFolder.resolve(candidate)
            try {
                if (!file.isRegularFile()) continue
                val size = Files.size(file)
                if (size == 0L || size > MAX_AUTO_LOGO_BYTES) continue
                Files.createDirectories(root)
                val target = root.resolve("$projectId.auto.${file.extension.lowercase()}")
                Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING)
                return target
            } catch (_: Exception) {
                // not there or unreadable
            }
        }
        return null
    }

    private fun requireSafeId(id: String) = require(SAFE_ID.matches(id)) { "Project Tiles: invalid project id \"$id\"" }
}
