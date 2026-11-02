import * as os from 'node:os';
import * as path from 'node:path';

const DIRECTORY_NAME = 'project-tiles';
const CATALOG_FILE = 'projects.json';
const LOGO_DIRECTORY = 'logos';

/**
 * Editor-independent data directory, so VS Code, its forks and the JetBrains plugin read and write
 * one catalog: `%APPDATA%\project-tiles` on Windows, `~/Library/Application Support/project-tiles`
 * on macOS, `$XDG_CONFIG_HOME/project-tiles` (default `~/.config`) elsewhere.
 */
export function sharedDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  if (platform === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), DIRECTORY_NAME);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', DIRECTORY_NAME);
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), DIRECTORY_NAME);
}

export const sharedCatalogFile = (dir: string): string => path.join(dir, CATALOG_FILE);
export const sharedLogoDirectory = (dir: string): string => path.join(dir, LOGO_DIRECTORY);
