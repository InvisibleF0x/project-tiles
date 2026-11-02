import { promises as fs, watch, FSWatcher } from 'node:fs';
import * as path from 'node:path';
import { CatalogData, emptyCatalog } from '../domain/model';

export interface CatalogRepository {
  load(): Promise<CatalogData>;
  save(data: CatalogData): Promise<void>;
  /** Resolves with fresh data when something other than this repository wrote the file, else `undefined`. */
  loadIfChangedExternally(): Promise<CatalogData | undefined>;
  /** Calls `listener` (debounced) whenever the file changes on disk; returns a disposer. */
  watch(listener: () => void): () => void;
  /** Location shown to the user (so the file can be edited or backed up by hand). */
  readonly location: string;
}

/**
 * Stores the catalog as a single pretty-printed JSON file. Writes go through a
 * temp file + rename so a crash mid-write never corrupts the catalog. The file
 * is shared by every editor window, so the repository remembers the text it
 * wrote last and can tell its own writes apart from another window's.
 */
export class JsonFileCatalogRepository implements CatalogRepository {
  private lastText: string | undefined;

  constructor(readonly location: string) {}

  async load(): Promise<CatalogData> {
    let text: string;
    try {
      text = await fs.readFile(this.location, 'utf8');
    } catch {
      this.lastText = undefined;
      return emptyCatalog();
    }
    this.lastText = text;
    return JsonFileCatalogRepository.parse(text, this.location);
  }

  async loadIfChangedExternally(): Promise<CatalogData | undefined> {
    let text: string;
    try {
      text = await fs.readFile(this.location, 'utf8');
    } catch {
      return undefined;
    }
    if (text === this.lastText) {
      return undefined;
    }
    this.lastText = text;
    return JsonFileCatalogRepository.parse(text, this.location);
  }

  async save(data: CatalogData): Promise<void> {
    await fs.mkdir(path.dirname(this.location), { recursive: true });
    const text = JSON.stringify(data, null, 2);
    const tmp = `${this.location}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, this.location);
    this.lastText = text;
  }

  watch(listener: () => void): () => void {
    const dir = path.dirname(this.location);
    const file = path.basename(this.location);
    let watcher: FSWatcher | undefined;
    let timer: NodeJS.Timeout | undefined;
    const start = (): void => {
      try {
        watcher = watch(dir, { persistent: false }, (_event, name) => {
          if (name && name !== file) {
            return;
          }
          clearTimeout(timer);
          timer = setTimeout(listener, 300);
        });
        watcher.on('error', () => undefined);
      } catch {
        watcher = undefined;
      }
    };
    void fs.mkdir(dir, { recursive: true }).then(start, start);
    return () => {
      clearTimeout(timer);
      watcher?.close();
    };
  }

  private static parse(text: string, location: string): CatalogData {
    try {
      const parsed = JSON.parse(text) as Partial<CatalogData>;
      return {
        version: 1,
        collections: Array.isArray(parsed.collections) ? parsed.collections : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      };
    } catch (error) {
      throw new Error(`Project Tiles: cannot parse ${location}: ${(error as Error).message}`);
    }
  }
}
