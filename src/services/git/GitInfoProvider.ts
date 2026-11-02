import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { GitInfo, SyncInfo } from '../../domain/model';
import { GIT_LOG_FORMAT, parseAheadBehind, parseCommitLine } from './parse';

export interface GitInfoProvider {
  /** Whether `fetchAndCount` will actually hit the network. */
  fetchEnabled(): boolean;
  /**
   * Local-only state (branch, last commit, ahead/behind against the last fetched
   * upstream). Fast: no network. Resolves to `null` when not a git working tree.
   */
  getQuickInfo(folder: string): Promise<GitInfo | null>;
  /** Runs `git fetch` and recounts ahead/behind. Slow (network). `undefined` when the branch has no upstream. */
  fetchAndCount(folder: string): Promise<SyncInfo | undefined>;
}

export interface CliGitOptions {
  fetchRemote: () => boolean;
  timeoutMs?: number;
  fetchTimeoutMs?: number;
}

/**
 * Hardening flags passed to every git invocation:
 *  - `--no-optional-locks` never takes the index lock, so we cannot collide with
 *    the user's own git / VS Code's git extension;
 *  - `core.fsmonitor=false` ignores a repository-level fsmonitor hook, which a
 *    malicious repo config could otherwise use to run an arbitrary program;
 *  - `core.hooksPath` pointed at an empty location disables repo hooks for our calls.
 */
const GIT_BASE_ARGS = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.quotepath=off'];

/**
 * Reads git state with the `git` CLI. The branch comes straight from
 * `.git/HEAD`, so a non-repo costs one stat and a repo three short processes.
 */
export class CliGitInfoProvider implements GitInfoProvider {
  private readonly timeoutMs: number;
  private readonly fetchTimeoutMs: number;

  constructor(private readonly options: CliGitOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 20000;
  }

  fetchEnabled(): boolean {
    return this.options.fetchRemote();
  }

  async getQuickInfo(folder: string): Promise<GitInfo | null> {
    const head = await readHead(folder);
    if (head === undefined) {
      return null;
    }
    const [branch, log, sync] = await Promise.all([
      head.branch ?? this.git(folder, ['rev-parse', '--short', 'HEAD']).then((s) => s?.trim() || 'HEAD'),
      this.git(folder, ['log', '-1', `--format=${GIT_LOG_FORMAT}`]),
      this.count(folder, false),
    ]);
    const info: GitInfo = { branch };
    const commit = log === undefined ? undefined : parseCommitLine(log);
    if (commit) {
      info.commit = commit;
    }
    if (sync) {
      info.sync = sync;
    }
    return info;
  }

  async fetchAndCount(folder: string): Promise<SyncInfo | undefined> {
    const fetched = (await this.git(folder, ['fetch', '--quiet', '--no-tags'], this.fetchTimeoutMs)) !== undefined;
    return this.count(folder, fetched);
  }

  private async count(folder: string, fetched: boolean): Promise<SyncInfo | undefined> {
    const upstream = (await this.git(folder, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']))?.trim();
    if (!upstream) {
      return undefined;
    }
    const counts = parseAheadBehind((await this.git(folder, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])) ?? '');
    return counts ? { upstream, ...counts, fetched } : undefined;
  }

  private git(cwd: string, args: string[], timeout = this.timeoutMs): Promise<string | undefined> {
    return new Promise((resolve) => {
      execFile(
        'git',
        [...GIT_BASE_ARGS, ...args],
        { cwd, timeout, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
        (error, stdout) => resolve(error ? undefined : stdout),
      );
    });
  }
}

/**
 * Reads `.git/HEAD` (following a `gitdir:` pointer for worktrees/submodules).
 * Returns `{ branch }` for a symbolic ref, `{ branch: undefined }` when detached,
 * and `undefined` when the folder is not a repository.
 */
async function readHead(folder: string): Promise<{ branch: string | undefined } | undefined> {
  let gitDir = path.join(folder, '.git');
  try {
    const stat = await fs.stat(gitDir);
    if (stat.isFile()) {
      const pointer = (await fs.readFile(gitDir, 'utf8')).match(/^gitdir:\s*(.+)$/m);
      if (!pointer) {
        return undefined;
      }
      gitDir = path.resolve(folder, pointer[1]!.trim());
    }
    const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return { branch: ref ? ref[1] : undefined };
  } catch {
    return undefined;
  }
}
