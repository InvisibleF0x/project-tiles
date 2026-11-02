import { LanguageShare } from '../../domain/model';
import { LANGUAGE_BY_EXTENSION, LANGUAGE_BY_NAME, UNKNOWN_LANGUAGE_COLOR, LanguageDefinition } from './languageTable';

export interface LanguageDetector {
  detect(folder: string): Promise<LanguageShare[]>;
}

/** Minimal file-system abstraction so the detector can be tested without touching disk. */
export interface DirectoryReader {
  /** Returns entries of a directory; implementations must not throw for unreadable dirs. */
  readDirectory(dir: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>;
  fileSize(file: string): Promise<number>;
  join(...parts: string[]): string;
}

export interface LanguageDetectorOptions {
  ignoreDirs: Iterable<string>;
  maxFiles: number;
  /** Maximum directory depth from the project root; keeps huge trees cheap. */
  maxDepth?: number;
}

/**
 * Walks the project tree (breadth-first, bounded) and sums file sizes per
 * language, like GitHub does. Returns shares sorted by percentage.
 */
export class ExtensionLanguageDetector implements LanguageDetector {
  private readonly ignore: Set<string>;
  private readonly maxFiles: number;
  private readonly maxDepth: number;

  constructor(private readonly reader: DirectoryReader, options: LanguageDetectorOptions) {
    this.ignore = new Set(Array.from(options.ignoreDirs, (d) => d.toLowerCase()));
    this.maxFiles = options.maxFiles;
    this.maxDepth = options.maxDepth ?? 12;
  }

  async detect(folder: string): Promise<LanguageShare[]> {
    const bytesByLanguage = new Map<LanguageDefinition, number>();
    const queue: Array<{ dir: string; depth: number }> = [{ dir: folder, depth: 0 }];
    let scanned = 0;

    while (queue.length > 0 && scanned < this.maxFiles) {
      const { dir, depth } = queue.shift()!;
      const entries = await this.reader.readDirectory(dir);
      for (const entry of entries) {
        if (scanned >= this.maxFiles) {
          break;
        }
        if (entry.isDirectory) {
          if (depth < this.maxDepth && !this.ignore.has(entry.name.toLowerCase())) {
            queue.push({ dir: this.reader.join(dir, entry.name), depth: depth + 1 });
          }
          continue;
        }
        if (!entry.isFile) {
          continue;
        }
        const language = languageForFileName(entry.name);
        if (!language) {
          continue;
        }
        scanned++;
        const size = await this.reader.fileSize(this.reader.join(dir, entry.name));
        bytesByLanguage.set(language, (bytesByLanguage.get(language) ?? 0) + Math.max(size, 1));
      }
    }
    return toShares(bytesByLanguage);
  }
}

export function languageForFileName(fileName: string): LanguageDefinition | undefined {
  const lower = fileName.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
    return LANGUAGE_BY_EXTENSION.get('dockerfile');
  }
  if (lower === 'makefile') {
    return LANGUAGE_BY_EXTENSION.get('mk');
  }
  if (lower === 'cmakelists.txt') {
    return LANGUAGE_BY_EXTENSION.get('cmake');
  }
  if (lower.endsWith('.blade.php')) {
    return LANGUAGE_BY_EXTENSION.get('blade.php');
  }
  if (lower.endsWith('.d.ts')) {
    return LANGUAGE_BY_EXTENSION.get('ts');
  }
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) {
    return undefined;
  }
  return LANGUAGE_BY_EXTENSION.get(lower.slice(dot + 1));
}

export function toShares(bytesByLanguage: Map<LanguageDefinition, number>): LanguageShare[] {
  let total = 0;
  for (const bytes of bytesByLanguage.values()) {
    total += bytes;
  }
  if (total === 0) {
    return [];
  }
  return [...bytesByLanguage.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, bytes]) => ({
      name: language.name,
      color: language.color,
      percent: Math.round((bytes / total) * 1000) / 10,
    }));
}

/** Turns a manual override list ("C#, ShaderLab") into equally weighted shares with palette colours. */
export function sharesFromNames(names: readonly string[]): LanguageShare[] {
  const unique = new Map<string, LanguageShare>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const known = LANGUAGE_BY_NAME.get(name.toLowerCase());
    const key = (known?.name ?? name).toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, { name: known?.name ?? name, color: known?.color ?? UNKNOWN_LANGUAGE_COLOR, percent: 0 });
    }
  }
  const percent = unique.size === 0 ? 0 : Math.round((100 / unique.size) * 10) / 10;
  return [...unique.values()].map((share) => ({ ...share, percent }));
}
