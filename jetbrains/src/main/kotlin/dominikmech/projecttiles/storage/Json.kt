package dominikmech.projecttiles.storage

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dominikmech.projecttiles.domain.CatalogData
import dominikmech.projecttiles.domain.Collection
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project

/** Pretty-printed like `JSON.stringify(data, null, 2)`; null fields are omitted. */
val prettyGson: Gson = GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create()
val compactGson: Gson = GsonBuilder().disableHtmlEscaping().create()

/**
 * Reads projects.json without trusting its shape: anything of the wrong type becomes null or is
 * skipped, and ProjectCatalog.normalize then applies the semantic checks. (Gson's reflective
 * binding would happily put nulls into non-null Kotlin fields.)
 */
fun parseCatalog(text: String): CatalogData {
    val root = JsonParser.parseString(text).asJsonObjectOrNull() ?: throw IllegalArgumentException("not a JSON object")
    val collections = root.array("collections").mapNotNull { e ->
        val o = e.asJsonObjectOrNull() ?: return@mapNotNull null
        Collection(
            id = o.string("id") ?: return@mapNotNull null,
            name = o.string("name") ?: "",
            description = o.string("description"),
            color = o.string("color"),
            collapsed = o.boolean("collapsed"),
        )
    }
    val projects = root.array("projects").mapNotNull { e ->
        val o = e.asJsonObjectOrNull() ?: return@mapNotNull null
        val logo = o.get("logo")?.asJsonObjectOrNull()?.let { l -> l.string("kind")?.let { Logo(it, l.string("value")) } }
        Project(
            id = o.string("id") ?: return@mapNotNull null,
            name = o.string("name") ?: "",
            path = o.string("path") ?: return@mapNotNull null,
            description = o.string("description"),
            logo = logo,
            languages = o.get("languages")?.takeIf { it.isJsonArray }?.asJsonArray?.mapNotNull { it.stringOrNull() },
            color = o.string("color"),
            collectionId = o.string("collectionId"),
        )
    }
    return CatalogData(1, collections, projects)
}

internal fun JsonElement.asJsonObjectOrNull(): JsonObject? = if (isJsonObject) asJsonObject else null

internal fun JsonElement.stringOrNull(): String? =
    if (isJsonPrimitive && asJsonPrimitive.isString) asString else null

internal fun JsonObject.string(key: String): String? = get(key)?.stringOrNull()

internal fun JsonObject.boolean(key: String): Boolean? =
    get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean

internal fun JsonObject.long(key: String): Long? =
    get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asLong

internal fun JsonObject.array(key: String): JsonArray = get(key)?.takeIf { it.isJsonArray }?.asJsonArray ?: JsonArray()
