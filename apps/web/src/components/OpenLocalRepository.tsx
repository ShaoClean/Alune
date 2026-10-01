import { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import { useNavigate } from 'react-router-dom';
import { repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal, DialogHints, Kbd } from './AluneModal';
import { DialogIcon } from './DialogIcons';
import {
  DialogCard,
  DialogNote,
  DialogProgress,
  DialogStat,
  DialogStats,
  RepoRow,
} from './DialogParts';

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
  const checking = busy && !inspection;
  const changes = inspection?.status.files.length ?? 0;
  return (
    <AluneModal
      open={open}
      size="md"
      glyph="folder-open"
      eyebrow={{ label: '仓库', detail: '本机' }}
      title="打开本地仓库"
      description="选择已有 Git 仓库，或粘贴本机的完整目录路径。Git 操作在运行 Alune 的电脑上执行。"
      okText="打开工作区"
      busyText="正在打开…"
      okDisabled={!inspection}
      hints={
        <DialogHints>
          <span>
            <Kbd>↵</Kbd> 检查 · 打开
          </span>
          <i />
          <span>
            <Kbd>Esc</Kbd> 取消
          </span>
        </DialogHints>
      }
      // ↵ opens the workspace once the inspection is ready; before that the path field inspects.
      onOk={() => confirm()}
      onCancel={onClose}
    >
      <div className="dlg-fld">
        <label className="dlg-fld-label" htmlFor="local-repo-path">
          仓库目录
        </label>
        <div className="dlg-inp-group">
          <Input
            id="local-repo-path"
            className="dlg-mono-input"
            prefix={<DialogIcon name="folder" />}
            suffix={
              window.aluneWorkspace?.chooseDirectory ? (
                <Button
                  size="small"
                  type="text"
                  className="dlg-inp-btn"
                  disabled={busy}
                  onClick={() => void choose()}
                >
                  浏览
                </Button>
              ) : undefined
            }
            data-autofocus
            autoComplete="off"
            spellCheck={false}
            value={path}
            disabled={busy}
            onChange={(event) => changePath(event.target.value)}
            onPressEnter={() => {
              if (!inspection && path.trim() && !busy) void inspect();
            }}
            placeholder="/Users/me/Projects/repository"
          />
          <Button
            className={checking ? 'is-busy' : undefined}
            aria-busy={checking || undefined}
            disabled={!path.trim() || (busy && !checking)}
            onClick={() => {
              if (!busy) void inspect();
            }}
          >
            {checking ? <span className="dlg-moonload" aria-hidden="true" /> : null}
            <span>{checking ? '检查中' : '检查仓库'}</span>
          </Button>
        </div>
        {!path && (
          <span className="dlg-fld-hint">
            也可以直接粘贴 Windows 路径，例如 <code>C:\Projects\repository</code>
          </span>
        )}
      </div>
      {checking && <DialogProgress label="正在读取仓库状态、分支与远程…" />}
      {inspection && (
        <DialogCard>
          <RepoRow name={inspection.name} path={inspection.path}>
            <span className="dlg-badge" data-tone="success" style={{ marginLeft: 'auto' }}>
              本机
            </span>
          </RepoRow>
          <div className="dlg-card-divide" />
          <DialogStats>
            <DialogStat value={inspection.status.branch || '游离 HEAD'} label="当前分支" />
            {inspection.unborn ? (
              <DialogStat value="—" label="等待首次提交" off />
            ) : (
              <DialogStat
                value={changes}
                label="项改动"
                tone={changes > 0 ? 'warning' : undefined}
                off={changes === 0}
              />
            )}
            {inspection.remotes.length ? (
              <DialogStat value={inspection.remotes.length} label="个远程" />
            ) : (
              <DialogStat value="—" label="未配置远程" off />
            )}
          </DialogStats>
        </DialogCard>
      )}
      {inspection && (!inspection.author.name || !inspection.author.email) && (
        <DialogNote tone="warning" icon="user">
          尚未配置提交作者，可以在工作区中补充。
        </DialogNote>
      )}
      {error && (
        <DialogNote tone="danger" icon="warning" title="无法打开仓库" role="alert">
          {error}
        </DialogNote>
      )}
    </AluneModal>
  );
}
