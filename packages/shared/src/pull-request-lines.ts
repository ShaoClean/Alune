import type { PullRequestCommentPosition } from './types/pull-requests';

export interface PullRequestDiffLine {
  text: string;
  kind: 'meta' | 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  hunk: number;
  oldPosition: number;
  newPosition: number;
}

// Count only lines inside a declared hunk. Never offer a truncated tail as a location.
export function pullRequestDiffLines(patch: string): PullRequestDiffLine[] {
  let oldLine = 0,
    newLine = 0,
    oldLeft = 0,
    newLeft = 0,
    hunk = 0;
  return patch.split('\n').map((text) => {
    const header = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    const row: PullRequestDiffLine = {
      text,
      kind: 'meta',
      hunk,
      oldPosition: oldLine,
      newPosition: newLine,
    };
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      oldLeft = Number(header[2] ?? 1);
      newLeft = Number(header[4] ?? 1);
      row.hunk = ++hunk;
    } else if (hunk && text.startsWith(' ') && oldLeft > 0 && newLeft > 0) {
      row.kind = 'context';
      row.oldLine = oldLine++;
      row.newLine = newLine++;
      oldLeft--;
      newLeft--;
    } else if (hunk && text.startsWith('-') && oldLeft > 0) {
      row.kind = 'remove';
      row.oldLine = oldLine++;
      oldLeft--;
    } else if (hunk && text.startsWith('+') && newLeft > 0) {
      row.kind = 'add';
      row.newLine = newLine++;
      newLeft--;
    }
    return row;
  });
}

export function pullRequestRange(
  patch: string,
  position: Pick<PullRequestCommentPosition, 'side' | 'startLine' | 'endLine'>,
): PullRequestDiffLine[] | null {
  const { side, startLine, endLine } = position;
  if (
    !['LEFT', 'RIGHT'].includes(side) ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine
  )
    return null;
  const key = side === 'LEFT' ? 'oldLine' : 'newLine';
  const lines = pullRequestDiffLines(patch);
  const start = lines.findIndex((row) => row[key] === startLine);
  const end = lines.findIndex((row) => row[key] === endLine);
  if (start < 0 || end < start || lines[start].hunk !== lines[end].hunk) return null;
  const rows = lines.slice(start, end + 1);
  // A range cannot straddle added/deleted sides, hunk headers, or missing lines.
  if (rows.length !== endLine - startLine + 1 || rows.some((row, i) => row[key] !== startLine + i))
    return null;
  return rows;
}
