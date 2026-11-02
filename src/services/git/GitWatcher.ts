import { promises as fs, watch, FSWatcher } from 'node:fs';
import * as path from 'node:path';

/**
 * Watches each project's `.git` directory (non-recursively, which is enough:
 * commit, checkout, pull and fetch all touch files directly inside it such as
 * HEAD, ORIG_HEAD, FETCH_HEAD, index or packed-refs) and reports the project
 * path after a short debounce. One cheap OS watcher per repository.
 */
export class GitWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(private readonly onChange: (projectPath: string) => void, private readonly debounceMs = 1500) {}

  /** Makes the watched set equal to `projectPaths`; unknown ones are added, missing ones closed. */
  async sync(projectPaths: readonly string[]): Promise<void> {
    const wanted = new Set(projectPaths);
    for (const [p, watcher] of this.watchers) {
      if (!wanted.has(p)) {
        watcher.close();
        this.watchers.delete(p);
      }
    }
    await Promise.all(projectPaths.filter((p) => !this.watchers.has(p)).map((p) => this.add(p)));
  }

  dispose(): void {
    this.disposed = true;
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private async add(projectPath: string): Promise<void> {
    const gitDir = path.join(projectPath, '.git');
    try {
      const stat = await fs.stat(gitDir);
      if (!stat.isDirectory() || this.disposed || this.watchers.has(projectPath)) {
        return;
      }
      const watcher = watch(gitDir, { persistent: false }, () => this.schedule(projectPath));
      watcher.on('error', () => {
        watcher.close();
        this.watchers.delete(projectPath);
      });
      this.watchers.set(projectPath, watcher);
    } catch {
      /* not a repository (or unreadable): nothing to watch */
    }
  }

  private schedule(projectPath: string): void {
    clearTimeout(this.timers.get(projectPath));
    this.timers.set(
      projectPath,
      setTimeout(() => {
        this.timers.delete(projectPath);
        if (!this.disposed) {
          this.onChange(projectPath);
        }
      }, this.debounceMs),
    );
  }
}
