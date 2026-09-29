import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { pullRequestRange } from '@alune/shared';
import type {
  PullRequestActions,
  PullRequestFile,
  PullRequestMutation,
  PullRequestProvider,
} from '@alune/shared';

export function requestRevision(
  value: any,
  provider: PullRequestProvider,
): string {
  const github = provider === 'github';
  const refs = github
    ? [value?.head?.sha, value?.base?.sha]
    : [
        value?.diff_refs?.head_sha,
        value?.diff_refs?.base_sha,
        value?.diff_refs?.start_sha,
      ];
  if (
    refs.some(
      (ref) => typeof ref !== 'string' || !/^[a-f0-9]{40,64}$/i.test(ref),
    )
  )
    return '';
  return createHash('sha256')
    .update(
      JSON.stringify([
        ...refs,
        github ? value.base?.ref : value.target_branch,
        github ? value.head?.ref : value.source_branch,
      ]),
    )
    .digest('hex');
}

export function assertRevision(
  value: any,
  query: { revision: string; provider: PullRequestProvider },
) {
  if (
    !query.revision ||
    requestRevision(value, query.provider) !== query.revision
  )
    throw new ConflictException(
      'Diff 或目标分支已变化，请刷新详情并重新选择代码范围；评论草稿已保留。',
    );
}

export function validateMutation(input: unknown): PullRequestMutation {
  const query = input as PullRequestMutation;
  if (
    !['comment', 'merge', 'close'].includes(query.action) ||
    typeof query.operationId !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(query.operationId) ||
    typeof query.revision !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(query.revision)
  )
    throw new BadRequestException('操作或代码版本无效，请刷新详情后重试。');
  if (query.action === 'comment') {
    if (
      typeof query.body !== 'string' ||
      !query.body.trim() ||
      query.body.length > 60000
    )
      throw new BadRequestException('评论不能为空，且不能超过 60000 个字符。');
    const p = query.position;
    if (
      p !== undefined &&
      (!p ||
        typeof p !== 'object' ||
        typeof p.path !== 'string' ||
        !p.path ||
        p.path.length > 4096 ||
        !['LEFT', 'RIGHT'].includes(p.side) ||
        !Number.isSafeInteger(p.startLine) ||
        p.startLine < 1 ||
        !Number.isSafeInteger(p.endLine) ||
        p.endLine < p.startLine ||
        !Number.isSafeInteger(p.filePage) ||
        p.filePage < 1 ||
        p.filePage > 10000)
    )
      throw new BadRequestException(
        '代码评论范围无效，请在同一文件、同一 Diff 区块的同一侧选择连续行。',
      );
  } else if (query.position !== undefined || query.body !== undefined)
    throw new BadRequestException('状态操作不能携带评论。');
  if (
    query.action === 'merge' &&
    !['merge', 'squash', 'rebase'].includes(query.method!)
  )
    throw new BadRequestException('请选择有效的合并方式。');
  return query;
}

const gitlabMergeReasons: Record<string, string> = {
  conflict: '存在合并冲突。',
  need_rebase: '需要先变基以满足项目合并策略。',
  ci_must_pass: '流水线尚未通过。',
  ci_still_running: '流水线仍在运行。',
  not_approved: '尚未获得要求的审批。',
  discussions_not_resolved: '仍有未解决的讨论。',
  draft_status: '草稿 MR 不能合并。',
  checking: '平台正在检查合并条件，请稍后刷新。',
  unchecked: '平台尚未检查合并条件，请稍后刷新。',
  approvals_syncing: '审批状态正在同步。',
  blocked_status: '被关联的合并请求阻塞。',
  not_open: 'MR 已关闭或已合并。',
  policies_denied: '项目策略禁止合并。',
  merge_time: '尚未到允许合并的时间。',
  requested_changes: '仍有请求修改的 Review。',
  security_policy_violations: '安全策略阻止合并。',
};

export function requestActions(
  value: any,
  project: any,
  user: any,
  provider: PullRequestProvider,
  authenticated: boolean,
): PullRequestActions {
  const github = provider === 'github';
  const state =
    value.merged_at || value.state === 'merged'
      ? 'merged'
      : ['open', 'opened'].includes(value.state)
        ? 'open'
        : 'closed';
  const permissions = project?.permissions;
  const maintainer = github
    ? permissions?.push === true ||
      permissions?.maintain === true ||
      permissions?.admin === true
    : Math.max(
        permissions?.project_access?.access_level ?? 0,
        permissions?.group_access?.access_level ?? 0,
      ) >= 30;
  const canManage = maintainer || (github && permissions?.triage === true);
  const author =
    authenticated &&
    (github
      ? Boolean(user?.login && user.login === value.user?.login)
      : Boolean(user?.id && user.id === value.author?.id));
  const revision = requestRevision(value, provider);
  const inactive =
    state === 'merged'
      ? '此 PR/MR 已合并。'
      : state === 'closed'
        ? '此 PR/MR 已关闭。'
        : undefined;
  const authReason = !authenticated
    ? '请配置有写入权限的访问令牌。'
    : undefined;
  const unavailable = !revision
    ? '平台尚未提供完整的代码版本，请稍后刷新。'
    : undefined;
  const commentReason =
    authReason ||
    unavailable ||
    ((value.locked || value.discussion_locked) && !canManage
      ? '讨论已锁定，当前用户不能发表评论。'
      : undefined);
  const closeReason =
    authReason ||
    inactive ||
    unavailable ||
    (!canManage && !author
      ? '只有作者或具有项目管理权限的用户可以关闭。'
      : undefined);
  const methods: PullRequestActions['mergeMethods'] = [];
  if (github) {
    if (project?.allow_merge_commit)
      methods.push({ value: 'merge', label: '创建合并提交' });
    if (project?.allow_squash_merge)
      methods.push({ value: 'squash', label: '压缩并合并' });
    if (project?.allow_rebase_merge)
      methods.push({ value: 'rebase', label: '变基并合并' });
  } else if (['merge', 'rebase_merge', 'ff'].includes(project?.merge_method)) {
    const label = {
      merge: '合并提交',
      rebase_merge: '半线性合并',
      ff: '快进合并',
    }[project.merge_method as 'merge' | 'rebase_merge' | 'ff'];
    if (project.squash_option !== 'always')
      methods.push({ value: 'merge', label: `${label}（不压缩）` });
    if (project.squash_option !== 'never')
      methods.push({ value: 'squash', label: `压缩并${label}` });
  }
  let mergeReason = authReason || inactive || unavailable;
  if (!mergeReason && !(github ? maintainer : value.user?.can_merge === true))
    mergeReason = '当前用户没有目标分支的合并权限。';
  if (!mergeReason && (value.draft || value.work_in_progress))
    mergeReason = '草稿 PR/MR 不能合并。';
  if (!mergeReason && !methods.length)
    mergeReason = '无法确定项目允许的合并方式，请在托管平台核对设置。';
  if (!mergeReason && github) {
    mergeReason =
      value.mergeable === false || value.mergeable_state === 'dirty'
        ? '存在合并冲突。'
        : value.mergeable === null || value.mergeable_state === 'unknown'
          ? '平台正在检查合并条件，请稍后刷新。'
          : value.mergeable_state === 'blocked'
            ? '所需检查、审批或分支保护规则阻止合并。'
            : value.mergeable_state === 'behind'
              ? '分支已落后于目标分支，请先更新分支。'
              : value.mergeable !== true ||
                  !['clean', 'unstable', 'has_hooks'].includes(
                    value.mergeable_state,
                  )
                ? '平台尚未确认可以合并，请刷新或在浏览器中核对。'
                : undefined;
  }
  if (!mergeReason && !github) {
    const status = value.detailed_merge_status;
    mergeReason =
      status !== 'mergeable'
        ? gitlabMergeReasons[status] ||
          '平台尚未确认所有合并条件，请刷新或在浏览器中核对。'
        : undefined;
  }
  return {
    revision,
    state,
    targetBranch: github ? value.base?.ref || '' : value.target_branch || '',
    comment: { allowed: !commentReason, reason: commentReason },
    close: { allowed: !closeReason, reason: closeReason },
    merge: { allowed: !mergeReason, reason: mergeReason },
    mergeMethods: methods,
  };
}

export function codeCommentPayload(
  query: PullRequestMutation,
  value: any,
  file: PullRequestFile,
) {
  const p = query.position!;
  const rows =
    file.patch && !file.notice ? pullRequestRange(file.patch, p) : null;
  if (!rows)
    throw new ConflictException(
      '此选区不支持评论或 Diff 已变化；请选择同一 Diff 区块、同一侧的连续行。',
    );
  const start = rows[0],
    end = rows[rows.length - 1];
  if (query.provider === 'github')
    return {
      body: query.body,
      commit_id: value.head.sha,
      path: file.path,
      side: p.side,
      line: p.endLine,
      ...(p.startLine !== p.endLine
        ? { start_side: p.side, start_line: p.startLine }
        : {}),
    };
  const path = file.previousPath || file.path;
  // GitLab hashes the current path and uses both diff cursors, including the
  // cursor of the opposite side for additions/deletions (not an absent-line 0).
  const lineCode = (row: typeof start) =>
    `${createHash('sha1').update(file.path).digest('hex')}_${row.oldPosition}_${row.newPosition}`;
  const endpoint = (row: typeof start) => ({
    line_code: lineCode(row),
    type: p.side === 'LEFT' ? 'old' : 'new',
    ...(row.oldLine ? { old_line: row.oldLine } : {}),
    ...(row.newLine ? { new_line: row.newLine } : {}),
  });
  if (!value.diff_refs)
    throw new BadGatewayException('GitLab 未提供 Diff 版本。');
  return {
    body: query.body,
    position: {
      position_type: 'text',
      base_sha: value.diff_refs.base_sha,
      start_sha: value.diff_refs.start_sha,
      head_sha: value.diff_refs.head_sha,
      old_path: path,
      new_path: file.path,
      ...(end.oldLine ? { old_line: end.oldLine } : {}),
      ...(end.newLine ? { new_line: end.newLine } : {}),
      ...(p.startLine !== p.endLine
        ? { line_range: { start: endpoint(start), end: endpoint(end) } }
        : {}),
    },
  };
}
