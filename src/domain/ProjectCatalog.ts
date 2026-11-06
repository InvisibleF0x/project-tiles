import {
  CatalogData,
  Collection,
  LOGO_TEXT_MAX,
  Project,
  TILE_ELEMENTS,
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
}

export interface CollectionPatch {
  name?: string | undefined;
  description?: string | undefined;
  color?: string | undefined;
  collapsed?: boolean | undefined;
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
      const collection: Collection = { id: c.id, name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Collection' };
      const color = normalizeHexColor(c.color);
      if (color) {
        collection.color = color;
      }
      if (typeof c.description === 'string' && c.description.trim()) {
        collection.description = c.description.trim();
      }
      if (c.collapsed === true) {
        collection.collapsed = true;
      }
      collections.push(collection);
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
        }),
      );
    }
    return { version: 1, collections, projects };
  }

  snapshot(): CatalogData {
    return { version: 1, collections: [...this.data.collections], projects: [...this.data.projects] };
  }

  get projects(): readonly Project[] {
    return this.data.projects;
  }

  get collections(): readonly Collection[] {
    return this.data.collections;
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

  addCollection(name: string, color?: string, description?: string): Collection {
    const collection: Collection = { id: this.newId(), name: name.trim() || 'Collection' };
    const normalized = normalizeHexColor(color);
    if (normalized) {
      collection.color = normalized;
    }
    if (description?.trim()) {
      collection.description = description.trim();
    }
    this.data.collections.push(collection);
    return collection;
  }

  updateCollection(id: string, patch: CollectionPatch): Collection | undefined {
    const index = this.data.collections.findIndex((c) => c.id === id);
    if (index < 0) {
      return undefined;
    }
    const current = this.data.collections[index]!;
    const merged: Collection = {
      id,
      name: patch.name ?? current.name,
      description: 'description' in patch ? patch.description?.trim() : current.description,
      color: 'color' in patch ? normalizeHexColor(patch.color) : current.color,
      collapsed: 'collapsed' in patch ? patch.collapsed : current.collapsed,
    } as Collection;
    if (!merged.color) {
      delete merged.color;
    }
    if (!merged.description) {
      delete merged.description;
    }
    if (!merged.collapsed) {
      delete merged.collapsed;
    }
    merged.name = merged.name.trim() || 'Collection';
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

  private static baseName(path: string): string {
    const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  private static pathKey(path: string): string {
    return path.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  }
}
