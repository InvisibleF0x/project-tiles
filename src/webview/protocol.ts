import { Collection, Logo, Project, ProjectMetadata } from '../domain/model';
import { Strings } from '../i18n';
import { RemoteOperation } from '../services/git/GitInfoProvider';

/** Project as sent to the webview: logo already resolved to something the browser can render. */
export interface ProjectView extends Omit<Project, 'logo'> {
  logo: Logo | undefined;
  /** Webview URI of the stored or auto-discovered image, if any. */
  logoUri?: string;
  isCurrent: boolean;
}

export interface DashboardSettings {
  openInNewWindow: boolean;
  tileSize: 'normal' | 'compact';
  columns: number;
  showPath: boolean;
  showLanguages: boolean;
  showGit: boolean;
}

export interface DashboardState {
  collections: Collection[];
  projects: ProjectView[];
  meta: Record<string, ProjectMetadata>;
  settings: DashboardSettings;
  /** False when no folder or project is open here (e.g. on a welcome screen). */
  canAddCurrent: boolean;
  strings: Strings;
  /** Id of the project whose editor should be open, or 'new' for a fresh one. */
  editing?: string;
  /** Pre-filled values when `editing === 'new'`. */
  draft?: Partial<Project>;
}

export type HostToWebview =
  | { type: 'state'; state: DashboardState }
  | { type: 'meta'; id: string; meta: ProjectMetadata; logoUri?: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'logoPicked'; id: string; fileName: string; logoUri: string }
  | { type: 'folderPicked'; path: string; name: string }
  | { type: 'gitDone'; id: string; op: RemoteOperation };

export interface ProjectPatch {
  name: string;
  path: string;
  description: string;
  logo: Logo;
  languages: string[];
  color: string | undefined;
  collectionId: string | undefined;
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'open'; id: string; newWindow: boolean }
  | { type: 'terminal'; id: string }
  | { type: 'reveal'; id: string }
  | { type: 'saveProject'; id: string | undefined; patch: ProjectPatch }
  | { type: 'removeProject'; id: string }
  | { type: 'moveProject'; id: string; collectionId: string | undefined; index: number }
  | { type: 'saveCollection'; id: string | undefined; name: string; color: string | undefined; description: string | undefined }
  | { type: 'removeCollection'; id: string }
  | { type: 'moveCollection'; id: string; index: number }
  | { type: 'toggleCollection'; id: string; collapsed: boolean }
  | { type: 'pickLogo'; id: string | undefined }
  | { type: 'pickFolder' }
  | { type: 'refresh'; id?: string }
  | { type: 'addCurrent' }
  | { type: 'addRecent' }
  | { type: 'git'; id: string; op: RemoteOperation };
