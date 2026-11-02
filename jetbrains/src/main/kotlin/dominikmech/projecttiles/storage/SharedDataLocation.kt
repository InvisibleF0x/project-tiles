package dominikmech.projecttiles.storage

import java.nio.file.Path
import java.nio.file.Paths

private const val DIRECTORY_NAME = "project-tiles"
private const val CATALOG_FILE = "projects.json"
private const val LOGO_DIRECTORY = "logos"

/**
 * The per-user configuration root: `%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
 * `$XDG_CONFIG_HOME` (default `~/.config`) elsewhere.
 */
fun configRoot(
    env: Map<String, String> = System.getenv(),
    os: String = System.getProperty("os.name"),
    home: String = System.getProperty("user.home"),
): Path {
    val lower = os.lowercase()
    return when {
        lower.startsWith("windows") -> env["APPDATA"]?.takeIf { it.isNotEmpty() }?.let { Paths.get(it) } ?: Paths.get(home, "AppData", "Roaming")
        lower.startsWith("mac") -> Paths.get(home, "Library", "Application Support")
        else -> env["XDG_CONFIG_HOME"]?.takeIf { it.isNotEmpty() }?.let { Paths.get(it) } ?: Paths.get(home, ".config")
    }
}

/** Same directory as the VS Code extension's `sharedDataDirectory()`, so every editor reads one catalog. */
fun sharedDataDirectory(root: Path = configRoot()): Path = root.resolve(DIRECTORY_NAME)

fun sharedCatalogFile(dir: Path): Path = dir.resolve(CATALOG_FILE)

fun sharedLogoDirectory(dir: Path): Path = dir.resolve(LOGO_DIRECTORY)
