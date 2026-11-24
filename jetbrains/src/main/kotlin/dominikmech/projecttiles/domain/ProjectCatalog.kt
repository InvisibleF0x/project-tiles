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
    val actions: List<TileAction>? = null,
)

/** One change applied to many projects at once; a false `set…` flag or a null/empty field leaves that field alone. */
data class BulkPatch(
    val setCollection: Boolean = false,
    /** With [setCollection]: null takes the projects out of their collection. */
    val collectionId: String? = null,
    val setColor: Boolean = false,
    /** With [setColor]: null clears the colour. */
    val color: String? = null,
    /** "auto" or "none". */
    val logo: String? = null,
    /** Per element ("path", "description", "languages", "git"): a value overrides, null goes back to the global setting. */
    val show: Map<String, Boolean?> = emptyMap(),
    /** Appended to each project's own buttons. */
    val addActions: List<TileAction> = emptyList(),
)

/** In-memory catalog with all ordering and grouping rules; callers persist [snapshot] after mutations. */
class ProjectCatalog(data: CatalogData?, private val newId: () -> String) {
    private var collectionList: MutableList<Collection>
    private var projectList: MutableList<Project>
    private var actionList: List<TileAction>?

    init {
        val normalized = normalize(data ?: CatalogData())
        collectionList = normalized.collections.toMutableList()
        projectList = normalized.projects.toMutableList()
        actionList = normalized.actions
    }

    val projects: List<Project> get() = projectList
    val collections: List<Collection> get() = collectionList

    /** Buttons on every tile. */
    val actions: List<TileAction> get() = actionList.orEmpty()

    fun setActions(actions: List<TileAction>?) {
        actionList = cleanActions(actions)
    }

    fun snapshot(): CatalogData = CatalogData(1, collectionList.toList(), projectList.toList(), actionList?.toList())

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

    /** What [patch] turns [project] into; the caller saves it (logos may need files moved). */
    fun bulkInput(project: Project, patch: BulkPatch): ProjectInput {
        var input = ProjectInput(
            project.name, project.path, project.description, project.logo, project.languages,
            project.color, project.collectionId, project.show, project.actions,
        )
        if (patch.setCollection) input = input.copy(collectionId = patch.collectionId?.takeIf { getCollection(it) != null })
        if (patch.setColor) input = input.copy(color = patch.color)
        if (patch.logo == Logo.AUTO || patch.logo == Logo.NONE) input = input.copy(logo = Logo(patch.logo))
        if (patch.show.isNotEmpty()) {
            var show = project.show ?: TileVisibility()
            for ((element, value) in patch.show) {
                show = when (element) {
                    "path" -> show.copy(path = value)
                    "description" -> show.copy(description = value)
                    "languages" -> show.copy(languages = value)
                    "git" -> show.copy(git = value)
                    else -> show
                }
            }
            input = input.copy(show = show)
        }
        if (patch.addActions.isNotEmpty()) {
            val own = project.actions.orEmpty()
            input = input.copy(actions = own + patch.addActions.filter { a -> own.none { it.id == a.id } })
        }
        return input
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

    fun addCollection(name: String, color: String? = null, description: String? = null, actions: List<TileAction>? = null): Collection {
        val collection = cleanCollection(Collection(newId(), name, description, color, null, actions))
        collectionList.add(collection)
        return collection
    }

    /** A null [actions] keeps the collection's buttons; an empty list removes them. */
    fun updateCollection(id: String, name: String?, color: String?, description: String?, actions: List<TileAction>? = null): Collection? {
        val index = collectionList.indexOfFirst { it.id == id }
        if (index < 0) return null
        val current = collectionList[index]
        val merged = cleanCollection(current.copy(name = name ?: current.name, color = color, description = description, actions = actions ?: current.actions))
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
                collections += cleanCollection(c)
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
                        actions = p.actions,
                    ),
                )
            }
            return CatalogData(1, collections, projects, cleanActions(data.actions))
        }

        private fun cleanCollection(c: Collection) = Collection(
            id = c.id,
            name = c.name.trim().ifEmpty { "Collection" },
            description = c.description?.trim()?.ifEmpty { null },
            color = normalizeHexColor(c.color),
            collapsed = if (c.collapsed == true) true else null,
            actions = cleanActions(c.actions),
        )

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
                actions = cleanActions(raw.actions),
            )
        }

        /** Keeps buttons with a safe unique id, a name and a command, trimmed to sane lengths; null when none are left. */
        fun cleanActions(raw: List<TileAction>?): List<TileAction>? {
            if (raw == null) return null
            val actions = mutableListOf<TileAction>()
            for (a in raw) {
                if (actions.size >= ACTIONS_MAX) break
                if (!SAFE_ID.matches(a.id) || actions.any { it.id == a.id }) continue
                val name = a.name.trim().take(ACTION_NAME_MAX)
                val command = a.command.trim().take(ACTION_COMMAND_MAX)
                if (name.isNotEmpty() && command.isNotEmpty()) actions += TileAction(a.id, name, command)
            }
            return actions.ifEmpty { null }
        }

        fun baseName(path: String): String = path.trimEnd('\\', '/').split('\\', '/').lastOrNull()?.ifEmpty { null } ?: path

        fun pathKey(path: String): String = path.trimEnd('\\', '/').replace('\\', '/').lowercase()
    }
}
