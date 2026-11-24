import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Collection, Logo, Project, ProjectMetadata, TileAction, effectiveActions } from '../domain/model';
import { BulkPatch, ProjectCatalog, ProjectInput } from '../domain/ProjectCatalog';
import { CatalogRepository } from '../storage/CatalogRepository';
import { LogoStore } from './logo/LogoStore';
import { MetadataService } from './MetadataService';

export interface ProjectSave extends ProjectInput {
  /** For `logo.kind === 'image'`, `logo.value` may be an absolute path of a file to import. */
  logo?: Logo;
}

/**
 * Application service: the single place that mutates the catalog, persists it
 * and keeps the logo store consistent. The webview and commands only talk to
 * this class, never to the repository directly.
 */
export class ProjectService {
  private readonly events = new EventEmitter();
  private catalog = new ProjectCatalog(undefined, randomUUID);
  private loaded: Promise<void> | undefined;

  constructor(
    private readonly repository: CatalogRepository,
    readonly logos: LogoStore,
    readonly metadata: MetadataService,
  ) {}

  /** Fires after every persisted change. */
  onDidChange(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  async ensureLoaded(): Promise<void> {
    this.loaded ??= this.repository.load().then((data) => {
      this.catalog = new ProjectCatalog(data, randomUUID);
    });
    await this.loaded;
  }

  /**
   * Starts following the data file so changes made in another editor window
   * (or by hand) show up here. Returns a disposer.
   */
  watchExternalChanges(): () => void {
    return this.repository.watch(() => void this.reloadIfChangedExternally());
  }

  /** Picks up changes another window made while nothing here was watching. */
  async syncFromDisk(): Promise<void> {
    await this.ensureLoaded();
    await this.reloadIfChangedExternally();
  }

  private async reloadIfChangedExternally(): Promise<void> {
    if (!this.loaded) {
      return; // nothing in memory yet; the next ensureLoaded() reads the fresh file anyway
    }
    try {
      const data = await this.repository.loadIfChangedExternally();
      if (data) {
        this.catalog = new ProjectCatalog(data, randomUUID);
        this.events.emit('change');
      }
    } catch {
      /* half-written or invalid file: keep the current state, the next change will retry */
    }
  }

  get dataFile(): string {
    return this.repository.location;
  }

  get projects(): readonly Project[] {
    return this.catalog.projects;
  }

  get collections(): readonly Collection[] {
    return this.catalog.collections;
  }

  /** Buttons on every tile. */
  get actions(): readonly TileAction[] {
    return this.catalog.actions;
  }

  getProject(id: string): Project | undefined {
    return this.catalog.getProject(id);
  }

  /** The buttons a project's tile shows, in display order. */
  actionsFor(project: Project): TileAction[] {
    const collection = project.collectionId ? this.catalog.getCollection(project.collectionId) : undefined;
    return effectiveActions(this.catalog.actions, collection, project);
  }

  findByPath(folder: string): Project | undefined {
    return this.catalog.findProjectByPath(folder);
  }

  newId(): string {
    return randomUUID();
  }

  /** Creates (when `id` is unknown) or updates a project, importing a picked logo image if needed. */
  async saveProject(id: string, input: ProjectSave): Promise<Project> {
    // `logo: undefined` (not a missing key) so that an update really clears a previous logo.
    const cleaned: ProjectInput = { ...input, logo: await this.materializeLogo(id, input.logo) };
    const existing = this.catalog.getProject(id);
    const saved = existing ? this.catalog.updateProject(id, cleaned)! : this.catalog.addProjectWithId(id, cleaned);
    const computedChanged = existing?.show?.git !== saved.show?.git || existing?.show?.languages !== saved.show?.languages;
    if (!existing || existing.path !== saved.path || !sameList(existing.languages, saved.languages) || existing.logo?.kind !== saved.logo?.kind || computedChanged) {
      this.metadata.invalidate(saved.path);
    }
    await this.persist();
    return saved;
  }

  /** Adds every folder that is not on the dashboard yet; returns how many were added. */
  async addFolders(folders: readonly string[], collectionId?: string): Promise<number> {
    const target = collectionId && this.catalog.getCollection(collectionId) ? collectionId : undefined;
    let added = 0;
    for (const folder of folders) {
      if (this.catalog.findProjectByPath(folder)) {
        continue;
      }
      const project = this.catalog.addProject({ name: path.basename(folder), path: folder, logo: { kind: 'auto' }, collectionId: target });
      this.metadata.invalidate(project.path);
      added++;
    }
    if (added > 0) {
      await this.persist();
    }
    return added;
  }

  /** Applies one change to several projects and saves once. */
  async bulkUpdate(ids: readonly string[], patch: BulkPatch): Promise<void> {
    let changed = false;
    for (const id of ids) {
      const project = this.catalog.getProject(id);
      if (!project) {
        continue;
      }
      const input = this.catalog.bulkInput(project, patch);
      const saved = this.catalog.updateProject(id, { ...input, logo: patch.logo ? await this.materializeLogo(id, input.logo) : project.logo })!;
      if (project.logo?.kind !== saved.logo?.kind || project.show?.git !== saved.show?.git || project.show?.languages !== saved.show?.languages) {
        this.metadata.invalidate(saved.path);
      }
      changed = true;
    }
    if (changed) {
      await this.persist();
    }
  }

  async removeProjects(ids: readonly string[]): Promise<void> {
    let changed = false;
    for (const id of ids) {
      if (this.catalog.removeProject(id)) {
        await this.logos.remove(id);
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  async removeProject(id: string): Promise<void> {
    await this.removeProjects([id]);
  }

  async saveGlobalActions(actions: readonly TileAction[]): Promise<void> {
    this.catalog.setActions(actions);
    await this.persist();
  }

  async moveProject(id: string, collectionId: string | undefined, index: number): Promise<void> {
    if (this.catalog.moveProject(id, collectionId, index)) {
      await this.persist();
    }
  }

  async saveCollection(
    id: string | undefined,
    name: string,
    color: string | undefined,
    description: string | undefined,
    actions?: TileAction[],
  ): Promise<Collection> {
    const existing = id ? this.catalog.getCollection(id) : undefined;
    const saved = existing
      ? this.catalog.updateCollection(existing.id, { name, color, description, ...(actions ? { actions } : {}) })!
      : this.catalog.addCollection(name, color, description, actions);
    await this.persist();
    return saved;
  }

  async removeCollection(id: string): Promise<void> {
    if (this.catalog.removeCollection(id)) {
      await this.persist();
    }
  }

  async moveCollection(id: string, index: number): Promise<void> {
    if (this.catalog.moveCollection(id, index)) {
      await this.persist();
    }
  }

  async toggleCollection(id: string, collapsed: boolean): Promise<void> {
    if (this.catalog.updateCollection(id, { collapsed })) {
      await this.persist();
    }
  }

  /** Imports a user-picked image for `id`; returns the stored file name. */
  importLogo(id: string, sourceFile: string): Promise<string> {
    return this.logos.importImage(id, sourceFile);
  }

  /** Resolves the file that should be rendered as the project's logo, if any. */
  logoFile(project: Project, meta: ProjectMetadata | undefined): string | undefined {
    if (project.logo?.kind === 'image' && project.logo.value) {
      return this.logos.resolve(project.logo.value);
    }
    if (project.logo?.kind === 'auto' && meta?.autoLogoPath && this.logos.contains(meta.autoLogoPath)) {
      return meta.autoLogoPath;
    }
    return undefined;
  }

  private async materializeLogo(id: string, logo: Logo | undefined): Promise<Logo | undefined> {
    if (!logo || logo.kind === 'none') {
      await this.logos.remove(id);
      return undefined;
    }
    if (logo.kind === 'image') {
      if (!logo.value) {
        return undefined;
      }
      if (path.isAbsolute(logo.value)) {
        return { kind: 'image', value: await this.logos.importImage(id, logo.value) };
      }
      return logo;
    }
    if (logo.kind === 'emoji') {
      await this.logos.remove(id);
      return logo.value?.trim() ? { kind: 'emoji', value: logo.value.trim() } : undefined;
    }
    await this.logos.remove(id);
    return { kind: 'auto' };
  }

  private async persist(): Promise<void> {
    await this.repository.save(this.catalog.snapshot());
    this.events.emit('change');
  }
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
