import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ProjectMetadata } from '../domain/model';

interface CacheFile {
  version: 1;
  entries: Record<string, ProjectMetadata>;
}

/**
 * Persists per-project metadata between sessions so tiles render instantly
 * from the last known state while a background refresh runs. Writes are
 * debounced and atomic; a corrupt file simply means an empty cache.
 */
export class MetadataCacheStore {
  private timer: NodeJS.Timeout | undefined;
  private pending: Map<string, ProjectMetadata> | undefined;

  constructor(private readonly location: string, private readonly debounceMs = 1000) {}

  async load(): Promise<Map<string, ProjectMetadata>> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.location, 'utf8')) as Partial<CacheFile>;
      const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
      const map = new Map<string, ProjectMetadata>();
      for (const [key, meta] of Object.entries(entries)) {
        if (meta && typeof meta === 'object') {
          map.set(key, { ...meta, languagesAt: meta.languagesAt ?? 0, fetchedAt: meta.fetchedAt ?? 0 });
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  /** Schedules a write of the whole map; later calls within the debounce window replace earlier ones. */
  scheduleSave(entries: Map<string, ProjectMetadata>): void {
    this.pending = entries;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const entries = this.pending;
    this.pending = undefined;
    if (!entries) {
      return;
    }
    const file: CacheFile = { version: 1, entries: {} };
    for (const [key, meta] of entries) {
      const { git, ...rest } = meta;
      // `checking` is a transient UI flag; never persist it.
      let cleanGit = git;
      if (git?.sync) {
        const { checking: _transient, ...sync } = git.sync;
        cleanGit = { ...git, sync };
      }
      file.entries[key] = { ...rest, git: cleanGit ?? null };
    }
    try {
      await fs.mkdir(path.dirname(this.location), { recursive: true });
      const tmp = `${this.location}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(file), 'utf8');
      await fs.rename(tmp, this.location);
    } catch {
      /* cache is best-effort */
    }
  }
}
