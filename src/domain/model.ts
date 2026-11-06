/**
 * Pure data model. Nothing in this file may depend on `vscode` so that the
 * catalog logic can be unit-tested with plain Node.
 */

export type LogoKind = 'none' | 'auto' | 'emoji' | 'image';

export interface Logo {
  kind: LogoKind;
  /** Emoji text or a file name inside the logo storage directory. */
  value?: string;
}

export interface Project {
  id: string;
  name: string;
  /** Absolute path of the project folder (or .code-workspace file). */
  path: string;
  description?: string;
  logo?: Logo;
  /** Manual language override. Empty / undefined means "detect automatically". */
  languages?: string[];
  /** Accent colour (#rgb / #rrggbb). Falls back to the collection colour when absent. */
  color?: string;
  collectionId?: string;
}

/** Maximum number of user-perceived characters (emoji or letters) in a text logo. */
export const LOGO_TEXT_MAX = 3;

/** Trims `value` to at most `max` grapheme clusters, so a flag or a skin-toned emoji counts as one. */
export function clampGraphemes(value: string, max: number): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let out = '';
  let n = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (n++ >= max) {
      break;
    }
    out += segment;
  }
  return out;
}

/** Up to three initials from a project name: "MyGameStudio" → "MGS", "shop-backend" → "SB", "Tools" → "TO". */
export function initialsFor(name: string): string {
  const words = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return clampGraphemes(words[0]!, 2).toUpperCase();
  }
  return words
    .slice(0, LOGO_TEXT_MAX)
    .map((w) => clampGraphemes(w, 1))
    .join('')
    .toUpperCase();
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHexColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_COLOR.test(withHash) ? withHash.toLowerCase() : undefined;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  /** CSS colour, e.g. "#ff8800". */
  color?: string;
  collapsed?: boolean;
}

export interface CatalogData {
  version: 1;
  /** Array order is the display order. */
  collections: Collection[];
  /** Array order is the display order within each collection. */
  projects: Project[];
}

export const emptyCatalog = (): CatalogData => ({ version: 1, collections: [], projects: [] });

export interface CommitInfo {
  hash: string;
  subject: string;
  relativeDate: string;
  author: string;
}

export interface SyncInfo {
  upstream: string;
  /** Local commits not on the upstream. */
  ahead: number;
  /** Upstream commits not merged locally. */
  behind: number;
  /** True when `git fetch` ran before counting, i.e. the numbers reflect the real remote. */
  fetched: boolean;
  /** True while a network fetch is still in progress for this entry. */
  checking?: boolean;
}

export interface GitInfo {
  branch: string;
  commit?: CommitInfo;
  /** Absent when the branch has no upstream. */
  sync?: SyncInfo;
}

export interface LanguageShare {
  name: string;
  color: string;
  /** 0–100, rounded to one decimal. */
  percent: number;
}

/** Why a project folder cannot be reached: its drive is not connected, or it was deleted or moved. */
export type Unavailable = 'offline' | 'deleted';

export interface ProjectMetadata {
  exists: boolean;
  /** Set when `exists` is false. An offline project keeps its last known git and language info. */
  availability?: Unavailable;
  /** `null` when the folder is not a git repository. */
  git: GitInfo | null;
  languages: LanguageShare[];
  autoLogoPath?: string;
  /** When the local part (git state, auto logo) was last refreshed. */
  fetchedAt: number;
  /** When the language scan was last run (0 = never). */
  languagesAt: number;
}
