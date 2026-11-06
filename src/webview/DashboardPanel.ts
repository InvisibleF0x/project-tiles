import * as path from 'node:path';
import * as vscode from 'vscode';
import { Project, ProjectMetadata } from '../domain/model';
import { Strings } from '../i18n';
import { GitWatcher } from '../services/git/GitWatcher';
import { ProjectService } from '../services/ProjectService';
import { RemoteOperation } from '../services/git/GitInfoProvider';
import { DashboardSettings, DashboardState, HostToWebview, ProjectView, WebviewToHost } from './protocol';

export interface DashboardDependencies {
  readonly extensionUri: vscode.Uri;
  readonly service: ProjectService;
  readonly strings: Strings;
  readonly settings: () => DashboardSettings;
  /** Folder (or .code-workspace) open in this window, if any. */
  readonly currentFolder: () => string | undefined;
}

/**
 * Owns the single dashboard webview. Translates webview messages into
 * ProjectService calls and pushes state/metadata back. No business rules live here.
 */
export class DashboardPanel implements vscode.Disposable {
  static readonly viewType = 'projectTiles.dashboard';
  private static current: DashboardPanel | undefined;

  static show(deps: DashboardDependencies, editing?: DashboardState['editing'], draft?: DashboardState['draft']): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(DashboardPanel.viewType, deps.strings.title, column, {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'media'), vscode.Uri.file(deps.service.logos.root)],
      });
      panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'icon.png');
      DashboardPanel.current = new DashboardPanel(panel, deps);
    }
    DashboardPanel.current.pendingEdit = editing;
    DashboardPanel.current.pendingDraft = draft;
    if (DashboardPanel.current.ready) {
      void DashboardPanel.current.pushState();
    }
    return DashboardPanel.current;
  }

  static get instance(): DashboardPanel | undefined {
    return DashboardPanel.current;
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly gitWatcher: GitWatcher;
  private ready = false;
  private pendingEdit: DashboardState['editing'];
  private pendingDraft: DashboardState['draft'];

  private constructor(private readonly panel: vscode.WebviewPanel, private readonly deps: DashboardDependencies) {
    panel.webview.html = this.html();
    panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    panel.webview.onDidReceiveMessage((m: unknown) => {
      if (isMessage(m)) {
        void this.handle(m);
      }
    }, undefined, this.disposables);
    this.disposables.push({ dispose: deps.service.onDidChange(() => void this.pushState()) });
    // Other windows (or a hand edit) may change projects.json while this panel is open.
    this.disposables.push({ dispose: deps.service.watchExternalChanges() });

    // Repository activity (pull, commit, checkout…) refreshes just that tile's git part.
    this.gitWatcher = new GitWatcher((projectPath) => {
      if (deps.service.metadata.isSelfChange(projectPath)) {
        return; // echo of our own `git fetch`
      }
      const project = deps.service.projects.find((p) => p.path === projectPath);
      if (project) {
        deps.service.metadata.markGitStale(projectPath);
        void this.refreshMetadata(false, project, true);
      }
    });
    this.disposables.push({ dispose: () => this.gitWatcher.dispose() });

    // A hidden panel loses its webview (no retainContextWhenHidden); it says 'ready' again when shown.
    panel.onDidChangeViewState(() => {
      if (!panel.visible) {
        this.ready = false;
      }
    }, undefined, this.disposables);

    // Gather metadata (including the one network check) while the webview boots;
    // the first state message then carries whatever is already known.
    void this.refreshMetadata(false, undefined, false, true);
  }

  dispose(): void {
    DashboardPanel.current = undefined;
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
  }

  refreshView(): void {
    if (this.ready) {
      void this.pushState();
    }
  }

  private busyCount = 0;

  async refreshMetadata(force: boolean, only?: Project, gitOnly = false, network = false): Promise<void> {
    const projects = only ? [only] : this.deps.service.projects;
    this.setBusy(true);
    try {
      await this.deps.service.metadata.refresh(projects, (project, meta) => this.post(this.metaMessage(project, meta)), { force, gitOnly, network });
    } finally {
      this.setBusy(false);
    }
  }

  refreshAll(): Promise<void> {
    return this.refreshMetadata(true, undefined, false, true);
  }

  private setBusy(busy: boolean): void {
    this.busyCount += busy ? 1 : -1;
    if ((busy && this.busyCount === 1) || (!busy && this.busyCount === 0)) {
      this.post({ type: 'busy', busy });
    }
  }

  private async pushState(): Promise<void> {
    const { service, strings, settings } = this.deps;
    await service.metadata.ensureLoaded();
    const current = this.deps.currentFolder();
    const currentKey = current ? normalize(current) : undefined;
    const meta: Record<string, ProjectMetadata> = {};
    const projects: ProjectView[] = service.projects.map((p) => {
      const cached = service.metadata.cached(p);
      if (cached) {
        meta[p.id] = cached;
      }
      const view: ProjectView = { ...p, logo: p.logo, isCurrent: currentKey !== undefined && normalize(p.path) === currentKey };
      const logoUri = this.logoUri(p, cached);
      if (logoUri) {
        view.logoUri = logoUri;
      }
      return view;
    });
    const state: DashboardState = { collections: [...service.collections], projects, meta, settings: settings(), canAddCurrent: current !== undefined, strings };
    if (this.pendingEdit) {
      state.editing = this.pendingEdit;
      if (this.pendingDraft) {
        state.draft = this.pendingDraft;
      }
      this.pendingEdit = undefined;
      this.pendingDraft = undefined;
    }
    this.post({ type: 'state', state });
    void this.gitWatcher.sync(service.projects.map((p) => p.path));
    void this.refreshMetadata(false, undefined, false, false);
  }

  private metaMessage(project: Project, meta: ProjectMetadata): HostToWebview {
    const message: HostToWebview = { type: 'meta', id: project.id, meta };
    const logoUri = this.logoUri(project, meta);
    if (logoUri) {
      message.logoUri = logoUri;
    }
    return message;
  }

  private logoUri(project: Project, meta: ProjectMetadata | undefined): string | undefined {
    const file = this.deps.service.logoFile(project, meta);
    return file ? this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() : undefined;
  }

  private post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private async handle(message: WebviewToHost): Promise<void> {
    const { service } = this.deps;
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await service.syncFromDisk();
        await this.pushState();
        if (this.busyCount > 0) {
          this.post({ type: 'busy', busy: true }); // the earlier one went to a webview that was not there yet
        }
        return;
      case 'open': {
        const project = service.getProject(message.id);
        if (project) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.path), { forceNewWindow: message.newWindow });
        }
        return;
      }
      case 'terminal': {
        const project = service.getProject(message.id);
        if (project) {
          vscode.window.createTerminal({ name: project.name, cwd: project.path }).show();
        }
        return;
      }
      case 'reveal': {
        const project = service.getProject(message.id);
        if (project) {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(project.path));
        }
        return;
      }
      case 'saveProject': {
        const id = message.id ?? service.newId();
        const { patch } = message;
        await service.saveProject(id, {
          name: patch.name,
          path: patch.path,
          description: patch.description,
          logo: patch.logo,
          languages: patch.languages,
          color: patch.color,
          collectionId: patch.collectionId,
        });
        return;
      }
      case 'removeProject':
        await service.removeProject(message.id);
        return;
      case 'moveProject':
        await service.moveProject(message.id, message.collectionId, message.index);
        return;
      case 'saveCollection':
        await service.saveCollection(message.id, message.name, message.color, message.description);
        return;
      case 'removeCollection':
        await service.removeCollection(message.id);
        return;
      case 'moveCollection':
        await service.moveCollection(message.id, message.index);
        return;
      case 'toggleCollection':
        await service.toggleCollection(message.id, message.collapsed);
        return;
      case 'pickLogo': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { Images: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico'] },
        });
        const file = picked?.[0]?.fsPath;
        if (!file) {
          return;
        }
        const id = message.id ?? service.newId();
        const fileName = await service.importLogo(id, file);
        const logoUri = this.panel.webview.asWebviewUri(vscode.Uri.file(service.logos.resolve(fileName))).toString();
        this.post({ type: 'logoPicked', id, fileName, logoUri });
        return;
      }
      case 'pickFolder': {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
        const folder = picked?.[0]?.fsPath;
        if (folder) {
          this.post({ type: 'folderPicked', path: folder, name: path.basename(folder) });
        }
        return;
      }
      case 'refresh': {
        const only = message.id ? service.getProject(message.id) : undefined;
        await this.refreshMetadata(true, only, false, true);
        return;
      }
      case 'addCurrent':
        await vscode.commands.executeCommand('projectTiles.addCurrentFolder');
        return;
      case 'addRecent':
        await vscode.commands.executeCommand('projectTiles.addRecent');
        return;
      case 'git': {
        const project = service.getProject(message.id);
        if (project && isRemoteOperation(message.op)) {
          await this.runGit(project, message.op);
        }
        return;
      }
    }
  }

  private async runGit(project: Project, op: RemoteOperation): Promise<void> {
    const { strings, service } = this.deps;
    try {
      const result = await service.metadata.runRemote(project, op, (p, meta) => this.post(this.metaMessage(p, meta)));
      if (!result.ok) {
        const text = strings.gitFailed.replace('{op}', op).replace('{project}', project.name).replace('{error}', result.error);
        void vscode.window.showErrorMessage(text);
      }
    } finally {
      this.post({ type: 'gitDone', id: project.id, op });
    }
  }

  private html(): string {
    const { webview } = this.panel;
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'media', file));
    const nonce = randomNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      // 'unsafe-inline' is needed for per-tile colours and language-bar widths set via style="".
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('dashboard.css')}">
<title>${escapeHtml(this.deps.strings.title)}</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${media('dashboard.js')}"></script>
</body>
</html>`;
  }
}

/** Cheap shape check: the webview is ours, but a message is still untrusted input. */
function isMessage(m: unknown): m is WebviewToHost {
  if (!m || typeof m !== 'object' || typeof (m as { type?: unknown }).type !== 'string') {
    return false;
  }
  const id = (m as { id?: unknown }).id;
  return id === undefined || typeof id === 'string';
}

function isRemoteOperation(op: unknown): op is RemoteOperation {
  return op === 'fetch' || op === 'pull' || op === 'push';
}

function normalize(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
