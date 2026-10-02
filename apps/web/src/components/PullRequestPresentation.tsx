import type { PullRequestItem } from '@alune/shared';
import { DialogIcon } from '@alune/ui';

export function PullRequestStatus({ state }: Pick<PullRequestItem, 'state'>) {
  return (
    <span className={`pull-request-status pull-request-status--${state}`}>
      <DialogIcon name={state === 'merged' ? 'merge' : state === 'closed' ? 'archive' : 'pr'} />
      {{ open: '开放中', closed: '已关闭', merged: '已合并' }[state]}
    </span>
  );
}

export function PullRequestBranches({
  sourceBranch,
  targetBranch,
}: Pick<PullRequestItem, 'sourceBranch' | 'targetBranch'>) {
  const source = sourceBranch || '已删除分支';
  const target = targetBranch || '未知分支';
  return (
    <span className="pull-request-branches" title={`${source} → ${target}`}>
      <DialogIcon name="branch" />
      <code>{source}</code>
      <span aria-hidden="true">→</span>
      <code>{target}</code>
    </span>
  );
}
