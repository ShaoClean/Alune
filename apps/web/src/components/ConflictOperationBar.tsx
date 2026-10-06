import { useState } from 'react';
import { Button, Tooltip, useAluneConfirm, useFeedbackMessage } from '@alune/ui';
import { DialogCard, DialogIcon, DialogNote } from '@alune/ui';
import type { RepositoryOperationState } from '@alune/shared';
import { gitApi } from '../api';
import { operationNames, operationProgress, operationTitle, sideNames } from './conflict-model';

interface Props {
  repoId: string;
  repoName?: string;
  operation?: RepositoryOperationState;
  // Paths that still have unmerged index entries.
  conflicts: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onChanged: () => Promise<void>;
}

/** The merge, rebase, cherry-pick or revert that stopped in this worktree, with its next steps. */
export function ConflictOperationBar({
  repoId,
  repoName,
  operation,
  conflicts,
  disabled,
  onBusyChange,
  onChanged,
}: Props) {
  const message = useFeedbackMessage();
  const confirm = useAluneConfirm();
  const [running, setRunning] = useState<'continue' | 'skip' | 'abort' | null>(null);
  if (!operation && !conflicts) return null;

  if (!operation)
    return (
      <div className="conflict-bar" role="status">
        <div className="conflict-bar__main">
          <span className="conflict-bar__icon" aria-hidden="true">
            <DialogIcon name="warning" />
          </span>
          <div className="conflict-bar__text">
            <strong>{conflicts} 个文件有未解决的冲突</strong>
            <span>
              未检测到进行中的合并、变基、拣选或还原，例如应用储藏时产生的冲突。逐个解决并标记为已解决即可；应用的储藏仍保留在列表中。
            </span>
          </div>
        </div>
      </div>
    );

  const name = operationNames[operation.kind];
  const progress = operationProgress(operation);
  const sides = sideNames(operation);
  const busy = disabled || running !== null;

  const run = async (action: 'continue' | 'skip' | 'abort') => {
    setRunning(action);
    onBusyChange?.(true);
    try {
      // The refreshed status shows a finished or aborted operation; only a new stop is reported.
      if (action === 'abort') await gitApi.abortOperation(repoId);
      else {
        const result =
          action === 'continue'
            ? await gitApi.continueOperation(repoId)
            : await gitApi.skipOperation(repoId);
        if (result.conflicts) message.warning(`${name}在下一处冲突处停下，请继续解决。`);
      }
    } catch (error: any) {
      message.error(error.message || `${name}操作失败`);
    } finally {
      await onChanged().catch(() => undefined);
      setRunning(null);
      onBusyChange?.(false);
    }
  };

  const skip = () =>
    void confirm({
      level: 1,
      glyph: 'arrow-right',
      eyebrow: { label: '变基', detail: [repoName, operation.branch].filter(Boolean).join(' · ') },
      title: '跳过当前提交？',
      description: '此提交的改动不会出现在变基结果中，工作区中对它的处理也会被丢弃。',
      content: operation.subject ? (
        <DialogCard>
          <div className="dlg-card-row">
            <DialogIcon name="commit" />
            <span className="dlg-path">{operation.subject}</span>
          </div>
        </DialogCard>
      ) : undefined,
      hintVerb: '跳过',
      okText: '跳过此提交',
      busyText: '正在跳过…',
      onOk: () => run('skip'),
    });

  const abort = () =>
    void confirm({
      level: 2,
      glyph: 'undo',
      eyebrow: { label: name, detail: [repoName, operation.branch].filter(Boolean).join(' · ') },
      title: `中止${name}？`,
      description: `分支和工作区会恢复到${name}开始前的状态，已经解决的冲突和本次${name}中的改动都会丢失。`,
      content: (
        <DialogNote quiet>
          {operation.kind === 'rebase'
            ? '变基中已完成的提交也会撤回，分支指向变基开始前的提交。'
            : `中止后可以重新发起${name}。`}
        </DialogNote>
      ),
      acknowledge: `我了解已解决的冲突会丢失，并确认中止${name}`,
      okText: `中止${name}`,
      busyText: '正在中止…',
      onOk: () => run('abort'),
    });

  return (
    <div className="conflict-bar" role="region" aria-label={`${name}进行中`}>
      <div className="conflict-bar__main">
        <span className="conflict-bar__icon" aria-hidden="true">
          <DialogIcon name={operation.kind === 'rebase' ? 'branch' : 'merge'} />
        </span>
        <div className="conflict-bar__text">
          <strong>
            {operationTitle(operation)}
            {progress && <span className="conflict-bar__step">第 {progress} 个提交</span>}
          </strong>
          {operation.subject && (
            <span className="conflict-bar__subject" title={operation.commit}>
              {operation.subject}
            </span>
          )}
          <span className="conflict-bar__sides">
            <i data-side="current">当前：{sides.current}</i>
            <i data-side="incoming">传入：{sides.incoming}</i>
          </span>
          <span className={conflicts ? 'conflict-bar__state is-open' : 'conflict-bar__state'}>
            {conflicts
              ? `${conflicts} 个文件仍有冲突，全部标记为已解决后才能继续。`
              : `冲突已全部解决，可以继续${name}。`}
          </span>
        </div>
      </div>
      <div className="conflict-bar__actions">
        <Tooltip title={conflicts ? '仍有未解决的冲突' : null}>
          <Button
            type="primary"
            size="small"
            loading={running === 'continue'}
            disabled={busy || conflicts > 0}
            onClick={() => void run('continue')}
          >
            继续{name}
          </Button>
        </Tooltip>
        {operation.kind === 'rebase' && (
          <Button size="small" loading={running === 'skip'} disabled={busy} onClick={skip}>
            跳过此提交
          </Button>
        )}
        <Button size="small" danger loading={running === 'abort'} disabled={busy} onClick={abort}>
          中止{name}
        </Button>
      </div>
    </div>
  );
}
