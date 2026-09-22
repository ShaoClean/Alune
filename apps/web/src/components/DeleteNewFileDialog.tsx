import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin, App } from 'antd';
import type { NewFileDeletionPreview } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

interface Props {
  repoId: string;
  path: string;
  onClose: () => void;
  onFileChanged?: (path: string) => void;
}

const errorMessage = (error: any) =>
  error.response?.data?.message || error.message || '远端文件操作失败';

export function DeleteNewFileDialog({ repoId, path, onClose, onFileChanged }: Props) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<NewFileDeletionPreview | null>(null);
  const [checking, setChecking] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <Modal
      open
      title="删除整个新增文件？"
      onCancel={() => {
        if (!pending.current) onClose();
      }}
      closable={!deleting}
      keyboard={!deleting}
      maskClosable={!deleting}
      footer={[
        <Button key="cancel" disabled={deleting} onClick={onClose}>
          取消
        </Button>,
        error && (
          <Button key="retry" disabled={checking || deleting} onClick={() => void readPreview()}>
            重新读取并确认
          </Button>
        ),
        <Button
          key="delete"
          danger
          type="primary"
          loading={deleting}
          disabled={!preview || checking}
          onClick={() => void confirm()}
        >
          {deleting ? '正在删除…' : '删除文件'}
        </Button>,
      ]}
    >
      <p>目标路径：</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{path}</pre>
      {checking && (
        <p role="status">
          <Spin size="small" /> 正在核验远端文件和暂存内容…
        </p>
      )}
      {preview && (
        <>
          <p>
            {!preview.diskPresent
              ? '远端磁盘文件已不存在。本次将清理此路径残留的暂存新增内容。'
              : preview.staged
                ? '将删除远端磁盘文件，并移除此路径的全部暂存内容。'
                : '将从远端磁盘删除此新增文件。'}
          </p>
          {preview.staged && preview.hasUnstagedChanges && preview.diskPresent && (
            <p>此新文件同时存在已暂存和未暂存改动，删除范围包含两部分的全部内容。</p>
          )}
          <p>直接删除，不会进入回收站。此操作不可撤销。</p>
        </>
      )}
      {error && <Alert type="error" showIcon title="无法完成删除" description={error} />}
    </Modal>
  );
}
