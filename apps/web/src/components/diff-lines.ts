import { diffImageMediaType } from '@alune/shared';

export type DiffLine = { text: string; kind: 'meta' | 'context' | 'add' | 'remove' };
export type NumberedDiffLine = DiffLine & { oldLine?: number; newLine?: number };

export function getNumberedDiffLines(diff: string): NumberedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  return getDiffLines(diff).map((line) => {
    const hunk = line.text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
    }
    if (line.kind === 'context') return { ...line, oldLine: oldLine++, newLine: newLine++ };
    if (line.kind === 'remove') return { ...line, oldLine: oldLine++ };
    if (line.kind === 'add') return { ...line, newLine: newLine++ };
    return line;
  });
}

export function getDiffLines(diff: string): DiffLine[] {
  let inHunk = false;
  return diff.split('\n').map((text) => {
    if (text.startsWith('diff ')) inHunk = false;
    if (text.startsWith('@@')) {
      inHunk = true;
      return { text, kind: 'meta' };
    }
    // Once in a hunk, even "+++ " and "--- " are file content, not headers.
    const kind = !inHunk
      ? 'meta'
      : text.startsWith('+')
        ? 'add'
        : text.startsWith('-')
          ? 'remove'
          : text.startsWith(' ')
            ? 'context'
            : 'meta';
    return { text, kind };
  });
}

export type ImageDiffKind = 'added' | 'deleted' | 'modified';

const isBinaryPatch = (diff: string) =>
  /^Binary files /m.test(diff) || /^GIT binary patch$/m.test(diff);

// A single-file binary patch for a renderable image path. Anything else — text
// hunks, multi-file patches, empty new files — keeps the existing notices.
export function getImageDiffKind(diff: string, path: string): ImageDiffKind | null {
  if (!path || !diffImageMediaType(path)) return null;
  if (diff.split('\n').filter((line) => line.startsWith('diff ')).length !== 1) return null;
  if (getDiffLines(diff).some((line) => line.kind !== 'meta')) return null;
  if (!isBinaryPatch(diff)) return null;
  if (/^new file mode /m.test(diff)) return 'added';
  if (/^deleted file mode /m.test(diff)) return 'deleted';
  return 'modified';
}

export function getDiffNotice(diff: string): string | null {
  if (diff.split('\n').filter((line) => line.startsWith('diff ')).length !== 1) return null;
  if (getDiffLines(diff).some((line) => line.kind !== 'meta')) return null;
  if (isBinaryPatch(diff)) return '二进制文件，无法显示文本差异。';
  if (/^new file mode /m.test(diff)) return '新增空文件';
  return null;
}

/**
 * Change navigation stops at each run of consecutive added/removed lines, not at
 * `@@` headers, so a hunk with several edits yields several stops. "\ No newline"
 * markers stay inside a run. Returns each run's line indexes, in patch order.
 */
export function getDiffChangeSegments(lines: NumberedDiffLine[]): number[][] {
  const segments: number[][] = [];
  let current: number[] | null = null;
  lines.forEach((line, index) => {
    if (line.kind === 'add' || line.kind === 'remove') {
      if (!current) segments.push((current = []));
      current.push(index);
    } else if (!(line.kind === 'meta' && line.text.startsWith('\\'))) {
      current = null;
    }
  });
  return segments;
}
