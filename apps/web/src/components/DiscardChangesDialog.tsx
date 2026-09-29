import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Checkbox, Modal, Spin } from 'antd';
import type { DiscardChangesPreview, DiscardChangesResult } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

interface Props {
  repoId: string;
  onClose: () => void;
}

export const discardResultMessage = (result: DiscardChangesResult) =>
  `已恢复 ${result.restored} 个文件，已删除 ${result.deleted} 个未跟踪文件` +
  (result.remaining ? `；${result.remaining} 个文件未完成` : '') +
  (result.unknown ? `；${result.unknown} 个文件的结果无法确认` : '');

export function DiscardChangesDialog({ repoId, onClose }: Props) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<DiscardChangesPreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [discarding, setDiscarding] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
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
    if (pending.current || checking || !preview || !count) return;
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
        if (succeeded) onClose();
      }
      pending.current = false;
    }
  };

  const close = () => {
    if (!pending.current) onClose();
  };
  return (
    <Modal
      open
      title="放弃所有更改？"
      onCancel={close}
      closable={!discarding}
      keyboard={!discarding}
      maskClosable={!discarding}
      footer={[
        <Button key="cancel" disabled={discarding} onClick={close}>
          取消
        </Button>,
        error && (
          <Button key="retry" disabled={checking || discarding} onClick={() => void readPreview()}>
            重新读取并确认
          </Button>
        ),
        <Button
          key="discard"
          danger
          type="primary"
          loading={discarding}
          disabled={checking || !count}
          onClick={() => void confirm()}
        >
          {discarding
            ? '正在放弃…'
            : !preview
              ? '确认放弃'
              : includeUntracked
                ? `放弃全部并删除（${count}）`
                : `仅放弃已跟踪更改（${count}）`}
        </Button>,
      ]}
    >
      {checking && (
        <p role="status">
          <Spin size="small" /> 正在核验整个仓库的改动…
        </p>
      )}
      {preview && (
        <>
          <p>
            <strong>{preview.repositoryName || '当前仓库'}</strong>
          </p>
          <p className="git-path-detail">{preview.repositoryPath}</p>
          <p>作用于整个当前仓库 / worktree，不受文件列表筛选影响。其他仓库和 worktree 不受影响。</p>
          {!!preview.skipped?.length && (
            <details className="change-skipped" open>
              <summary>跳过 {preview.skipped.length} 个目录或子模块</summary>
              <ul>
                {preview.skipped.map((item) => (
                  <li key={item.path}>
                    <span className="git-path-detail">{item.path}</span>：{item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.tracked + preview.untracked === 0 ? (
            <Alert type="info" showIcon title="当前没有可放弃的未暂存更改。" />
          ) : (
            <>
              <p>
                将恢复 {preview.tracked}{' '}
                个已跟踪文件的未暂存改动。保留全部已暂存内容，包括已暂存的新文件。
              </p>
              {preview.untracked > 0 && (
                <Checkbox
                  checked={includeUntracked}
                  disabled={discarding}
                  onChange={(event) => setIncludeUntracked(event.target.checked)}
                >
                  同时删除 {preview.untracked} 个未跟踪文件
                </Checkbox>
              )}
              <p>
                {includeUntracked
                  ? `将直接删除 ${preview.untracked} 个未跟踪文件，不会进入回收站，Git 无法恢复这些文件。忽略文件不受影响。`
                  : `保留 ${preview.untracked} 个未跟踪文件及忽略文件。`}
              </p>
              <Alert
                type="warning"
                showIcon
                title={`本次影响 ${count} 个文件，放弃的未暂存内容不可撤销。`}
              />
            </>
          )}
        </>
      )}
      {error && <Alert type="error" showIcon title="未全部完成" description={error} />}
    </Modal>
  );
}
