import { Project, ProjectMetadata } from '../domain/model';
import { MetadataCacheStore } from '../storage/MetadataCacheStore';
import { GitInfoProvider, RemoteOperation } from './git/GitInfoProvider';
import { LanguageDetector, sharesFromNames } from './languages/LanguageDetector';
import { LogoStore } from './logo/LogoStore';
import { unavailability } from './PathState';

export interface MetadataServiceOptions {
  /** Git info older than this is refreshed when the dashboard opens. */
  gitTtlMs: () => number;
  /** Language scans are expensive; they are reused for this long. */
  languagesTtlMs: () => number;
  /** Projects inspected concurrently in the quick (local) phase. */
  quickConcurrency?: number;
  /** `git fetch` calls running concurrently; they wait on the network, not the CPU. */
  fetchConcurrency?: number;
  /** Language scans (disk + CPU) running concurrently. */
  scanConcurrency?: number;
  /** False when tiles do not show git info: no git process is started at all. */
  gitEnabled?: () => boolean;
  /** False when tiles do not show languages: nothing is scanned. */
  languagesEnabled?: () => boolean;
}

export interface RefreshOptions {
  /** Ignore TTLs. */
  force?: boolean;
  /**
   * Allow `git fetch` (network). Only the dashboard opening and the manual
   * refresh pass this; everything else stays offline.
   */
  network?: boolean;
  /**
   * Only redo the local git part, without a language scan.
   * Used when a repository changes on disk (commit, pull, checkout).
   */
  gitOnly?: boolean;
}

/** How long after our own `git fetch` repository watchers should ignore `.git` activity. */
const SELF_CHANGE_GRACE_MS = 5000;

export type MetadataListener = (project: Project, meta: ProjectMetadata) => void;

/**
 * Gathers per-project metadata in two phases so tiles fill up immediately:
 *  1. quick – existence, local git state, manual languages, auto logo;
 *  2. slow  – `git fetch` + recount and the language scan.
 * Results are cached in memory and on disk, and streamed to the listener as
 * each phase completes.
 */
export class MetadataService {
  private cache = new Map<string, ProjectMetadata>();
  private readonly inFlight = new Set<string>();
  private readonly fetching = new Set<string>();
  private readonly quietUntil = new Map<string, number>();
  private loaded: Promise<void> | undefined;

  constructor(
    private readonly git: GitInfoProvider,
    private readonly languages: () => LanguageDetector,
    private readonly logos: LogoStore,
    private readonly store: MetadataCacheStore | undefined,
    private readonly options: MetadataServiceOptions,
  ) {}

  /** Loads the on-disk cache once; cheap to call repeatedly. */
  async ensureLoaded(): Promise<void> {
    this.loaded ??= (async () => {
      if (this.store) {
        const persisted = await this.store.load();
        for (const [key, meta] of persisted) {
          if (!this.cache.has(key)) {
            this.cache.set(key, meta);
          }
        }
      }
    })();
    await this.loaded;
  }

  cached(project: Project): ProjectMetadata | undefined {
    return this.cache.get(project.path);
  }

  invalidate(projectPath?: string): void {
    if (projectPath === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(projectPath);
    }
    this.persist();
  }

  /** Marks git info stale without dropping what is displayed (used when a repo changes on disk). */
  markGitStale(projectPath: string): void {
    const meta = this.cache.get(projectPath);
    if (meta) {
      meta.fetchedAt = 0;
    }
  }

  /** True while our own `git fetch` is touching the repository (or just did), so watchers can ignore the echo. */
  isSelfChange(projectPath: string): boolean {
    return this.fetching.has(projectPath) || (this.quietUntil.get(projectPath) ?? 0) > Date.now();
  }

  async refresh(projects: readonly Project[], onResult: MetadataListener, options: RefreshOptions = {}): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    const gitTtl = this.options.gitTtlMs();
    const langTtl = this.options.languagesTtlMs();
    const gitEnabled = this.options.gitEnabled?.() ?? true;
    const languagesEnabled = this.options.languagesEnabled?.() ?? true;

    const plan = projects
      .filter((p) => !this.inFlight.has(p.path))
      .map((p): Task => {
        const cached = this.cache.get(p.path);
        const due = options.force === true || !cached || now - cached.fetchedAt > gitTtl;
        const manual = languagesEnabled && (p.languages ?? []).length > 0;
        const languages = languagesEnabled && !options.gitOnly && (options.force || !cached || now - cached.languagesAt > langTtl);
        // Looked for again together with the git part, not on every open; a cached path outside
        // the store (which the webview could not load) is rediscovered right away.
        const logo = p.logo?.kind === 'auto' && (due || (cached?.autoLogoPath !== undefined && !this.logos.contains(cached.autoLogoPath)));
        return { project: p, due, git: due && gitEnabled, languages, manual, logo, network: options.network === true };
      })
      .filter((t) => t.due || t.languages || t.logo);
    if (plan.length === 0) {
      return;
    }
    for (const t of plan) {
      this.inFlight.add(t.project.path);
    }
    try {
      await runPool(plan, this.options.quickConcurrency ?? 8, (t) => this.quickPhase(t, onResult));
      await Promise.all([
        runPool(plan.filter((t) => t.git), this.options.fetchConcurrency ?? 8, (t) => this.fetchPhase(t, onResult)),
        runPool(plan.filter((t) => t.languages), this.options.scanConcurrency ?? 2, (t) => this.scanPhase(t, onResult)),
      ]);
    } finally {
      for (const t of plan) {
        this.inFlight.delete(t.project.path);
      }
      this.persist();
    }
  }

  private async quickPhase(t: Task, onResult: MetadataListener): Promise<void> {
    const { project } = t;
    const previous = this.cache.get(project.path);
    const meta: ProjectMetadata = previous
      ? { ...previous }
      : { exists: true, git: null, languages: [], fetchedAt: 0, languagesAt: 0 };
    const unavailable = await unavailability(project.path);
    meta.exists = unavailable === undefined;
    if (unavailable) {
      meta.availability = unavailable;
      if (unavailable === 'deleted') {
        meta.git = null;
        meta.languages = [];
      }
      this.cache.set(project.path, meta);
      onResult(project, meta);
      t.git = t.languages = t.logo = false;
      return;
    }
    delete meta.availability;
    const [git, autoLogo] = await Promise.all([
      t.git ? this.git.getQuickInfo(project.path).catch(() => null) : Promise.resolve(meta.git),
      t.logo ? this.logos.discover(project.id, project.path).catch(() => undefined) : Promise.resolve(meta.autoLogoPath),
    ]);
    if (t.due) {
      meta.fetchedAt = Date.now();
    }
    if (t.git) {
      meta.git = git;
      if (t.network && git?.sync && this.git.fetchEnabled()) {
        git.sync.checking = true;
      } else {
        // Offline recount: keep "fetched" from the previous run when it was against the same upstream.
        const before = previous?.git?.sync;
        if (git?.sync && before && before.upstream === git.sync.upstream) {
          git.sync.fetched = before.fetched;
        }
        t.git = false; // nothing left to do in the slow phase
      }
    }
    if (t.manual) {
      meta.languages = sharesFromNames(project.languages ?? []);
      meta.languagesAt = Date.now();
      t.languages = false;
    }
    if (autoLogo) {
      meta.autoLogoPath = autoLogo;
    } else if (project.logo?.kind !== 'auto') {
      delete meta.autoLogoPath;
    }
    this.cache.set(project.path, meta);
    onResult(project, meta);
  }

  /** Slow phase, network part: `git fetch` + recount. Runs alongside the language scans. */
  private async fetchPhase(t: Task, onResult: MetadataListener): Promise<void> {
    const { project } = t;
    this.fetching.add(project.path);
    let sync;
    try {
      sync = await this.git.fetchAndCount(project.path).catch(() => undefined);
    } finally {
      this.fetching.delete(project.path);
      this.quietUntil.set(project.path, Date.now() + SELF_CHANGE_GRACE_MS);
    }
    const current = this.cache.get(project.path);
    if (!current?.git) {
      return; // invalidated meanwhile
    }
    const git = { ...current.git };
    if (sync) {
      git.sync = sync;
    } else if (git.sync) {
      git.sync = { ...git.sync, checking: false };
    }
    const meta: ProjectMetadata = { ...current, git };
    this.cache.set(project.path, meta);
    onResult(project, meta);
  }

  /** Slow phase, disk part: the language scan. */
  private async scanPhase(t: Task, onResult: MetadataListener): Promise<void> {
    const { project } = t;
    const languages = await this.languages().detect(project.path).catch(() => undefined);
    const current = this.cache.get(project.path);
    if (!current || !languages) {
      return; // invalidated meanwhile, or the scan failed
    }
    const meta: ProjectMetadata = { ...current, languages, languagesAt: Date.now() };
    this.cache.set(project.path, meta);
    onResult(project, meta);
  }

  /** A fetch, pull or push the user asked for, then a recount against the freshly updated remote refs. */
  async runRemote(project: Project, op: RemoteOperation, onResult: MetadataListener): Promise<{ ok: boolean; error: string }> {
    await this.ensureLoaded();
    this.fetching.add(project.path);
    let result: { ok: boolean; error: string };
    try {
      result = await this.git.runRemote(project.path, op);
    } finally {
      this.fetching.delete(project.path);
      this.quietUntil.set(project.path, Date.now() + SELF_CHANGE_GRACE_MS);
    }
    const git = await this.git.getQuickInfo(project.path).catch(() => null);
    const previous = this.cache.get(project.path);
    const before = previous?.git?.sync;
    if (git?.sync) {
      git.sync.fetched = result.ok || (before?.upstream === git.sync.upstream && before.fetched);
    }
    const meta: ProjectMetadata = { ...(previous ?? { exists: true, languages: [], languagesAt: 0 }), git, fetchedAt: Date.now() };
    this.cache.set(project.path, meta);
    this.persist();
    onResult(project, meta);
    return result;
  }

  private persist(): void {
    this.store?.scheduleSave(this.cache);
  }
}

interface Task {
  project: Project;
  /** The local part (git state, auto logo) is older than its TTL. */
  due: boolean;
  git: boolean;
  languages: boolean;
  manual: boolean;
  logo: boolean;
  network: boolean;
}

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      await work(items[next++]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}
