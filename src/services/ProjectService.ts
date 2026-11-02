import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Collection, Logo, Project, ProjectMetadata } from '../domain/model';
import { ProjectCatalog, ProjectInput } from '../domain/ProjectCatalog';
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

  getProject(id: string): Project | undefined {
    return this.catalog.getProject(id);
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
    if (!existing || existing.path !== saved.path || !sameList(existing.languages, saved.languages) || existing.logo?.kind !== saved.logo?.kind) {
      this.metadata.invalidate(saved.path);
    }
    await this.persist();
    return saved;
  }

  async removeProject(id: string): Promise<void> {
    if (this.catalog.removeProject(id)) {
      await this.logos.remove(id);
      await this.persist();
    }
  }

  async moveProject(id: string, collectionId: string | undefined, index: number): Promise<void> {
    if (this.catalog.moveProject(id, collectionId, index)) {
      await this.persist();
    }
  }

  async saveCollection(id: string | undefined, name: string, color: string | undefined, description: string | undefined): Promise<Collection> {
    const existing = id ? this.catalog.getCollection(id) : undefined;
    const saved = existing
      ? this.catalog.updateCollection(existing.id, { name, color, description })!
      : this.catalog.addCollection(name, color, description);
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
