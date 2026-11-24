import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface Subfolder {
  path: string;
  name: string;
  /** Has a `.git` entry, so it is most likely a project. */
  isGit: boolean;
}

/** Folders that are never projects of their own. */
const SKIPPED = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

/** The direct subfolders of `parent` (hidden ones skipped), git repositories first, then by name. */
export async function listSubfolders(parent: string): Promise<Subfolder[]> {
  const entries = await fs.readdir(parent, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED.has(e.name));
  const result = await Promise.all(
    folders.map(async (e): Promise<Subfolder> => {
      const full = path.join(parent, e.name);
      const isGit = await fs.stat(path.join(full, '.git')).then(
        () => true,
        () => false,
      );
      return { path: full, name: e.name, isGit };
    }),
  );
  return result.sort((a, b) => Number(b.isGit) - Number(a.isGit) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Turns drag data (file URIs or plain paths) into absolute local paths; anything else is dropped. */
export function pathsFromDropped(items: readonly string[], platform: NodeJS.Platform = process.platform): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item || item.startsWith('#')) {
      continue;
    }
    let candidate: string | undefined;
    if (/^file:\/\//i.test(item)) {
      try {
        candidate = fileUriToPath(item, platform);
      } catch {
        continue;
      }
    } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(item)) {
      candidate = item;
    }
    if (candidate && (platform === 'win32' ? path.win32.isAbsolute(candidate) : path.posix.isAbsolute(candidate)) && !out.includes(candidate)) {
      out.push(candidate);
    }
  }
  return out;
}

function fileUriToPath(uri: string, platform: NodeJS.Platform): string {
  const url = new URL(uri);
  let pathname = decodeURIComponent(url.pathname);
  if (platform !== 'win32') {
    return pathname;
  }
  if (url.host) {
    return `\\\\${url.host}${pathname.replace(/\//g, '\\')}`;
  }
  if (/^\/[a-z]:/i.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return pathname.replace(/\//g, '\\');
}
