import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import { FolderOpenOutlined, LaptopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

type Inspection = Awaited<ReturnType<typeof repositoryApi.inspectLocal>>;

export function OpenLocalRepository({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [path, setPath] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    if (!open) {
      setBusy(false);
      setError('');
    }
  }, [open]);
  const changePath = (value: string) => {
    generation.current++;
    setPath(value);
    setInspection(null);
    setError('');
  };
  const inspect = async () => {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setInspection(null);
    try {
      const result = await repositoryApi.inspectLocal(path);
      if (current === generation.current) setInspection(result);
    } catch (failure: any) {
      if (current === generation.current) setError(failure.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const choose = async () => {
    try {
      const chosen = await window.aluneWorkspace?.chooseDirectory?.();
      if (chosen) changePath(chosen);
    } catch (failure: any) {
      setError(failure.message || '无法打开系统目录选择器，请输入路径。');
    }
  };
  const confirm = async () => {
    if (!inspection || busy) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const store = useRepositoryStore.getState();
      const repo = await store.addLocalRepository(inspection.path);
      if (current !== generation.current) return;
      store.openRepository(repo);
      onClose();
      navigate(`/repositories/${repo.id}`);
    } catch (failure: any) {
      if (current === generation.current) setError(failure.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return (
    <Modal
      title={
        <Space>
          <LaptopOutlined />
          打开本地仓库
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={!inspection}
            loading={busy}
            onClick={() => void confirm()}
          >
            打开工作区
          </Button>
        </>
      }
    >
      <p className="modal-description">
        选择已有 Git 仓库，或粘贴本机的完整目录路径。Git 操作在运行 Alune 的电脑上执行。
      </p>
      <label className="git-form-label" htmlFor="local-repo-path">
        仓库目录
      </label>
      <Space.Compact block>
        <Input
          id="local-repo-path"
          autoFocus
          value={path}
          disabled={busy}
          onChange={(event) => changePath(event.target.value)}
          onPressEnter={() => void inspect()}
          placeholder="/Users/me/Projects/repository 或 C:\\Projects\\repository"
        />
        {window.aluneWorkspace?.chooseDirectory && (
          <Button icon={<FolderOpenOutlined />} disabled={busy} onClick={() => void choose()}>
            浏览
          </Button>
        )}
      </Space.Compact>
      <Button
        className="local-inspect-button"
        disabled={!path || busy}
        loading={busy && !inspection}
        onClick={() => void inspect()}
      >
        检查仓库
      </Button>
      {error && <Alert type="error" showIcon title="无法打开仓库" description={error} />}
      {inspection && (
        <div className="local-repository-preview" role="status">
          <strong>
            <FolderOpenOutlined /> {inspection.name}
          </strong>
          <Typography.Paragraph className="local-repository-preview__path">
            {inspection.path}
          </Typography.Paragraph>
          <Space wrap>
            <span className="source-badge">本机</span>
            <span>{inspection.status.branch || '游离 HEAD'}</span>
            <span>
              {inspection.unborn ? '等待首次提交' : `${inspection.status.files.length} 项改动`}
            </span>
            <span>
              {inspection.remotes.length ? `${inspection.remotes.length} 个远程` : '未配置远程'}
            </span>
          </Space>
          {(!inspection.author.name || !inspection.author.email) && (
            <p>尚未配置提交作者，可在工作区中补充。</p>
          )}
        </div>
      )}
    </Modal>
  );
}
