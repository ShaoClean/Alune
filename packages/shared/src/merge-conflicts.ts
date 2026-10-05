import type { ConflictBlockChoice } from './types';

export interface ConflictBlock {
  index: number;
  // The exact block text, markers included, used to detect concurrent edits.
  raw: string;
  current: string;
  incoming: string;
  // Present with merge.conflictStyle diff3 or zdiff3.
  base?: string;
  currentLabel: string;
  incomingLabel: string;
  baseLabel?: string;
}

export type ConflictSegment =
  | { kind: 'text'; text: string }
  | { kind: 'conflict'; block: ConflictBlock };

export class ConflictMarkerError extends Error {}

const opening = /^(<{7,})(?: (.*))?$/;

function lines(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function bare(line: string): string {
  return line.replace(/\r?\n$/, '');
}

function marker(line: string, char: string, size: number): string | undefined {
  const text = bare(line);
  const prefix = char.repeat(size);
  if (!text.startsWith(prefix)) return undefined;
  const rest = text.slice(size);
  if (!rest) return '';
  return rest[0] === ' ' ? rest.slice(1) : undefined;
}

// Splits Git's conflict markers (merge, diff3 and zdiff3 styles) while
// preserving every other byte, including line endings, so a resolved block can
// be written back without touching the rest of the file. Markers that do not
// form a complete block are left as ordinary text.
export function parseConflictMarkers(content: string): ConflictSegment[] {
  const source = lines(content);
  const segments: ConflictSegment[] = [];
  let text = '';
  let index = 0;
  const flush = () => {
    if (text) segments.push({ kind: 'text', text });
    text = '';
  };
  for (let i = 0; i < source.length; i++) {
    const start = bare(source[i]).match(opening);
    const block = start ? readBlock(source, i, start[1].length, start[2] ?? '') : undefined;
    if (!block) {
      text += source[i];
      continue;
    }
    flush();
    segments.push({ kind: 'conflict', block: { ...block.block, index: index++ } });
    i = block.end;
  }
  flush();
  return segments;
}

function readBlock(
  source: string[],
  start: number,
  size: number,
  currentLabel: string,
): { block: Omit<ConflictBlock, 'index'>; end: number } | undefined {
  const sections: string[] = [''];
  let baseLabel: string | undefined;
  let separator = false;
  for (let i = start + 1; i < source.length; i++) {
    const line = source[i];
    if (marker(line, '<', size) !== undefined) return undefined;
    if (!separator && sections.length === 1) {
      const label = marker(line, '|', size);
      if (label !== undefined) {
        baseLabel = label;
        sections.push('');
        continue;
      }
    }
    if (!separator && bare(line) === '='.repeat(size)) {
      separator = true;
      sections.push('');
      continue;
    }
    if (separator) {
      const label = marker(line, '>', size);
      if (label !== undefined) {
        const incoming = sections.pop()!;
        const [current, base] = sections;
        return {
          end: i,
          block: {
            raw: source.slice(start, i + 1).join(''),
            current,
            incoming,
            ...(base !== undefined ? { base, baseLabel } : {}),
            currentLabel,
            incomingLabel: label,
          },
        };
      }
    }
    sections[sections.length - 1] += line;
  }
  return undefined;
}

export function conflictBlocks(content: string): ConflictBlock[] {
  return parseConflictMarkers(content).flatMap((segment) =>
    segment.kind === 'conflict' ? [segment.block] : [],
  );
}

// Replaces one block. `expected` is the block text the user saw; a mismatch
// means the file changed since it was shown and nothing is written.
export function resolveConflictBlock(
  content: string,
  index: number,
  choice: ConflictBlockChoice,
  expected: string,
): string {
  const segments = parseConflictMarkers(content);
  const target = segments.find(
    (segment) => segment.kind === 'conflict' && segment.block.index === index,
  );
  if (!target || target.kind !== 'conflict' || target.block.raw !== expected)
    throw new ConflictMarkerError('文件内容已变化，请刷新后重新选择。');
  return segments
    .map((segment) => {
      if (segment !== target) return segment.kind === 'text' ? segment.text : segment.block.raw;
      const { current, incoming } = segment.block;
      return choice === 'current' ? current : choice === 'incoming' ? incoming : current + incoming;
    })
    .join('');
}
