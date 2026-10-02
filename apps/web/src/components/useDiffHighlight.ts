import { useMemo } from 'react';
import type { DiffLine } from './diff-lines';
import { highlightDiffLines } from './diff-highlight';
import { HIGHLIGHT_MAX_CHARS, useHighlighter } from './useHighlighter';

export function useDiffHighlight(lines: DiffLine[], size: number, path = '') {
  const enabled = size <= HIGHLIGHT_MAX_CHARS;
  const { module, failed } = useHighlighter(enabled, path);
  return useMemo(() => {
    if (!enabled || !module) return { tokens: [], failed, tooLarge: !enabled };
    try {
      return {
        tokens: highlightDiffLines(lines, path, module.highlightLines),
        failed: false,
        tooLarge: false,
      };
    } catch {
      return { tokens: [], failed: true, tooLarge: false };
    }
  }, [enabled, module, failed, lines, path]);
}
