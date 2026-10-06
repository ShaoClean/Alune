import { parseLfsPointer } from '@alune/shared';
import { getDiffLines } from './diff-lines';

export function lfsDiffPointers(diff: string) {
  if (diff.split('\n').filter((line) => line.startsWith('diff ')).length !== 1) return null;
  const lines = getDiffLines(diff);
  const before = parseLfsPointer(
    lines
      .filter((line) => line.kind === 'context' || line.kind === 'remove')
      .map((line) => line.text.slice(1))
      .join('\n'),
  );
  const after = parseLfsPointer(
    lines
      .filter((line) => line.kind === 'context' || line.kind === 'add')
      .map((line) => line.text.slice(1))
      .join('\n'),
  );
  return before || after ? { before, after } : null;
}
