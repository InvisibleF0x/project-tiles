import {
  ACTION_COMMAND_MAX,
  ACTION_NAME_MAX,
  ACTIONS_MAX,
  CatalogData,
  Collection,
  LOGO_TEXT_MAX,
  Project,
  TILE_ELEMENTS,
  TileAction,
  TileElement,
  TileVisibility,
  clampGraphemes,
  emptyCatalog,
  normalizeHexColor,
} from './model';

export type IdGenerator = () => string;

/** Ids are UUIDs we generate; the check only has to rule out path separators and dots. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Stored logo file names are `<id>.<ext>` or `<id>.auto.<ext>`; nothing with separators. */
const SAFE_FILE = /^[A-Za-z0-9_-]{1,64}(\.auto)?\.[a-z0-9]{1,8}$/i;
const LOGO_KINDS = new Set(['none', 'auto', 'emoji', 'image']);

export interface ProjectInput {
  name: string;
  path: string;
  description?: string | undefined;
  logo?: Project['logo'] | undefined;
  languages?: string[] | undefined;
  color?: string | undefined;
  collectionId?: string | undefined;
  show?: TileVisibility | undefined;
  actions?: TileAction[] | undefined;
}

export interface CollectionPatch {
  name?: string | undefined;
  description?: string | undefined;
  color?: string | undefined;
  collapsed?: boolean | undefined;
  actions?: TileAction[] | undefined;
}

/** One change applied to many projects at once; a missing key leaves that field alone. */
export interface BulkPatch {
  /** `null` takes the projects out of their collection. */
  collectionId?: string | null;
  /** `null` clears the colour, so the collection colour shows. */
  color?: string | null;
  logo?: 'auto' | 'none';
  /** `null` for an element goes back to the global setting. */
  show?: Partial<Record<TileElement, boolean | null>>;
  /** Appended to each project's own buttons. */
  addActions?: TileAction[];
}

/**
 * In-memory catalog with all ordering / grouping rules. It knows nothing about
 * persistence or the UI; callers persist `data` after mutations.
 */
export class ProjectCatalog {
  private data: CatalogData;

  constructor(data: CatalogData | undefined, private readonly newId: IdGenerator) {
    this.data = ProjectCatalog.normalize(data ?? emptyCatalog());
  }

  /**
   * Drops dangling collection references, duplicates and anything malformed
   * (bad colours, over-long logos, wrong types) so hand-edited or tampered
   * files never reach the UI unchecked.
   */
  static normalize(data: CatalogData): CatalogData {
    const collections: Collection[] = [];
    for (const c of data.collections) {
      if (!c || typeof c.id !== 'string' || !SAFE_ID.test(c.id) || collections.some((x) => x.id === c.id)) {
        continue;
      }
      collections.push(
        ProjectCatalog.cleanCollection({
          id: c.id,
          name: typeof c.name === 'string' ? c.name : '',
          description: typeof c.description === 'string' ? c.description : undefined,
          color: typeof c.color === 'string' ? c.color : undefined,
          collapsed: c.collapsed === true,
          actions: c.actions,
        }),
      );
    }
    const collectionIds = new Set(collections.map((c) => c.id));
    const projects: Project[] = [];
    for (const p of data.projects) {
      if (!p || typeof p.id !== 'string' || !SAFE_ID.test(p.id) || typeof p.path !== 'string' || !p.path || projects.some((x) => x.id === p.id)) {
        continue;
      }
      const logo = p.logo && typeof p.logo === 'object' && LOGO_KINDS.has(p.logo.kind) ? p.logo : undefined;
      projects.push(
        ProjectCatalog.cleanProject({
          id: p.id,
          name: typeof p.name === 'string' ? p.name : '',
          path: p.path,
          description: typeof p.description === 'string' ? p.description : undefined,
          logo: logo?.kind === 'image' && !SAFE_FILE.test(logo.value ?? '') ? undefined : logo,
          languages: Array.isArray(p.languages) ? p.languages.filter((l): l is string => typeof l === 'string') : undefined,
          color: typeof p.color === 'string' ? p.color : undefined,
          collectionId: typeof p.collectionId === 'string' && collectionIds.has(p.collectionId) ? p.collectionId : undefined,
          show: p.show && typeof p.show === 'object' ? p.show : undefined,
          actions: p.actions,
        }),
      );
    }
    const normalized: CatalogData = { version: 1, collections, projects };
    const actions = ProjectCatalog.cleanActions(data.actions);
    if (actions) {
      normalized.actions = actions;
    }
    return normalized;
  }

  snapshot(): CatalogData {
    const snapshot: CatalogData = { version: 1, collections: [...this.data.collections], projects: [...this.data.projects] };
    if (this.data.actions) {
      snapshot.actions = [...this.data.actions];
    }
    return snapshot;
  }

  get projects(): readonly Project[] {
    return this.data.projects;
  }

  get collections(): readonly Collection[] {
    return this.data.collections;
  }

  /** Buttons on every tile. */
  get actions(): readonly TileAction[] {
    return this.data.actions ?? [];
  }

  setActions(actions: readonly TileAction[] | undefined): void {
    const cleaned = ProjectCatalog.cleanActions(actions);
    if (cleaned) {
      this.data.actions = cleaned;
    } else {
      delete this.data.actions;
    }
  }

  getProject(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  findProjectByPath(path: string): Project | undefined {
    const key = ProjectCatalog.pathKey(path);
    return this.data.projects.find((p) => ProjectCatalog.pathKey(p.path) === key);
  }

  addProject(input: ProjectInput): Project {
    return this.addProjectWithId(this.newId(), input);
  }

  /** Adds a project under a caller-chosen id (used when a logo was imported before the project was saved). */
  addProjectWithId(id: string, input: ProjectInput): Project {
    if (this.getProject(id)) {
      throw new Error(`Project ${id} already exists`);
    }
    const project = ProjectCatalog.cleanProject({ ...input, id });
    this.data.projects.push(project);
    return project;
  }

  getCollection(id: string): Collection | undefined {
    return this.data.collections.find((c) => c.id === id);
  }

  updateProject(id: string, patch: Partial<ProjectInput>): Project | undefined {
    const index = this.data.projects.findIndex((p) => p.id === id);
    if (index < 0) {
      return undefined;
    }
    // Keys present in `patch` win even when their value is undefined (that is how a field is cleared).
    const updated = ProjectCatalog.cleanProject({ ...this.data.projects[index]!, ...patch, id });
    this.data.projects[index] = updated;
    return updated;
  }

  /** What `patch` turns `project` into; the caller saves it (logos may need files moved). */
  bulkInput(project: Project, patch: BulkPatch): ProjectInput {
    const input: ProjectInput = { ...project };
    if (patch.collectionId !== undefined) {
      input.collectionId = patch.collectionId !== null && this.getCollection(patch.collectionId) ? patch.collectionId : undefined;
    }
    if (patch.color !== undefined) {
      input.color = patch.color ?? undefined;
    }
    if (patch.logo) {
      input.logo = { kind: patch.logo };
    }
    if (patch.show) {
      const show: TileVisibility = { ...project.show };
      for (const element of TILE_ELEMENTS) {
        const value = patch.show[element];
        if (value === null) {
          delete show[element];
        } else if (typeof value === 'boolean') {
          show[element] = value;
        }
      }
      input.show = show;
    }
    if (patch.addActions?.length) {
      const own = project.actions ?? [];
      input.actions = [...own, ...patch.addActions.filter((a) => !own.some((o) => o.id === a.id))];
    }
    return input;
  }

  removeProject(id: string): boolean {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    return this.data.projects.length !== before;
  }

  /**
   * Moves a project into `collectionId` (undefined = no collection) at `index`
   * within that collection's visible order.
   */
  moveProject(id: string, collectionId: string | undefined, index: number): boolean {
    const project = this.getProject(id);
    if (!project) {
      return false;
    }
    if (collectionId !== undefined && !this.data.collections.some((c) => c.id === collectionId)) {
      return false;
    }
    const others = this.data.projects.filter((p) => p.id !== id);
    const moved: Project = { ...project };
    if (collectionId === undefined) {
      delete moved.collectionId;
    } else {
      moved.collectionId = collectionId;
    }

    // Find the absolute position of the `index`-th sibling in the target collection.
    const siblings = others.filter((p) => p.collectionId === collectionId);
    const clamped = Math.max(0, Math.min(index, siblings.length));
    const anchor = siblings[clamped];
    const insertAt = anchor ? others.indexOf(anchor) : others.length;
    others.splice(insertAt, 0, moved);
    this.data.projects = others;
    return true;
  }

  addCollection(name: string, color?: string, description?: string, actions?: TileAction[]): Collection {
    const collection = ProjectCatalog.cleanCollection({ id: this.newId(), name, description, color, collapsed: false, actions });
    this.data.collections.push(collection);
    return collection;
  }

  updateCollection(id: string, patch: CollectionPatch): Collection | undefined {
    const index = this.data.collections.findIndex((c) => c.id === id);
    if (index < 0) {
      return undefined;
    }
    const current = this.data.collections[index]!;
    const merged = ProjectCatalog.cleanCollection({
      id,
      name: patch.name ?? current.name,
      description: 'description' in patch ? patch.description : current.description,
      color: 'color' in patch ? patch.color : current.color,
      collapsed: 'collapsed' in patch ? patch.collapsed === true : current.collapsed === true,
      actions: 'actions' in patch ? patch.actions : current.actions,
    });
    this.data.collections[index] = merged;
    return merged;
  }

  /** Removes the collection; its projects become uncollected (they are not deleted). */
  removeCollection(id: string): boolean {
    const before = this.data.collections.length;
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    if (this.data.collections.length === before) {
      return false;
    }
    this.data.projects = this.data.projects.map((p) => {
      if (p.collectionId !== id) {
        return p;
      }
      const { collectionId: _dropped, ...rest } = p;
      return rest;
    });
    return true;
  }

  moveCollection(id: string, index: number): boolean {
    const current = this.data.collections.findIndex((c) => c.id === id);
    if (current < 0) {
      return false;
    }
    const collection = this.data.collections.splice(current, 1)[0]!;
    const clamped = Math.max(0, Math.min(index, this.data.collections.length));
    this.data.collections.splice(clamped, 0, collection);
    return true;
  }

  /** Projects grouped in display order; the last group (`collection: undefined`) holds uncollected projects. */
  grouped(): Array<{ collection: Collection | undefined; projects: Project[] }> {
    const groups: Array<{ collection: Collection | undefined; projects: Project[] }> = this.data.collections.map((collection) => ({
      collection,
      projects: this.data.projects.filter((p) => p.collectionId === collection.id),
    }));
    groups.push({ collection: undefined, projects: this.data.projects.filter((p) => p.collectionId === undefined) });
    return groups;
  }

  /** Field order matches the Kotlin model, so both editions write byte-identical JSON. */
  private static cleanCollection(raw: {
    id: string;
    name: string;
    description: string | undefined;
    color: string | undefined;
    collapsed: boolean;
    actions: unknown;
  }): Collection {
    const collection: Collection = { id: raw.id, name: raw.name.trim() || 'Collection' };
    const description = raw.description?.trim();
    if (description) {
      collection.description = description;
    }
    const color = normalizeHexColor(raw.color);
    if (color) {
      collection.color = color;
    }
    if (raw.collapsed) {
      collection.collapsed = true;
    }
    const actions = ProjectCatalog.cleanActions(raw.actions);
    if (actions) {
      collection.actions = actions;
    }
    return collection;
  }

  private static cleanProject(raw: ProjectInput & { id: string }): Project {
    const project: Project = { id: raw.id, name: raw.name.trim() || ProjectCatalog.baseName(raw.path), path: raw.path };
    const description = raw.description?.trim();
    if (description) {
      project.description = description;
    }
    if (raw.logo?.kind === 'emoji') {
      const value = clampGraphemes(raw.logo.value?.trim() ?? '', LOGO_TEXT_MAX);
      if (value) {
        project.logo = { kind: 'emoji', value };
      }
    } else if (raw.logo && raw.logo.kind !== 'none') {
      project.logo = raw.logo;
    }
    const languages = (raw.languages ?? []).map((l) => l.trim()).filter(Boolean);
    if (languages.length > 0) {
      project.languages = languages;
    }
    const color = normalizeHexColor(raw.color);
    if (color) {
      project.color = color;
    }
    if (raw.collectionId) {
      project.collectionId = raw.collectionId;
    }
    const show = ProjectCatalog.cleanVisibility(raw.show);
    if (show) {
      project.show = show;
    }
    const actions = ProjectCatalog.cleanActions(raw.actions);
    if (actions) {
      project.actions = actions;
    }
    return project;
  }

  /** Keeps only boolean overrides of known elements; `undefined` when nothing is overridden. */
  private static cleanVisibility(raw: TileVisibility | undefined): TileVisibility | undefined {
    const show: TileVisibility = {};
    for (const element of TILE_ELEMENTS) {
      const value = raw?.[element];
      if (typeof value === 'boolean') {
        show[element] = value;
      }
    }
    return Object.keys(show).length > 0 ? show : undefined;
  }

  /** Keeps buttons with a safe unique id, a name and a command, trimmed to sane lengths; `undefined` when none are left. */
  static cleanActions(raw: unknown): TileAction[] | undefined {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const actions: TileAction[] = [];
    for (const a of raw as Array<Partial<TileAction> | null>) {
      if (actions.length >= ACTIONS_MAX) {
        break;
      }
      if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !SAFE_ID.test(a.id) || actions.some((x) => x.id === a.id)) {
        continue;
      }
      const name = typeof a.name === 'string' ? a.name.trim().slice(0, ACTION_NAME_MAX) : '';
      const command = typeof a.command === 'string' ? a.command.trim().slice(0, ACTION_COMMAND_MAX) : '';
      if (name && command) {
        actions.push({ id: a.id, name, command });
      }
    }
    return actions.length > 0 ? actions : undefined;
  }

  static baseName(path: string): string {
    const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  static pathKey(path: string): string {
    return path.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  }
}
