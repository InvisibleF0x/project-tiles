package dominikmech.projecttiles.storage

import dominikmech.projecttiles.domain.CatalogData
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Writes go through a temp file + rename so a crash mid-write never corrupts the catalog. The
 * repository remembers the text it wrote last, so it can tell its own writes apart from another editor's.
 */
class CatalogRepository(val location: Path) {
    @Volatile
    private var lastText: String? = null

    @Synchronized
    fun load(): CatalogData {
        val text = try {
            Files.readString(location)
        } catch (_: IOException) {
            lastText = null
            return CatalogData()
        }
        lastText = text
        return parse(text)
    }

    /** Fresh data when something other than this repository wrote the file, else null. */
    @Synchronized
    fun loadIfChangedExternally(): CatalogData? {
        val text = try {
            Files.readString(location)
        } catch (_: IOException) {
            return null
        }
        if (text == lastText) return null
        lastText = text
        return parse(text)
    }

    @Synchronized
    fun save(data: CatalogData) {
        Files.createDirectories(location.parent)
        val text = prettyGson.toJson(data)
        val tmp = location.resolveSibling("${location.fileName}.${ProcessHandle.current().pid()}.tmp")
        Files.writeString(tmp, text)
        Files.move(tmp, location, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        lastText = text
    }

    private fun parse(text: String): CatalogData = try {
        parseCatalog(text)
    } catch (e: Exception) {
        throw IllegalStateException("Project Tiles: cannot parse $location: ${e.message}", e)
    }
}
