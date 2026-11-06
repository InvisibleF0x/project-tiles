import * as path from 'node:path';
import * as vscode from 'vscode';
import { stringsFor } from './i18n';
import { CliGitInfoProvider } from './services/git/GitInfoProvider';
import { ExtensionLanguageDetector } from './services/languages/LanguageDetector';
import { NodeDirectoryReader } from './services/languages/NodeDirectoryReader';
import { LogoStore } from './services/logo/LogoStore';
import { MetadataService } from './services/MetadataService';
import { ProjectService } from './services/ProjectService';
import { JsonFileCatalogRepository } from './storage/CatalogRepository';
import { MetadataCacheStore } from './storage/MetadataCacheStore';
import { sharedCatalogFile, sharedDataDirectory, sharedLogoDirectory } from './storage/SharedDataLocation';
import { DashboardDependencies, DashboardPanel } from './webview/DashboardPanel';

/**
 * Composition root. Activation only registers commands: the catalog is read lazily, watchers live only
 * while the dashboard exists, and git is never called until the dashboard asks for it.
 */
export function activate(context: vscode.ExtensionContext): void {
  const config = () => vscode.workspace.getConfiguration('projectTiles');
  // The catalog and logos live in one directory shared by all editors; the metadata cache is
  // derived data and stays in this editor's own storage.
  const storageDir = context.globalStorageUri.fsPath;
  const dataDir = sharedDataDirectory();

  const repository = new JsonFileCatalogRepository(sharedCatalogFile(dataDir));
  const logos = new LogoStore(sharedLogoDirectory(dataDir));
  const directoryReader = new NodeDirectoryReader();
  const metadata = new MetadataService(
    new CliGitInfoProvider({ fetchRemote: () => config().get<boolean>('fetchRemote', true) }),
    () =>
      new ExtensionLanguageDetector(directoryReader, {
        ignoreDirs: config().get<string[]>('languageIgnoreDirs', []),
        maxFiles: config().get<number>('maxFilesScanned', 15000),
      }),
    logos,
    new MetadataCacheStore(path.join(storageDir, 'metadata-cache.json')),
    {
      gitTtlMs: () => config().get<number>('metadataCacheMinutes', 10) * 60_000,
      languagesTtlMs: () => config().get<number>('languageCacheHours', 12) * 3_600_000,
      gitEnabled: () => config().get<boolean>('showGit', true),
      languagesEnabled: () => config().get<boolean>('showLanguages', true),
    },
  );
  const service = new ProjectService(repository, logos, metadata);

  const deps: DashboardDependencies = {
    extensionUri: context.extensionUri,
    service,
    strings: stringsFor(vscode.env.language),
    settings: () => ({
      openInNewWindow: config().get<boolean>('openInNewWindow', false),
      tileSize: config().get<'normal' | 'compact'>('tileSize', 'normal'),
      columns: Math.min(6, Math.max(1, config().get<number>('columns', 3))),
      showPath: config().get<boolean>('showPath', true),
      showLanguages: config().get<boolean>('showLanguages', true),
      showGit: config().get<boolean>('showGit', true),
    }),
    currentFolder,
  };

  const open = async (): Promise<void> => {
    await service.ensureLoaded();
    DashboardPanel.show(deps);
  };

  const addFolder = async (folder: string | undefined): Promise<void> => {
    if (!folder) {
      void vscode.window.showInformationMessage(deps.strings.empty);
      return;
    }
    await service.ensureLoaded();
    const existing = service.findByPath(folder);
    if (existing) {
      DashboardPanel.show(deps, existing.id);
      return;
    }
    DashboardPanel.show(deps, 'new', { name: path.basename(folder), path: folder, logo: { kind: 'auto' } });
  };

  const addRecent = async (): Promise<void> => {
    await service.ensureLoaded();
    const candidates = (await recentFolders()).filter((folder) => !service.findByPath(folder));
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(deps.strings.addRecentNone);
      return;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((folder) => ({ label: path.basename(folder), description: folder, folder })),
      { canPickMany: true, matchOnDescription: true, placeHolder: deps.strings.addRecentTitle },
    );
    for (const item of picked ?? []) {
      await service.saveProject(service.newId(), { name: item.label, path: item.folder, logo: { kind: 'auto' } });
    }
    if (picked?.length) {
      DashboardPanel.show(deps);
    }
  };

  // Activity-bar entry: an empty view (welcome content comes from package.json) that
  // opens the dashboard tab as soon as the user clicks the icon.
  const sidebar = vscode.window.createTreeView('projectTiles.sidebar', { treeDataProvider: emptyTree });

  context.subscriptions.push(
    sidebar,
    sidebar.onDidChangeVisibility((e) => {
      if (e.visible) {
        void open();
      }
    }),
    vscode.commands.registerCommand('projectTiles.open', open),
    vscode.commands.registerCommand('projectTiles.addCurrentFolder', () => addFolder(currentFolder())),
    vscode.commands.registerCommand('projectTiles.addRecent', addRecent),
    vscode.commands.registerCommand('projectTiles.addFolder', async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
      await addFolder(picked?.[0]?.fsPath);
    }),
    vscode.commands.registerCommand('projectTiles.refresh', async () => {
      await service.ensureLoaded();
      DashboardPanel.show(deps);
      await DashboardPanel.instance?.refreshAll();
    }),
    vscode.commands.registerCommand('projectTiles.openDataFile', async () => {
      await service.ensureLoaded();
      await vscode.window.showTextDocument(vscode.Uri.file(service.dataFile));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('projectTiles.languageIgnoreDirs') ||
        e.affectsConfiguration('projectTiles.maxFilesScanned') ||
        e.affectsConfiguration('projectTiles.fetchRemote') ||
        e.affectsConfiguration('projectTiles.showGit') ||
        e.affectsConfiguration('projectTiles.showLanguages')
      ) {
        metadata.invalidate();
      }
      if (e.affectsConfiguration('projectTiles')) {
        DashboardPanel.instance?.refreshView();
      }
    }),
    { dispose: () => DashboardPanel.instance?.dispose() },
  );

  if (config().get<boolean>('showOnStartup', false) && !currentFolder() && vscode.window.visibleTextEditors.length === 0) {
    void open();
  }
}

const emptyTree: vscode.TreeDataProvider<never> = {
  getTreeItem: () => new vscode.TreeItem(''),
  getChildren: () => [],
};

type UriLike = vscode.Uri | { scheme: string; authority?: string; path?: string };

/** Local folders and .code-workspace files from the editor's own "Recently opened" list. */
async function recentFolders(): Promise<string[]> {
  const recent = await vscode.commands.executeCommand<{ workspaces?: Array<{ folderUri?: UriLike; workspace?: { configPath: UriLike } }> }>(
    '_workbench.getRecentlyOpened',
  );
  return (recent?.workspaces ?? [])
    .map((entry) => entry.folderUri ?? entry.workspace?.configPath)
    .filter((uri): uri is UriLike => uri !== undefined && uri.scheme === 'file')
    .map((uri) => (uri instanceof vscode.Uri ? uri : vscode.Uri.from(uri)).fsPath);
}

function currentFolder(): string | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme === 'file') {
    return workspaceFile.fsPath;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === 'file' ? folder.uri.fsPath : undefined;
}
