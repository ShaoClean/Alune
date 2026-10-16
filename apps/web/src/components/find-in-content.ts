export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindMatch {
  unit: number;
  start: number;
  end: number;
}

// Same cap as VSCode: past this the count reads "19999+" and highlighting stops.
export const FIND_MATCH_LIMIT = 19999;

export type FindPattern = { regex: RegExp } | { error: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);

export function compileFindPattern(query: string, options: FindOptions): FindPattern | null {
  if (!query) return null;
  const source = options.regex ? query : escapeRegExp(query);
  const flags = `gm${options.caseSensitive ? '' : 'i'}`;
  try {
    return { regex: new RegExp(source, `${flags}u`) };
  } catch {
    // Unicode mode rejects loose escapes such as `[\w-]` that users expect to work.
    try {
      return { regex: new RegExp(source, flags) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Whole-word matching follows VSCode: a match counts when both of its edges
// sit on a word boundary, which also works for regex and non-ASCII words.
function onWordBoundary(text: string, start: number, end: number) {
  const first = text[start];
  const last = text[end - 1];
  return (
    (!isWordChar(first) || !isWordChar(text[start - 1])) &&
    (!isWordChar(last) || !isWordChar(text[end]))
  );
}

export function findMatches(
  units: readonly string[],
  regex: RegExp,
  wholeWord: boolean,
  limit = FIND_MATCH_LIMIT,
): { matches: FindMatch[]; truncated: boolean } {
  const matches: FindMatch[] = [];
  for (let unit = 0; unit < units.length; unit += 1) {
    const text = units[unit];
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        // Empty matches (e.g. `^` or `a*`) have nothing to highlight.
        regex.lastIndex = start + (text.codePointAt(start)! > 0xffff ? 2 : 1);
        continue;
      }
      if (wholeWord && !onWordBoundary(text, start, end)) {
        regex.lastIndex = start + 1;
        continue;
      }
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({ unit, start, end });
    }
  }
  return { matches, truncated: false };
}

// After content refreshes, keep the reader near the previous match instead of
// jumping back to the top.
export function nearestMatchIndex(
  matches: readonly FindMatch[],
  previous: Pick<FindMatch, 'unit' | 'start'> | null,
) {
  if (!matches.length) return -1;
  if (!previous) return 0;
  const index = matches.findIndex(
    (match) =>
      match.unit > previous.unit || (match.unit === previous.unit && match.start >= previous.start),
  );
  return index < 0 ? matches.length - 1 : index;
}
