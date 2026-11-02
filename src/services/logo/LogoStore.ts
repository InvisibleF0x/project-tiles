import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const AUTO_LOGO_CANDIDATES = [
  'logo.png', 'logo.svg', 'logo.jpg', 'logo.jpeg', 'logo.webp',
  'icon.png', 'icon.svg', 'icon.jpg', 'icon.ico',
  '.vscode/logo.png', '.vscode/icon.png', '.idea/icon.png', '.idea/icon.svg',
  'assets/logo.png', 'assets/icon.png', 'public/favicon.svg', 'public/favicon.ico', 'public/logo.png',
  'Assets/logo.png', 'Assets/icon.png', 'media/icon.png', 'docs/logo.png',
];

/** Ids are UUIDs we generate; anything else (e.g. `../x`) must never reach a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** All logo images live in one directory so the webview can load them from a single trusted root. */
export class LogoStore {
  constructor(private readonly directory: string) {}

  get root(): string {
    return this.directory;
  }

  /** Returns the stored file name. */
  async importImage(projectId: string, sourceFile: string): Promise<string> {
    assertSafeId(projectId);
    await fs.mkdir(this.directory, { recursive: true });
    await this.remove(projectId);
    const ext = path.extname(sourceFile).toLowerCase() || '.png';
    const fileName = `${projectId}${ext}`;
    await fs.copyFile(sourceFile, path.join(this.directory, fileName));
    return fileName;
  }

  async remove(projectId: string): Promise<void> {
    assertSafeId(projectId);
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${projectId}.`))
        .map((name) => fs.rm(path.join(this.directory, name), { force: true })),
    );
  }

  /** Absolute path of a stored file; refuses anything that would leave the store directory. */
  resolve(fileName: string): string {
    const resolved = path.resolve(this.directory, fileName);
    if (path.dirname(resolved) !== path.resolve(this.directory)) {
      throw new Error(`Project Tiles: invalid logo file name "${fileName}"`);
    }
    return resolved;
  }

  /** True when `file` sits directly in the store, i.e. the webview is allowed to load it. */
  contains(file: string): boolean {
    return path.dirname(path.resolve(file)) === path.resolve(this.directory);
  }

  /**
   * Looks for a conventional logo file inside the project (a handful of stats)
   * and mirrors it into the store, because the webview may only load images
   * from the store directory. Returns the absolute path of the mirrored copy.
   */
  async discover(projectId: string, projectFolder: string): Promise<string | undefined> {
    assertSafeId(projectId);
    for (const candidate of AUTO_LOGO_CANDIDATES) {
      const file = path.join(projectFolder, candidate);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size === 0 || stat.size > 2 * 1024 * 1024) {
          continue;
        }
        await fs.mkdir(this.directory, { recursive: true });
        const target = path.join(this.directory, `${projectId}.auto${path.extname(file).toLowerCase()}`);
        await fs.copyFile(file, target);
        return target;
      } catch {
        /* not there */
      }
    }
    return undefined;
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Project Tiles: invalid project id "${id}"`);
  }
}
