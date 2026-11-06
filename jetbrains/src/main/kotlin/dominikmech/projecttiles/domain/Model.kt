package dominikmech.projecttiles.domain

import java.text.BreakIterator

// Field names and order match the projects.json written by the VS Code extension; null fields are omitted.

data class Logo(val kind: String, val value: String? = null) {
    companion object {
        const val NONE = "none"
        const val AUTO = "auto"
        const val EMOJI = "emoji"
        const val IMAGE = "image"
        val KINDS = setOf(NONE, AUTO, EMOJI, IMAGE)
    }
}

data class Project(
    val id: String,
    val name: String,
    /** Absolute path of the project folder (or a VS Code .code-workspace file). */
    val path: String,
    val description: String? = null,
    val logo: Logo? = null,
    /** Manual language override. Empty / null means "detect automatically". */
    val languages: List<String>? = null,
    /** Accent colour (#rgb / #rrggbb). Falls back to the collection colour when absent. */
    val color: String? = null,
    val collectionId: String? = null,
    /** Per-tile overrides of the global visibility settings; a null field follows the global setting. */
    val show: TileVisibility? = null,
)

data class TileVisibility(
    val path: Boolean? = null,
    val description: Boolean? = null,
    val languages: Boolean? = null,
    val git: Boolean? = null,
) {
    fun isEmpty() = path == null && description == null && languages == null && git == null
}

/** Whether an element is shown on a project's tile: its own override, else the global setting. */
fun isShown(override: Boolean?, globalDefault: Boolean): Boolean = override ?: globalDefault

data class Collection(
    val id: String,
    val name: String,
    val description: String? = null,
    val color: String? = null,
    val collapsed: Boolean? = null,
)

data class CatalogData(
    val version: Int = 1,
    /** List order is the display order. */
    val collections: List<Collection> = emptyList(),
    /** List order is the display order within each collection. */
    val projects: List<Project> = emptyList(),
)

const val LOGO_TEXT_MAX = 3

/** Trims [value] to at most [max] grapheme clusters, so a flag or a skin-toned emoji counts as one. */
fun clampGraphemes(value: String, max: Int): String {
    val boundaries = BreakIterator.getCharacterInstance()
    boundaries.setText(value)
    var end = 0
    repeat(max) {
        val next = boundaries.next()
        if (next == BreakIterator.DONE) return value
        end = next
    }
    return value.substring(0, end)
}

private val HEX_COLOR = Regex("^#(?:[0-9a-f]{3}|[0-9a-f]{6})$", RegexOption.IGNORE_CASE)

fun normalizeHexColor(value: String?): String? {
    val trimmed = value?.trim()
    if (trimmed.isNullOrEmpty()) return null
    val withHash = if (trimmed.startsWith("#")) trimmed else "#$trimmed"
    return if (HEX_COLOR.matches(withHash)) withHash.lowercase() else null
}

data class CommitInfo(val hash: String, val subject: String, val relativeDate: String, val author: String)

data class SyncInfo(
    val upstream: String,
    /** Local commits not on the upstream. */
    val ahead: Int,
    /** Upstream commits not merged locally. */
    val behind: Int,
    /** True when `git fetch` ran before counting, i.e. the numbers reflect the real remote. */
    val fetched: Boolean,
    /** True while a network fetch is still in progress for this entry. */
    val checking: Boolean? = null,
)

data class GitInfo(val branch: String, val commit: CommitInfo? = null, val sync: SyncInfo? = null)

data class LanguageShare(val name: String, val color: String, val percent: Double)

/** Why a project folder cannot be reached: its drive is not connected, or it was deleted or moved. */
object Unavailable {
    const val OFFLINE = "offline"
    const val DELETED = "deleted"
}

data class ProjectMetadata(
    val exists: Boolean,
    /** [Unavailable] reason when [exists] is false. An offline project keeps its last known git and language info. */
    val availability: String? = null,
    /** Null when the folder is not a git repository. */
    val git: GitInfo?,
    val languages: List<LanguageShare>,
    val autoLogoPath: String? = null,
    /** When the local part (git state, auto logo) was last refreshed (epoch ms). */
    val fetchedAt: Long = 0,
    /** When the language scan was last run (0 = never). */
    val languagesAt: Long = 0,
)
