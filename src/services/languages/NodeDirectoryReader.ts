import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DirectoryReader } from './LanguageDetector';

export class NodeDirectoryReader implements DirectoryReader {
  async readDirectory(dir: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
    } catch {
      return [];
    }
  }

  async fileSize(file: string): Promise<number> {
    try {
      return (await fs.stat(file)).size;
    } catch {
      return 0;
    }
  }

  join(...parts: string[]): string {
    return path.join(...parts);
  }
}
