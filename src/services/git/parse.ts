import { CommitInfo } from '../../domain/model';

/** Field separator used in the `git log --format` string. */
export const GIT_FIELD_SEPARATOR = '\u001f';

export const GIT_LOG_FORMAT = ['%h', '%s', '%cr', '%an'].join(`%x1f`);

/** Parses `git rev-list --left-right --count HEAD...@{upstream}` output ("ahead<TAB>behind"). */
export function parseAheadBehind(output: string): { ahead: number; behind: number } | undefined {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return undefined;
  }
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

/** Parses one line produced by `git log -1 --format=GIT_LOG_FORMAT`. */
export function parseCommitLine(line: string): CommitInfo | undefined {
  const [hash, subject, relativeDate, author] = line.trim().split(GIT_FIELD_SEPARATOR);
  if (!hash) {
    return undefined;
  }
  return { hash, subject: subject ?? '', relativeDate: relativeDate ?? '', author: author ?? '' };
}
