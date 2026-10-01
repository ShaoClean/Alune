import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@alune/ui';
import type { NewFileDeletionPreview } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogNote, DialogPath, DialogProgress } from '@alune/ui';

interface Props {
  repoId: string;
  path: string;
  onClose: () => void;
  onFileChanged?: (path: string) => void;
}

const errorMessage = (error: any) =>
  error.response?.data?.message || error.message || '远端文件操作失败';

export function DeleteNewFileDialog({ repoId, path, onClose, onFileChanged }: Props) {
  const message = useFeedbackMessage();
  const [preview, setPreview] = useState<NewFileDeletionPreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repository = useRepositoryStore((state) =>
    state.repositories.find((repo) => repo.id === repoId),
  );
  const pending = useRef(false);
  const mounted = useRef(false);

  const refresh = async () => {
    await useRepositoryStore.getState().fetchStatus(repoId, true);
    const entry = useRepositoryStore.getState().repositoryStatuses[repoId];
    if (entry?.phase === 'error') message.warning(`文件列表更新失败：${entry.error}，请重试刷新。`);
  };

  const readPreview = async () => {
    setChecking(true);
    setPreview(null);
    setError(null);
    try {
      const value = await gitApi.previewNewFileDeletion(repoId, path);
      if (mounted.current) setPreview(value);
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
      await refresh();
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void readPreview();
    return () => {
      mounted.current = false;
    };
  }, [repoId, path]);

  const confirm = async () => {
    if (!preview || pending.current || checking) return;
    pending.current = true;
    setDeleting(true);
    let succeeded = false;
    try {
      await gitApi.deleteNewFile(repoId, path, preview.token);
      succeeded = true;
      message.success(`已删除 ${path}`);
    } catch (error) {
      if (mounted.current) {
        setError(errorMessage(error));
        setPreview(null);
      }
    } finally {
      // Also invalidate on failure: SSH may have disconnected after a partial write.
      if (mounted.current) onFileChanged?.(path);
      await refresh();
      pending.current = false;
      if (mounted.current) {
        setDeleting(false);
        if (succeeded) onClose();
      }
    }
  };

  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
  const badge = checking
    ? { text: '…' }
    : !preview
      ? null
      : !preview.diskPresent
        ? { text: preview.staged ? 'AD' : 'D', tone: 'danger', title: '磁盘已删除' }
        : preview.staged && preview.hasUnstagedChanges
          ? { text: 'AM', tone: 'warning', title: '已暂存 + 未暂存' }
          : preview.staged
            ? { text: 'A', tone: 'success', title: '已暂存的新文件' }
            : { text: 'U', tone: 'success', title: '未跟踪' };

  return (
    <AluneModal
      open
      level={2}
      glyph="trash"
      eyebrow={{ label: repository?.source === 'ssh' ? 'SSH' : '本地', detail: repository?.name }}
      title="删除整个新增文件？"
      onCancel={() => {
        if (!pending.current) onClose();
      }}
      onOk={() => void confirm()}
      confirmLoading={deleting}
      busyText="正在删除…"
      okText="删除文件"
      okIcon="trash"
      okDisabled={!preview || checking}
      acknowledge={preview ? `我确认永久删除 ${name}` : undefined}
      extra={
        error ? (
          <Button disabled={checking || deleting} onClick={() => void readPreview()}>
            重新读取并确认
          </Button>
        ) : null
      }
    >
      <DialogCard>
        <div className="dlg-list">
          <div className="dlg-list-item">
            <DialogIcon name="file-plus" />
            <div className="dlg-list-main">
              <strong>{name}</strong>
              <DialogPath path={path} />
            </div>
            {badge ? (
              <span className="dlg-badge is-mono" data-tone={badge.tone} title={badge.title}>
                {badge.text}
              </span>
            ) : null}
          </div>
        </div>
      </DialogCard>
      {checking && <DialogProgress label="正在核验远端文件和暂存内容…" />}
      {preview && (
        <>
          <p className="dlg-text">
            {!preview.diskPresent
              ? '远端磁盘文件已不存在。本次将清理此路径残留的暂存新增内容。'
              : preview.staged && preview.hasUnstagedChanges
                ? '此新文件同时存在已暂存和未暂存改动，删除范围包含两部分的全部内容。'
                : preview.staged
                  ? '将删除远端磁盘文件，并移除此路径的全部暂存内容。'
                  : '将从远端磁盘删除此新增文件。'}
          </p>
          <DialogNote tone="danger">直接删除，不会进入回收站。此操作不可撤销。</DialogNote>
        </>
      )}
      {error && (
        <DialogNote tone="danger" role="alert" title="无法完成删除">
          {error}
        </DialogNote>
      )}
    </AluneModal>
  );
}
