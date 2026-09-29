import { BadGatewayException } from '@nestjs/common';
import type {
  PullRequestCodeContext,
  PullRequestComment,
  PullRequestDiscussion,
  PullRequestDiscussionKind,
  PullRequestFile,
  PullRequestProvider,
} from '@alune/shared';

const MAX_PATCH_LENGTH = 200_000;
export const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';
export const count = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const line = (value: unknown) =>
  count(value) && Number(value) > 0 ? Number(value) : undefined;

function invalid(): never {
  throw new BadGatewayException('托管平台返回的数据格式不正确，请重试。');
}

// A provider may return only part of a patch without a dedicated truncation flag.
function patchCounts(patch: string) {
  let additions = 0,
    deletions = 0,
    oldRemaining = 0,
    newRemaining = 0;
  let hunks = 0,
    complete = true;
  for (const row of patch.split('\n')) {
    const hunk = row.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (hunk) {
      if (oldRemaining || newRemaining) complete = false;
      oldRemaining = hunk[1] === undefined ? 1 : Number(hunk[1]);
      newRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      hunks++;
    } else if (hunks) {
      if (row.startsWith('+')) {
        additions++;
        newRemaining--;
      } else if (row.startsWith('-')) {
        deletions++;
        oldRemaining--;
      } else if (row.startsWith(' ')) {
        oldRemaining--;
        newRemaining--;
      }
      if (oldRemaining < 0 || newRemaining < 0) complete = false;
    }
  }
  return {
    additions,
    deletions,
    complete: complete && hunks > 0 && oldRemaining === 0 && newRemaining === 0,
  };
}

export function normalizeFile(
  value: any,
  provider: PullRequestProvider,
): PullRequestFile {
  const github = provider === 'github';
  const path = text(
    github ? value?.filename : value?.new_path || value?.old_path,
  );
  if (!path) invalid();
  const raw = text(github ? value.patch : value.diff);
  const stats = patchCounts(raw);
  let notice: string | undefined;
  let patch: string | null = raw || null;
  if (value.too_large || value.collapsed || raw.length > MAX_PATCH_LENGTH) {
    patch = null;
    notice = '文件 Diff 过大或已被平台折叠，请在浏览器中查看。';
  } else if (/^Binary files |^GIT binary patch$/m.test(raw)) {
    patch = null;
    notice = '二进制文件，无法显示文本差异。';
  } else if (!raw) {
    notice =
      '平台未提供文本 Diff，可能是二进制文件、空文件、仅重命名或超过平台限制。';
  } else if (
    !stats.complete ||
    (github &&
      ((count(value.additions) !== null &&
        value.additions !== stats.additions) ||
        (count(value.deletions) !== null &&
          value.deletions !== stats.deletions)))
  ) {
    notice =
      '平台返回的 Diff 不完整或格式不受支持；以下仅展示可用内容，请在浏览器中查看完整变动。';
  }
  return {
    path,
    previousPath:
      text(github ? value.previous_filename : value.old_path) || undefined,
    status: (github ? value.status === 'added' : value.new_file)
      ? 'added'
      : (github ? value.status === 'removed' : value.deleted_file)
        ? 'deleted'
        : (github ? value.status === 'renamed' : value.renamed_file)
          ? 'renamed'
          : 'modified',
    additions: github
      ? count(value.additions)
      : raw && stats.complete
        ? stats.additions
        : null,
    deletions: github
      ? count(value.deletions)
      : raw && stats.complete
        ? stats.deletions
        : null,
    patch,
    notice,
  };
}

function context(
  value: any,
  provider: PullRequestProvider,
): PullRequestCodeContext | undefined {
  if (provider === 'github') {
    if (!text(value.path)) return undefined;
    const original = value.line == null && value.original_line != null;
    const position = line(value.line ?? value.original_line);
    const patch = text(value.diff_hunk);
    return {
      path: value.path,
      oldLine: value.side === 'LEFT' ? position : undefined,
      newLine: value.side !== 'LEFT' ? position : undefined,
      startLine: line(value.start_line ?? value.original_start_line),
      startSide: value.start_side === 'LEFT' ? 'LEFT' : 'RIGHT',
      outdated: original,
      patch: patch.length <= MAX_PATCH_LENGTH ? patch || undefined : undefined,
      notice:
        patch.length > MAX_PATCH_LENGTH
          ? '评论的代码上下文过大，请在浏览器中查看。'
          : undefined,
    };
  }
  const position = value.position;
  if (!position || !text(position.new_path || position.old_path))
    return undefined;
  return {
    path: position.new_path || position.old_path,
    oldPath: text(position.old_path) || undefined,
    oldLine: line(position.old_line),
    newLine: line(position.new_line),
    startLine: line(
      position.line_range?.start?.type === 'old'
        ? position.line_range.start.old_line
        : (position.line_range?.start?.new_line ??
            position.line_range?.start?.old_line),
    ),
    startSide: position.line_range?.start?.type === 'old' ? 'LEFT' : 'RIGHT',
    outdated: value.active === false,
  };
}

function comment(
  value: any,
  provider: PullRequestProvider,
  kind: PullRequestDiscussionKind,
): PullRequestComment {
  if (
    (!Number.isSafeInteger(value?.id) && typeof value?.id !== 'string') ||
    !String(value.id)
  )
    invalid();
  const createdAt = text(value.submitted_at || value.created_at);
  if (createdAt && !Number.isFinite(Date.parse(createdAt))) invalid();
  return {
    id: String(value.id),
    author:
      text(
        provider === 'github' ? value.user?.login : value.author?.username,
      ) || '已删除的用户',
    body: text(value.body),
    createdAt,
    replyTo:
      value.in_reply_to_id == null ? undefined : String(value.in_reply_to_id),
    reviewState: kind === 'reviews' ? text(value.state) : undefined,
    system: Boolean(value.system),
    context: context(value, provider),
  };
}

export function normalizeDiscussion(
  value: any,
  provider: PullRequestProvider,
  kind: PullRequestDiscussionKind,
): PullRequestDiscussion {
  if (provider === 'github') {
    const note = comment(value, provider, kind);
    return { id: `${kind}:${note.replyTo || note.id}`, comments: [note] };
  }
  if (typeof value?.id !== 'string' || !value.id || !Array.isArray(value.notes))
    invalid();
  const resolvable = value.notes.filter((note: any) => note.resolvable);
  return {
    id: value.id,
    resolved: resolvable.length
      ? resolvable.every((note: any) => note.resolved)
      : undefined,
    comments: value.notes.map((note: any) => comment(note, provider, kind)),
  };
}
