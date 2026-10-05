export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseCommit {
  hash: string;
  message: string;
  author: string;
  published: boolean;
}

export interface RebasePlanEntry {
  hash: string;
  action: RebaseAction;
  /** Full replacement message for reword; full combined message for squash. */
  message?: string;
}

export interface RebasePreview {
  base: string;
  head: string;
  branch: string;
  token: string;
  commits: RebaseCommit[];
}

export interface RebaseRequest {
  base: string;
  token: string;
  entries: RebasePlanEntry[];
  acknowledgePublished: boolean;
}

export interface RebaseState {
  active: boolean;
  managed: boolean;
  /** False when only an interrupted preparation or finished session remains. */
  inProgress: boolean;
  conflicts: string[];
  originalHead?: string;
  branch?: string;
}

export interface RebaseResult {
  state: RebaseState;
  output: string;
  error?: string;
}

export interface RebaseConflict {
  path: string;
  token: string;
  ours: string | null;
  theirs: string | null;
  content: string | null;
  editable: boolean;
  hasOurs: boolean;
  hasTheirs: boolean;
}

export interface RebaseResolution {
  path: string;
  token: string;
  choice: 'ours' | 'theirs' | 'delete' | 'content';
  content?: string;
}

export interface RebasePreviewCommit {
  hashes: string[];
  message: string;
}

// Both the confirmation UI and the executor use the same grouping rules.
export function previewRebasePlan(
  commits: RebaseCommit[],
  entries: RebasePlanEntry[],
): RebasePreviewCommit[] {
  if (!Array.isArray(entries) || entries.length !== commits.length)
    throw new Error('计划必须包含基准之后的全部提交。');
  if (new TextEncoder().encode(JSON.stringify(entries)).length > 900 * 1024)
    throw new Error('提交计划过大，请缩短提交信息或分批整理（计划上限 900 KiB）。');
  const originals = new Map(commits.map((commit) => [commit.hash, commit]));
  const seen = new Set<string>();
  const result: RebasePreviewCommit[] = [];
  for (const entry of entries) {
    const original = entry && originals.get(entry.hash);
    if (!original || seen.has(entry.hash)) throw new Error('计划包含重复或未知的提交。');
    seen.add(entry.hash);
    if (!['pick', 'reword', 'squash', 'fixup', 'drop'].includes(entry.action))
      throw new Error('不支持此提交操作。');
    if (entry.action === 'drop') continue;
    const previous = result[result.length - 1];
    if ((entry.action === 'squash' || entry.action === 'fixup') && !previous)
      throw new Error('第一个保留的提交不能合并到上一个提交。');
    if (entry.action === 'reword' || entry.action === 'squash') {
      if (
        typeof entry.message !== 'string' ||
        !entry.message.trim() ||
        entry.message.includes('\0') ||
        new TextEncoder().encode(entry.message).length > 32_768
      )
        throw new Error('请输入有效的提交信息（最多 32 KiB）。');
    }
    if (entry.action === 'squash' || entry.action === 'fixup') {
      previous.hashes.push(entry.hash);
      if (entry.action === 'squash') previous.message = entry.message!;
    } else {
      result.push({
        hashes: [entry.hash],
        message: entry.action === 'reword' ? entry.message! : original.message,
      });
    }
  }
  return result;
}
