import type { GraphCommit } from './repository';

export const BLAME_MAX_BYTES = 256 * 1024;
export const BLAME_MAX_LINES = 5000;
export const BLAME_TIMEOUT_MS = 15000;

export interface BlameOptions {
  path: string;
  revision?: string;
  ignoreWhitespace?: boolean;
  useIgnoreRevs?: boolean;
  // One-based line in the displayed version, resolved again on the server.
  previousLine?: number;
  expectedVersion?: string;
}

export interface BlameCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  summary: string;
}

export interface BlameLine {
  line: number;
  originalLine: number;
  hash: string;
  path: string;
  previous?: { hash: string; path: string };
  uncommitted: boolean;
  ignored?: boolean;
  unblamable?: boolean;
}

export type BlameResult = {
  path: string;
  revision?: string;
} & (
  | {
      kind: 'ready';
      version: string;
      content: string;
      lines: BlameLine[];
      commits: Record<string, BlameCommit>;
      ignoreRevsApplied: boolean;
      focusLine?: number;
      notice?: string;
    }
  | { kind: 'unavailable'; message: string }
);

export interface BlameCommitDetail extends GraphCommit {
  body: string;
}
