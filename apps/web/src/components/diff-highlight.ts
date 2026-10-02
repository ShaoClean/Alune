import type { ReactNode } from 'react';
import type { DiffLine } from './diff-lines';
import { fileLanguage } from './file-language';
import type { highlightLines } from './syntax-highlight';

// A patch may contain several languages (history's "all files"). Reset the
// grammar at every file/hunk boundary; never tokenize diff headers as code.
export function highlightDiffLines(
  lines: DiffLine[],
  path: string | undefined,
  highlight: typeof highlightLines,
): Array<ReactNode[] | undefined> {
  const output: Array<ReactNode[] | undefined> = new Array(lines.length);
  let activePath = path ?? '';
  let start = 0;
  const flush = (end: number) => {
    const language = fileLanguage(activePath);
    if (!language) return;
    for (const side of ['remove', 'add'] as const) {
      const indices: number[] = [];
      for (let i = start; i < end; i++)
        if (lines[i].kind === 'context' || lines[i].kind === side) indices.push(i);
      if (!indices.length) continue;
      const tokens = highlight(indices.map((i) => lines[i].text.slice(1)).join('\n'), language.id);
      indices.forEach((i, row) => {
        if (tokens) output[i] = tokens[row];
      });
    }
  };
  lines.forEach((line, index) => {
    if (line.kind !== 'meta') return;
    // "No newline" markers do not start a new hunk.
    if (line.text.startsWith('\\')) return;
    flush(index);
    start = index + 1;
    if (line.text.startsWith('diff ')) activePath = path ?? '';
    if (/^(---|\+\+\+) /.test(line.text)) {
      let header = line.text.slice(4).split('\t')[0];
      if (header.startsWith('"')) {
        try {
          header = JSON.parse(header);
        } catch {
          // Git quotes non-ASCII paths with C-style octal escapes. The
          // language only needs the extension, which remains literal.
          if (header.endsWith('"')) header = header.slice(1, -1);
        }
      }
      if (header !== '/dev/null') activePath = header.replace(/^[ab]\//, '');
    }
  });
  flush(lines.length);
  return output;
}
