import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Unavailable } from '../domain/model';

/**
 * The mount point a path lives on: the drive or UNC share on Windows, a removable or network
 * volume under /Volumes, /media, /run/media or /mnt elsewhere, and "/" for everything else.
 */
export function volumeRoot(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return path.win32.parse(p).root;
  }
  const mount = platform === 'darwin' ? /^\/Volumes\/[^/]+/.exec(p) : /^\/(?:run\/)?media\/[^/]+\/[^/]+|^\/mnt\/[^/]+/.exec(p);
  return mount ? mount[0] : '/';
}

/** `undefined` when the project folder (or .code-workspace file) is there. */
export async function unavailability(p: string): Promise<Unavailable | undefined> {
  if (await isProjectPath(p)) {
    return undefined;
  }
  return (await exists(volumeRoot(p))) ? 'deleted' : 'offline';
}

async function isProjectPath(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory() || p.toLowerCase().endsWith('.code-workspace');
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
