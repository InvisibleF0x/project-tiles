package dominikmech.projecttiles.storage

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dominikmech.projecttiles.domain.BulkPatch
import dominikmech.projecttiles.domain.CatalogData
import dominikmech.projecttiles.domain.Collection
import dominikmech.projecttiles.domain.Logo
import dominikmech.projecttiles.domain.Project
import dominikmech.projecttiles.domain.TileAction
import dominikmech.projecttiles.domain.TileVisibility

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
            actions = parseActions(o.get("actions")),
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
            show = o.get("show")?.asJsonObjectOrNull()?.let { parseVisibility(it) },
            actions = parseActions(o.get("actions")),
        )
    }
    return CatalogData(1, collections, projects, parseActions(root.get("actions")))
}

/** Tile buttons from a JSON array; entries that are not objects with string fields are skipped. */
fun parseActions(element: JsonElement?): List<TileAction>? {
    if (element == null || !element.isJsonArray) return null
    return element.asJsonArray.mapNotNull { e ->
        val o = e.asJsonObjectOrNull() ?: return@mapNotNull null
        TileAction(o.string("id") ?: return@mapNotNull null, o.string("name") ?: "", o.string("command") ?: "")
    }
}

/** A bulk change from the page: a key that is present (even as null) is applied, a missing one is left alone. */
fun parseBulkPatch(o: JsonObject): BulkPatch {
    val collection = o.get("collectionId")
    val color = o.get("color")
    val show = o.get("show")?.asJsonObjectOrNull()?.entrySet()?.mapNotNull { (key, value) ->
        when {
            value.isJsonNull -> key to null
            value.isJsonPrimitive && value.asJsonPrimitive.isBoolean -> key to value.asBoolean
            else -> null
        }
    }?.toMap().orEmpty()
    return BulkPatch(
        setCollection = collection != null,
        collectionId = collection?.stringOrNull(),
        setColor = color != null,
        color = color?.stringOrNull(),
        logo = o.string("logo"),
        show = show,
        addActions = parseActions(o.get("addActions")).orEmpty(),
    )
}

/** Only boolean values count; anything else means "follow the global setting". */
fun parseVisibility(o: JsonObject) = TileVisibility(
    path = o.boolean("path"),
    description = o.boolean("description"),
    languages = o.boolean("languages"),
    git = o.boolean("git"),
)

internal fun JsonElement.asJsonObjectOrNull(): JsonObject? = if (isJsonObject) asJsonObject else null

internal fun JsonElement.stringOrNull(): String? =
    if (isJsonPrimitive && asJsonPrimitive.isString) asString else null

internal fun JsonObject.string(key: String): String? = get(key)?.stringOrNull()

internal fun JsonObject.boolean(key: String): Boolean? =
    get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean }?.asBoolean

internal fun JsonObject.long(key: String): Long? =
    get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asLong

internal fun JsonObject.array(key: String): JsonArray = get(key)?.takeIf { it.isJsonArray }?.asJsonArray ?: JsonArray()
