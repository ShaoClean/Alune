export type PartialDiffAction = 'stage' | 'unstage' | 'discard';
export type PartialDiffSelection =
  { hunks: number[]; lines?: never } | { lines: number[]; hunks?: never };
export type PartialDiffPreview = {
  diff: string;
  revision?: string;
  unavailableReason?: string;
};
export type PartialDiffRequest = {
  file: string;
  action: PartialDiffAction;
  revision: string;
  selection: PartialDiffSelection;
  confirmed?: boolean;
};
export type PatchRow = {
  index: number;
  kind: 'context' | 'add' | 'remove';
  content: string;
};
export type PatchHunk = {
  index: number;
  headerIndex: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  rows: PatchRow[];
};

// Row identifiers refer to the exact snapshot, including metadata lines. A
// no-newline marker belongs to its preceding row, never to the selection.
export function parsePatchHunks(diff: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;
  const lines = diff.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) {
      current = {
        index: hunks.length,
        headerIndex: index,
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newCount: Number(match[4] ?? 1),
        rows: [],
      };
      hunks.push(current);
    } else if (line.startsWith('diff ')) current = undefined;
    else if (current && /^[ +\-]/.test(line)) {
      current.rows.push({
        index,
        kind: line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context',
        content: line.slice(1) + (lines[index + 1]?.startsWith('\\ No newline') ? '' : '\n'),
      });
    }
  }
  for (const hunk of hunks) {
    if (
      hunk.rows.filter((row) => row.kind !== 'add').length !== hunk.oldCount ||
      hunk.rows.filter((row) => row.kind !== 'remove').length !== hunk.newCount
    )
      throw new Error('差异不完整，请刷新后重试。');
  }
  return hunks;
}
