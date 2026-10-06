import { useEffect, useRef, useState } from 'react';
import { AluneModal, Button, Input, useFeedbackMessage } from '@alune/ui';
import type { RebaseConflict, RebaseState, RebaseResolution } from '@alune/shared';
import { gitApi } from '../api';
import { notifyRebaseChanged } from './InteractiveRebaseDialog';

function ConflictDialog({
  repoId,
  state,
  onChange,
  onClose,
}: {
  repoId: string;
  state: RebaseState;
  onChange: (state: RebaseState) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(state.conflicts[0] ?? '');
  const [conflict, setConflict] = useState<RebaseConflict | null>(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    if (!state.conflicts.includes(path)) setPath(state.conflicts[0] ?? '');
  }, [state.conflicts, path]);
  useEffect(() => {
    let stopped = false;
    setConflict(null);
    setError('');
    setLoading(false);
    if (!path) return;
    setLoading(true);
    gitApi
      .rebaseConflict(repoId, path)
      .then(
        (value) => {
          if (!stopped) {
            setConflict(value);
            setContent(value.content ?? '');
          }
        },
        (error) => {
          if (!stopped) setError(error.message);
        },
      )
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [repoId, path, revision]);
  const resolve = async (choice: RebaseResolution['choice']) => {
    if (!conflict || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await gitApi.resolveRebaseConflict(repoId, {
        path: conflict.path,
        token: conflict.token,
        choice,
        ...(choice === 'content' ? { content } : {}),
      });
      setConflict(null);
      onChange(next);
      setPath(next.conflicts[0] ?? '');
    } catch (error: any) {
      setError(error.message);
      setConflict(null);
    } finally {
      pending.current = false;
      setBusy(false);
      notifyRebaseChanged(repoId);
    }
  };
  return (
    <AluneModal
      open
      size="xl"
      hints={false}
      title="解决变基冲突"
      onCancel={() => {
        if (!pending.current) onClose();
      }}
      description="当前版本是已重放的提交；传入版本是正在应用的原提交。选择版本或编辑结果后，会将文件标记为已解决并暂存。"
      footer={
        <Button disabled={busy} onClick={onClose}>
          返回变基流程
        </Button>
      }
    >
      <div className="rebase-conflict">
        <div className="rebase-conflict-files" aria-label="冲突文件">
          {state.conflicts.map((file) => (
            <Button
              key={file}
              type={file === path ? 'primary' : 'default'}
              disabled={busy}
              onClick={() => setPath(file)}
            >
              {file}
            </Button>
          ))}
        </div>
        {!state.conflicts.length && <p role="status">全部冲突已解决。返回后点击「继续变基」。</p>}
        {loading && <p role="status">正在读取冲突版本…</p>}
        {error && (
          <>
            <p className="rebase-error" role="alert">
              {error}
            </p>
            <Button onClick={() => setRevision((value) => value + 1)} disabled={busy}>
              重新读取冲突
            </Button>
          </>
        )}
        {conflict && (
          <>
            <h3>{conflict.path}</h3>
            <div className="rebase-conflict-versions">
              <section>
                <h4>当前版本（已重放）</h4>
                <pre>
                  {conflict.hasOurs
                    ? (conflict.ours ?? '二进制、特殊文件或文本超出 64 KiB，无法预览。')
                    : '此版本中没有文件。'}
                </pre>
                <Button disabled={busy || !conflict.hasOurs} onClick={() => void resolve('ours')}>
                  采用当前版本并暂存
                </Button>
              </section>
              <section>
                <h4>传入版本（正在应用）</h4>
                <pre>
                  {conflict.hasTheirs
                    ? (conflict.theirs ?? '二进制、特殊文件或文本超出 64 KiB，无法预览。')
                    : '此版本中没有文件。'}
                </pre>
                <Button
                  disabled={busy || !conflict.hasTheirs}
                  onClick={() => void resolve('theirs')}
                >
                  采用传入版本并暂存
                </Button>
              </section>
            </div>
            {conflict.editable && (
              <label className="rebase-message">
                编辑最终内容（请移除冲突标记）
                <Input.TextArea
                  aria-label="冲突解决结果"
                  value={content}
                  disabled={busy}
                  autoSize={{ minRows: 8, maxRows: 18 }}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
            )}
            <div className="rebase-controls" style={{ marginTop: 12 }}>
              {conflict.editable && (
                <Button type="primary" loading={busy} onClick={() => void resolve('content')}>
                  保存结果并暂存
                </Button>
              )}
              <Button danger disabled={busy} onClick={() => void resolve('delete')}>
                删除文件并暂存
              </Button>
            </div>
          </>
        )}
      </div>
    </AluneModal>
  );
}

export function RebaseOperationNotice({
  repoId,
  onFinished,
  onManagedChange,
}: {
  repoId: string;
  onFinished: () => void;
  onManagedChange?: (managed: boolean) => void;
}) {
  const feedback = useFeedbackMessage();
  const [state, setState] = useState<RebaseState | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showConflicts, setShowConflicts] = useState(false);
  const [confirmation, setConfirmation] = useState<'skip' | 'abort' | null>(null);
  const callback = useRef(onFinished);
  callback.current = onFinished;
  const managedCallback = useRef(onManagedChange);
  managedCallback.current = onManagedChange;
  useEffect(() => {
    managedCallback.current?.(!!state?.managed);
  }, [state?.managed]);
  const pending = useRef(false);
  const pollingRevision = useRef(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = false;
    const read = async () => {
      clearTimeout(timer);
      const revision = ++pollingRevision.current;
      try {
        const [value, operation] = await Promise.all([
          gitApi.rebaseState(repoId),
          gitApi.operation(repoId),
        ]);
        if (stopped || revision !== pollingRevision.current) return;
        setState(value);
        setRunning(!!operation);
        setError((current) => (current.startsWith('读取变基状态失败：') ? '' : current));
        if (previous && !value.active) callback.current();
        previous = value.active;
      } catch (error: any) {
        if (!stopped && previous) {
          setError(`读取变基状态失败：${error.message}`);
          setRunning(true);
        }
      }
      if (!stopped && revision === pollingRevision.current)
        timer = setTimeout(() => void read(), previous ? 2000 : 5000);
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== repoId) return;
      callback.current();
      void read();
    };
    window.addEventListener('alune:rebase-changed', changed);
    void read();
    return () => {
      stopped = true;
      pollingRevision.current++;
      clearTimeout(timer);
      window.removeEventListener('alune:rebase-changed', changed);
    };
  }, [repoId]);

  const control = async (action: 'continue' | 'skip' | 'abort') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await gitApi.controlRebase(repoId, action);
      pollingRevision.current++;
      setState(result.state);
      if (result.error && !result.state.conflicts.length) setError(result.error);
      else if (!result.state.active)
        feedback.success(
          action === 'abort' ? '变基会话已结束，请核对仓库状态' : '交互式变基已完成',
        );
      setConfirmation(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
      notifyRebaseChanged(repoId);
    }
  };
  if (!state?.managed)
    return error ? (
      <div className="rebase-operation">
        <p className="rebase-error" role="alert">
          {error}
        </p>
        <Button onClick={() => setError('')}>关闭提示</Button>
      </div>
    ) : null;
  const disabled = busy || running;
  return (
    <>
      <div className="rebase-operation" role="region" aria-label="交互式变基状态">
        <div>
          <strong>
            {running ? '变基正在执行' : state.inProgress ? '变基已暂停' : '变基会话需要清理'}
          </strong>
          <span className="rebase-muted">
            {`${state.branch ?? '当前分支'} · ${state.conflicts.length} 个冲突文件`}
          </span>
        </div>
        {state.managed && (
          <div className="rebase-controls">
            {!!state.conflicts.length && (
              <Button disabled={disabled} onClick={() => setShowConflicts(true)}>
                解决冲突
              </Button>
            )}
            {state.inProgress && (
              <>
                <Button
                  type="primary"
                  disabled={disabled || !!state.conflicts.length}
                  onClick={() => void control('continue')}
                >
                  继续变基
                </Button>
                <Button disabled={disabled} onClick={() => setConfirmation('skip')}>
                  跳过当前提交
                </Button>
              </>
            )}
            <Button danger disabled={disabled} onClick={() => setConfirmation('abort')}>
              {state.inProgress ? '中止变基' : '清理会话'}
            </Button>
          </div>
        )}
        {error && (
          <p className="rebase-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {showConflicts && state.managed && (
        <ConflictDialog
          repoId={repoId}
          state={state}
          onChange={setState}
          onClose={() => setShowConflicts(false)}
        />
      )}
      {confirmation && (
        <AluneModal
          open
          level={2}
          levelLabel="丢弃变基中的更改"
          title={
            confirmation === 'skip'
              ? '跳过当前提交？'
              : state.inProgress
                ? '中止变基？'
                : '清理变基会话？'
          }
          description={
            confirmation === 'skip'
              ? '当前正在应用的提交及其冲突处理结果将被丢弃，然后继续剩余计划。'
              : state.inProgress
                ? '将丢弃变基期间的冲突处理结果，恢复变基开始前的分支和提交。'
                : 'Git 已无进行中的变基。清理临时会话后，请核对当前提交历史。'
          }
          onCancel={() => {
            if (!pending.current) setConfirmation(null);
          }}
          onOk={() => void control(confirmation)}
          confirmLoading={busy}
          okText={confirmation === 'skip' ? '确认跳过' : state.inProgress ? '确认中止' : '清理会话'}
        />
      )}
    </>
  );
}
