package dominikmech.projecttiles.domain

/** Ids are UUIDs we generate; the check only has to rule out path separators and dots. */
val SAFE_ID = Regex("^[A-Za-z0-9_-]{1,64}$")

/** Stored logo file names are `<id>.<ext>` or `<id>.auto.<ext>`; nothing with separators. */
private val SAFE_FILE = Regex("^[A-Za-z0-9_-]{1,64}(\\.auto)?\\.[a-z0-9]{1,8}$", RegexOption.IGNORE_CASE)

data class ProjectInput(
    val name: String,
    val path: String,
    val description: String? = null,
    val logo: Logo? = null,
    val languages: List<String>? = null,
    val color: String? = null,
    val collectionId: String? = null,
    val show: TileVisibility? = null,
)

/** In-memory catalog with all ordering and grouping rules; callers persist [snapshot] after mutations. */
class ProjectCatalog(data: CatalogData?, private val newId: () -> String) {
    private var collectionList: MutableList<Collection>
    private var projectList: MutableList<Project>

    init {
        val normalized = normalize(data ?: CatalogData())
        collectionList = normalized.collections.toMutableList()
        projectList = normalized.projects.toMutableList()
    }

    val projects: List<Project> get() = projectList
    val collections: List<Collection> get() = collectionList

    fun snapshot(): CatalogData = CatalogData(1, collectionList.toList(), projectList.toList())

    fun getProject(id: String): Project? = projectList.find { it.id == id }

    fun getCollection(id: String): Collection? = collectionList.find { it.id == id }

    fun findProjectByPath(path: String): Project? {
        val key = pathKey(path)
        return projectList.find { pathKey(it.path) == key }
    }

    fun addProject(input: ProjectInput): Project = addProjectWithId(newId(), input)

    /** Adds a project under a caller-chosen id (used when a logo was imported before the project was saved). */
    fun addProjectWithId(id: String, input: ProjectInput): Project {
        require(getProject(id) == null) { "Project $id already exists" }
        val project = cleanProject(id, input)
        projectList.add(project)
        return project
    }

    /** Replaces every field of the project (a null field is cleared). */
    fun updateProject(id: String, input: ProjectInput): Project? {
        val index = projectList.indexOfFirst { it.id == id }
        if (index < 0) return null
        val updated = cleanProject(id, input)
        projectList[index] = updated
        return updated
    }

    fun removeProject(id: String): Boolean = projectList.removeIf { it.id == id }

    /** Moves a project into [collectionId] (null = no collection) at [index] within that collection's visible order. */
    fun moveProject(id: String, collectionId: String?, index: Int): Boolean {
        val project = getProject(id) ?: return false
        if (collectionId != null && collectionList.none { it.id == collectionId }) return false
        val others = projectList.filter { it.id != id }.toMutableList()
        val moved = project.copy(collectionId = collectionId)
        // Find the absolute position of the `index`-th sibling in the target collection.
        val siblings = others.filter { it.collectionId == collectionId }
        val anchor = siblings.getOrNull(index.coerceIn(0, siblings.size))
        val insertAt = if (anchor != null) others.indexOf(anchor) else others.size
        others.add(insertAt, moved)
        projectList = others
        return true
    }

    fun addCollection(name: String, color: String? = null, description: String? = null): Collection {
        val collection = Collection(
            id = newId(),
            name = name.trim().ifEmpty { "Collection" },
            description = description?.trim()?.ifEmpty { null },
            color = normalizeHexColor(color),
        )
        collectionList.add(collection)
        return collection
    }

    fun updateCollection(id: String, name: String?, color: String?, description: String?): Collection? {
        val index = collectionList.indexOfFirst { it.id == id }
        if (index < 0) return null
        val current = collectionList[index]
        val merged = current.copy(
            name = (name ?: current.name).trim().ifEmpty { "Collection" },
            color = normalizeHexColor(color),
            description = description?.trim()?.ifEmpty { null },
        )
        collectionList[index] = merged
        return merged
    }

    fun setCollapsed(id: String, collapsed: Boolean): Collection? {
        val index = collectionList.indexOfFirst { it.id == id }
        if (index < 0) return null
        val updated = collectionList[index].copy(collapsed = if (collapsed) true else null)
        collectionList[index] = updated
        return updated
    }

    /** Removes the collection; its projects become uncollected (they are not deleted). */
    fun removeCollection(id: String): Boolean {
        if (!collectionList.removeIf { it.id == id }) return false
        projectList = projectList.map { if (it.collectionId == id) it.copy(collectionId = null) else it }.toMutableList()
        return true
    }

    fun moveCollection(id: String, index: Int): Boolean {
        val current = collectionList.indexOfFirst { it.id == id }
        if (current < 0) return false
        val collection = collectionList.removeAt(current)
        collectionList.add(index.coerceIn(0, collectionList.size), collection)
        return true
    }

    companion object {
        /**
         * Drops dangling collection references, duplicates and anything malformed (bad colours,
         * over-long logos, unsafe ids) so hand-edited or tampered files never reach the UI unchecked.
         */
        fun normalize(data: CatalogData): CatalogData {
            val collections = mutableListOf<Collection>()
            for (c in data.collections) {
                if (!SAFE_ID.matches(c.id) || collections.any { it.id == c.id }) continue
                collections += Collection(
                    id = c.id,
                    name = c.name.trim().ifEmpty { "Collection" },
                    description = c.description?.trim()?.ifEmpty { null },
                    color = normalizeHexColor(c.color),
                    collapsed = if (c.collapsed == true) true else null,
                )
            }
            val collectionIds = collections.map { it.id }.toSet()
            val projects = mutableListOf<Project>()
            for (p in data.projects) {
                if (!SAFE_ID.matches(p.id) || p.path.isEmpty() || projects.any { it.id == p.id }) continue
                val logo = p.logo?.takeIf { it.kind in Logo.KINDS }
                    ?.takeUnless { it.kind == Logo.IMAGE && !SAFE_FILE.matches(it.value ?: "") }
                projects += cleanProject(
                    p.id,
                    ProjectInput(
                        name = p.name,
                        path = p.path,
                        description = p.description,
                        logo = logo,
                        languages = p.languages,
                        color = p.color,
                        collectionId = p.collectionId?.takeIf { it in collectionIds },
                        show = p.show,
                    ),
                )
            }
            return CatalogData(1, collections, projects)
        }

        private fun cleanProject(id: String, raw: ProjectInput): Project {
            val logo = when {
                raw.logo == null || raw.logo.kind == Logo.NONE -> null
                raw.logo.kind == Logo.EMOJI ->
                    clampGraphemes(raw.logo.value?.trim() ?: "", LOGO_TEXT_MAX).ifEmpty { null }?.let { Logo(Logo.EMOJI, it) }
                raw.logo.kind == Logo.AUTO -> Logo(Logo.AUTO)
                else -> raw.logo
            }
            return Project(
                id = id,
                name = raw.name.trim().ifEmpty { baseName(raw.path) },
                path = raw.path,
                description = raw.description?.trim()?.ifEmpty { null },
                logo = logo,
                languages = raw.languages?.map { it.trim() }?.filter { it.isNotEmpty() }?.ifEmpty { null },
                color = normalizeHexColor(raw.color),
                collectionId = raw.collectionId?.ifEmpty { null },
                show = raw.show?.takeUnless { it.isEmpty() },
            )
        }

        fun baseName(path: String): String = path.trimEnd('\\', '/').split('\\', '/').lastOrNull()?.ifEmpty { null } ?: path

        fun pathKey(path: String): String = path.trimEnd('\\', '/').replace('\\', '/').lowercase()
    }
}
