package dominikmech.projecttiles.services

import com.google.gson.JsonParser
import dominikmech.projecttiles.domain.LanguageShare
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import kotlin.math.roundToLong

data class LanguageDefinition(val name: String, val color: String, val extensions: List<String>)

object LanguageTable {
    val languages: List<LanguageDefinition>
    val unknownColor: String
    private val byName: Map<String, LanguageDefinition>
    private val byExtension: Map<String, LanguageDefinition>

    init {
        val text = LanguageTable::class.java.getResourceAsStream("/projecttiles/shared/languages.json")!!.use { it.readBytes().decodeToString() }
        val root = JsonParser.parseString(text).asJsonObject
        unknownColor = root.get("unknownColor").asString
        languages = root.getAsJsonArray("languages").map { e ->
            val o = e.asJsonObject
            LanguageDefinition(o.get("name").asString, o.get("color").asString, o.getAsJsonArray("extensions").map { it.asString })
        }
        byName = languages.associateBy { it.name.lowercase() }
        byExtension = buildMap { for (l in languages) for (ext in l.extensions) put(ext, l) }
    }

    fun byName(name: String): LanguageDefinition? = byName[name.lowercase()]

    fun forFileName(fileName: String): LanguageDefinition? {
        val lower = fileName.lowercase()
        return when {
            lower == "dockerfile" || lower.startsWith("dockerfile.") -> byExtension["dockerfile"]
            lower == "makefile" -> byExtension["mk"]
            lower == "cmakelists.txt" -> byExtension["cmake"]
            lower.endsWith(".blade.php") -> byExtension["blade.php"]
            lower.endsWith(".d.ts") -> byExtension["ts"]
            else -> {
                val dot = lower.lastIndexOf('.')
                if (dot <= 0) null else byExtension[lower.substring(dot + 1)]
            }
        }
    }
}

/**
 * Walks the project tree (breadth-first, bounded by depth and file count, skipping ignored
 * directories) and sums file sizes per language, like GitHub does.
 */
class LanguageDetector(ignoreDirs: Collection<String>, private val maxFiles: Int, private val maxDepth: Int = 12) {
    private val ignore = ignoreDirs.map { it.lowercase() }.toSet()

    fun detect(folder: Path): List<LanguageShare> {
        val bytes = LinkedHashMap<LanguageDefinition, Long>()
        val queue = ArrayDeque<Pair<Path, Int>>().apply { add(folder to 0) }
        var scanned = 0
        while (queue.isNotEmpty() && scanned < maxFiles) {
            val (dir, depth) = queue.removeFirst()
            val entries = try {
                Files.newDirectoryStream(dir).use { it.toList() }
            } catch (_: IOException) {
                continue
            }
            for (entry in entries) {
                if (scanned >= maxFiles) break
                val attrs = try {
                    Files.readAttributes(entry, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
                } catch (_: IOException) {
                    continue
                }
                val name = entry.fileName.toString()
                if (attrs.isDirectory) {
                    if (depth < maxDepth && name.lowercase() !in ignore) queue.add(entry to depth + 1)
                    continue
                }
                if (!attrs.isRegularFile) continue
                val language = LanguageTable.forFileName(name) ?: continue
                scanned++
                bytes.merge(language, maxOf(attrs.size(), 1L), Long::plus)
            }
        }
        return toShares(bytes)
    }

    companion object {
        fun toShares(bytes: Map<LanguageDefinition, Long>): List<LanguageShare> {
            val total = bytes.values.sum()
            if (total == 0L) return emptyList()
            return bytes.entries.sortedByDescending { it.value }.map { (language, size) ->
                LanguageShare(language.name, language.color, (size * 1000.0 / total).roundToLong() / 10.0)
            }
        }

        /** Turns a manual override list ("C#, ShaderLab") into equally weighted shares with palette colours. */
        fun sharesFromNames(names: List<String>): List<LanguageShare> {
            val unique = LinkedHashMap<String, Pair<String, String>>()
            for (raw in names) {
                val name = raw.trim().ifEmpty { null } ?: continue
                val known = LanguageTable.byName(name)
                unique.putIfAbsent((known?.name ?: name).lowercase(), (known?.name ?: name) to (known?.color ?: LanguageTable.unknownColor))
            }
            val percent = if (unique.isEmpty()) 0.0 else (1000.0 / unique.size).roundToLong() / 10.0
            return unique.values.map { (name, color) -> LanguageShare(name, color, percent) }
        }
    }
}
