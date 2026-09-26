import type { FileStatus, RepositoryStatus } from '@alune/shared';

export interface StatusRecord {
  path: string;
  oldPath?: string;
  raw: string;
  kind: string;
  xy: string;
}

// Porcelain v2 -z preserves literal paths, including whitespace and newlines.
export function parseStatus(output: string): RepositoryStatus & {
  head: string;
  records: StatusRecord[];
} {
  const result: ReturnType<typeof parseStatus> = {
    branch: '',
    head: '',
    ahead: 0,
    behind: 0,
    files: [],
    records: [],
  };
  const tokens = output.split('\0');
  const statuses: Record<string, FileStatus['status']> = {
    A: 'added',
    M: 'modified',
    T: 'modified',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
  };
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw.startsWith('# branch.head '))
      result.branch = raw.slice(14) === '(detached)' ? '' : raw.slice(14);
    else if (raw.startsWith('# branch.oid ')) result.head = raw.slice(13);
    else if (raw.startsWith('# branch.upstream ')) result.upstream = raw.slice(18);
    else if (raw.startsWith('# branch.ab ')) {
      const match = raw.match(/\+(\d+) -(\d+)/);
      if (match) {
        result.ahead = Number(match[1]);
        result.behind = Number(match[2]);
      }
    } else if (/^[12u] /.test(raw)) {
      const fields = raw.split(' ');
      const kind = fields[0];
      const xy = fields[1];
      const path = fields.slice(kind === '1' ? 8 : kind === '2' ? 9 : 10).join(' ');
      const oldPath = kind === '2' ? tokens[++i] : undefined;
      result.records.push({ path, oldPath, raw, kind, xy });
      if (kind === 'u')
        result.files.push({ path, status: 'modified', staged: false, conflicted: true });
      else {
        if (xy[0] !== '.')
          result.files.push({
            path,
            ...(oldPath && (xy[0] === 'R' || xy[0] === 'C') ? { oldPath } : {}),
            status: statuses[xy[0]] || 'modified',
            staged: true,
          });
        if (xy[1] !== '.')
          result.files.push({
            path,
            ...(oldPath && (xy[1] === 'R' || xy[1] === 'C') ? { oldPath } : {}),
            status: statuses[xy[1]] || 'modified',
            staged: false,
          });
      }
    } else if (raw.startsWith('? ') || raw.startsWith('! ')) {
      const path = raw.slice(2);
      result.records.push({ path, raw, kind: raw[0], xy: raw[0].repeat(2) });
      result.files.push({ path, status: raw[0] === '?' ? 'untracked' : 'ignored', staged: false });
    }
  }
  return result;
}
