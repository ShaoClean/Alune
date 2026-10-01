import { useFeedbackMessage } from './useFeedbackMessage';
import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import type { DiscardChangesPreview, DiscardChangesResult } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal, CheckCard, DialogHints, Kbd } from './AluneModal';
import { DialogIcon } from './DialogIcons';
import type { LedgerItem } from './DialogParts';
import {
  DialogCard,
  DialogEmpty,
  DialogLedger,
  DialogNote,
  DialogProgress,
  DialogStat,
  DialogStats,
  RepoRow,
} from './DialogParts';

interface Props {
  repoId: string;
  onClose: () => void;
}

export const discardResultMessage = (result: DiscardChangesResult) =>
  `已恢复 ${result.restored} 个文件，已删除 ${result.deleted} 个未跟踪文件` +
  (result.remaining ? `；${result.remaining} 个文件未完成` : '') +
  (result.unknown ? `；${result.unknown} 个文件的结果无法确认` : '');

export function DiscardChangesDialog({ repoId, onClose }: Props) {
  const message = useFeedbackMessage();
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState<DiscardChangesPreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [discarding, setDiscarding] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const revision = useRef(0);
  const count = preview ? preview.tracked + (includeUntracked ? preview.untracked : 0) : 0;

  const refresh = async () => {
    await useRepositoryStore.getState().fetchStatus(repoId, true);
    const entry = useRepositoryStore.getState().repositoryStatuses[repoId];
    if (entry?.phase === 'error') message.warning(`改动列表刷新失败：${entry.error}，请重试刷新。`);
  };

  const readPreview = async () => {
    const current = ++revision.current;
    setChecking(true);
    setPreview(null);
    setError(null);
    setIncludeUntracked(false);
    setAcknowledged(false);
    try {
      const value = await gitApi.previewDiscardChanges(repoId);
      if (revision.current === current) setPreview(value);
    } catch (error: any) {
      if (revision.current === current) setError(error.message || '无法核验放弃范围');
      await refresh();
    } finally {
      if (revision.current === current) setChecking(false);
    }
  };

  useEffect(() => {
    void readPreview();
    return () => {
      revision.current++;
    };
  }, [repoId]);

  const confirm = async () => {
    if (pending.current || checking || !preview || !count || !acknowledged) return;
    pending.current = true;
    setDiscarding(true);
    const current = revision.current;
    let succeeded = false;
    try {
      const result = await gitApi.discardChanges(
        repoId,
        preview.token,
        includeUntracked ? 'all' : 'tracked',
      );
      succeeded = result.success;
      if (result.success) message.success(discardResultMessage(result));
      else if (revision.current === current) {
        setError(`${discardResultMessage(result)}。${result.error || '请重新读取状态后确认。'}`);
      }
    } catch (error: any) {
      if (revision.current === current) {
        const uncertain = !error.response || error.response.status >= 500;
        setError(
          `${error.message || '放弃操作未完成'}${uncertain ? ' 请核对刷新后的状态；连接中断时可能已有部分操作完成。' : ''}`,
        );
      }
    } finally {
      // A failed response can follow a partial write. Refresh both status and the
      // currently selected comparison even when its porcelain status is unchanged.
      if (revision.current === current) setPreview(null);
      await refresh();
      if (revision.current === current) {
        setDiscarding(false);
        if (succeeded) setOpen(false);
      }
      pending.current = false;
    }
  };

  const close = () => {
    if (!pending.current) setOpen(false);
  };
  const ready = Boolean(preview && preview.tracked + preview.untracked > 0);
  const skipped = preview?.skipped?.length ?? 0;
  const discarded: LedgerItem[] = preview
    ? [
        { icon: 'file', text: `${preview.tracked} 个已跟踪文件的未暂存改动` },
        ...(includeUntracked
          ? [{ icon: 'file-plus' as const, text: `${preview.untracked} 个未跟踪文件，直接删除` }]
          : []),
      ]
    : [];
  const kept: LedgerItem[] = preview
    ? [
        { icon: 'check', text: '全部已暂存内容，含已暂存的新文件' },
        ...(!includeUntracked && preview.untracked
          ? [{ icon: 'file-plus' as const, text: `${preview.untracked} 个未跟踪文件` }]
          : []),
        { icon: 'eye-off', text: '忽略文件' },
        ...(skipped ? [{ icon: 'tree' as const, text: `跳过 ${skipped} 个目录或子模块` }] : []),
      ]
    : [];

  return (
    <AluneModal
      open={open}
      afterClose={onClose}
      level={2}
      glyph="undo"
      eyebrow={{ label: '工作区', detail: preview?.repositoryName }}
      title="放弃所有更改？"
      description="作用于整个当前仓库 / worktree，不受文件列表筛选影响。其他仓库和 worktree 不受影响。"
      onCancel={close}
      onOk={() => void confirm()}
      confirmLoading={discarding}
      busyText="正在放弃…"
      okDisabled={checking || !count || !acknowledged}
      okText={
        !preview
          ? '确认放弃'
          : includeUntracked
            ? `放弃全部并删除（${count}）`
            : `仅放弃已跟踪更改（${count}）`
      }
      hints={
        <DialogHints tone="warn">
          <span>
            <DialogIcon name="warning" />
            默认聚焦「取消」
          </span>
          <i />
          <span>
            <Kbd>↵</Kbd> 已停用
          </span>
        </DialogHints>
      }
      extra={
        error ? (
          <Button disabled={checking || discarding} onClick={() => void readPreview()}>
            重新读取并确认
          </Button>
        ) : null
      }
    >
      {checking && <DialogProgress label="正在核验整个仓库的改动…" />}
      {preview && (
        <DialogCard>
          <RepoRow name={preview.repositoryName || '当前仓库'} path={preview.repositoryPath} />
          {ready ? (
            <div className="dlg-card-divide">
              <DialogStats>
                <DialogStat tone="danger" value={preview.tracked} label="已跟踪 · 恢复" />
                {preview.untracked > 0 ? (
                  <DialogStat
                    tone="danger"
                    off={!includeUntracked}
                    value={preview.untracked}
                    label={includeUntracked ? '未跟踪 · 删除' : '未跟踪 · 保留'}
                  />
                ) : null}
              </DialogStats>
            </div>
          ) : (
            <div className="dlg-card-divide">
              <DialogEmpty>当前没有可放弃的未暂存更改。</DialogEmpty>
            </div>
          )}
        </DialogCard>
      )}
      {preview && ready ? (
        <>
          <DialogLedger change={discarded} keep={kept} />
          {skipped ? (
            <DialogNote quiet icon="tree" title={`跳过 ${skipped} 个目录或子模块`}>
              <ul className="dlg-note-sub">
                {preview.skipped!.map((item) => (
                  <li key={item.path}>
                    <code>{item.path}</code>：{item.reason}
                  </li>
                ))}
              </ul>
            </DialogNote>
          ) : null}
          {preview.untracked > 0 && (
            <CheckCard
              tone="danger"
              checked={includeUntracked}
              disabled={discarding}
              onChange={(checked) => {
                setIncludeUntracked(checked);
                setAcknowledged(false);
              }}
              title={`同时删除 ${preview.untracked} 个未跟踪文件`}
              description={
                includeUntracked
                  ? '直接删除，不会进入回收站，Git 无法恢复这些文件。'
                  : '未勾选时保留未跟踪文件及忽略文件。'
              }
            />
          )}
          <CheckCard
            tone="danger"
            checked={acknowledged}
            disabled={discarding}
            onChange={setAcknowledged}
            title={`我了解本次影响 ${count} 个文件，且不可撤销`}
          />
        </>
      ) : null}
      {error && (
        <DialogNote tone="danger" role="alert" title="未全部完成">
          {error}
        </DialogNote>
      )}
    </AluneModal>
  );
}
