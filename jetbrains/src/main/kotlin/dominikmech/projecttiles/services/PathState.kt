package dominikmech.projecttiles.services

import dominikmech.projecttiles.domain.Unavailable
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

private val MAC_VOLUME = Regex("^/Volumes/[^/]+")
private val LINUX_VOLUME = Regex("^/(?:run/)?media/[^/]+/[^/]+|^/mnt/[^/]+")
private val WINDOWS_ROOT = Regex("""^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?)""")

/**
 * The mount point a path lives on: the drive or UNC share on Windows, a removable or network
 * volume under /Volumes, /media, /run/media or /mnt elsewhere, and "/" for everything else.
 */
fun volumeRoot(path: String, os: String = System.getProperty("os.name")): String {
    val lower = os.lowercase()
    return when {
        lower.startsWith("windows") -> WINDOWS_ROOT.find(path)?.value ?: path.take(3)
        lower.startsWith("mac") -> MAC_VOLUME.find(path)?.value ?: "/"
        else -> LINUX_VOLUME.find(path)?.value ?: "/"
    }
}

/** Null when the project folder (or .code-workspace file) is there, otherwise an [Unavailable] reason. */
fun unavailability(path: String): String? {
    val p = runCatching { Paths.get(path) }.getOrNull() ?: return Unavailable.DELETED
    if (Files.isDirectory(p) || (path.lowercase().endsWith(".code-workspace") && Files.isRegularFile(p))) return null
    val root = runCatching { Path.of(volumeRoot(path)) }.getOrNull()
    return if (root != null && Files.exists(root)) Unavailable.DELETED else Unavailable.OFFLINE
}
