import type { HistoryFilter } from '../stores/repositoryStore';

export interface Draft {
  search: string;
  author: string;
  since: string;
  until: string;
  file: string;
  follow: boolean;
  currentBranch: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');
/** Seconds to the local `yyyy-mm-dd` an `<input type="date">` shows. */
export function dateInput(seconds?: number) {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** A local day's first second, or its last one for an inclusive end. */
export function dateSeconds(value: string, end = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const date = end
    ? new Date(year, month - 1, day, 23, 59, 59)
    : new Date(year, month - 1, day, 0, 0, 0);
  const seconds = Math.floor(date.getTime() / 1000);
  return seconds > 0 ? seconds : undefined;
}
export function draftFilter(draft: Draft): HistoryFilter {
  const file = draft.file.trim().replace(/^\.?\/+/, '');
  const filter: HistoryFilter = {
    search: draft.search.trim() || undefined,
    author: draft.author.trim() || undefined,
    since: dateSeconds(draft.since),
    until: dateSeconds(draft.until, true),
    file: file || undefined,
    follow: (file && draft.follow) || undefined,
    currentBranch: draft.currentBranch || undefined,
  };
  return Object.fromEntries(
    Object.entries(filter).filter(([, value]) => value !== undefined),
  ) as HistoryFilter;
}
export const toDraft = (filter: HistoryFilter): Draft => ({
  search: filter.search || '',
  author: filter.author || '',
  since: dateInput(filter.since),
  until: dateInput(filter.until),
  file: filter.file || '',
  follow: !!filter.follow,
  currentBranch: !!filter.currentBranch,
});
