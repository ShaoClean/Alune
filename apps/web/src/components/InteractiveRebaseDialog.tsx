import { useEffect, useRef, useState } from 'react';
import { AluneModal, Button, Input, useFeedbackMessage } from '@alune/ui';
import {
  previewRebasePlan,
  type RebaseAction,
  type RebasePlanEntry,
  type RebasePreview,
} from '@alune/shared';
import { gitApi } from '../api';
import '../rebase.css';

const actions: [RebaseAction, string][] = [
  ['pick', '保留'],
  ['reword', '改写信息'],
  ['squash', '合并到上一个'],
  ['fixup', '合并并丢弃信息'],
  ['drop', '删除提交'],
];

export function notifyRebaseChanged(repoId: string) {
  window.dispatchEvent(new CustomEvent('alune:rebase-changed', { detail: repoId }));
}

export function InteractiveRebaseDialog({
  repoId,
  base,
  onClose,
}: {
  repoId: string;
  base: string;
  onClose: () => void;
}) {
  const feedback = useFeedbackMessage();
  const [preview, setPreview] = useState<RebasePreview | null>(null);
  const [entries, setEntries] = useState<RebasePlanEntry[]>([]);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const dragHash = useRef<string | null>(null);

  const load = async () => {
    const current = ++revision.current;
    setChecking(true);
    setError('');
    setConfirming(false);
    setPreview(null);
    setAcknowledged(false);
    try {
      const value = await gitApi.previewRebase(repoId, base);
      if (current !== revision.current) return;
      setPreview(value);
      setEntries(value.commits.map((commit) => ({ hash: commit.hash, action: 'pick' })));
    } catch (error: any) {
      if (current === revision.current) setError(error.message);
    } finally {
      if (current === revision.current) setChecking(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [repoId, base]);

  let result: ReturnType<typeof previewRebasePlan> = [];
  let validation = '';
  if (preview) {
    try {
      result = previewRebasePlan(preview.commits, entries);
    } catch (error: any) {
      validation = error.message;
    }
  }
  const published = preview?.commits.filter((commit) => commit.published).length ?? 0;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    setEntries((current) => {
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const changeAction = (index: number, action: RebaseAction) => {
    if (!preview) return;
    let message = entries[index].message;
    const original = preview.commits.find((commit) => commit.hash === entries[index].hash)!;
    if (action === 'reword') message = original.message.trimEnd();
    if (action === 'squash') {
      let previous = '';
      try {
        const prefix = entries.slice(0, index);
        previous =
          previewRebasePlan(
            preview.commits.filter((commit) => prefix.some((entry) => entry.hash === commit.hash)),
            prefix,
          ).at(-1)?.message ?? '';
      } catch {
        /* The validation message explains an invalid predecessor. */
      }
      message = [previous.trimEnd(), original.message.trimEnd()].filter(Boolean).join('\n\n');
    }
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, action, message } : entry)),
    );
  };
  const execute = async () => {
    if (!preview || validation || pending.current || (published && !acknowledged)) return;
    pending.current = true;
    const current = revision.current;
    setBusy(true);
    setError('');
    try {
      const value = await gitApi.startRebase(repoId, {
        base: preview.base,
        token: preview.token,
        entries,
        acknowledgePublished: acknowledged,
      });
      if (current !== revision.current) return;
      if (value.state.active) {
        feedback.warning('变基已暂停，请在冲突面板中继续处理。');
        onClose();
      } else if (value.error) setError(value.error);
      else {
        feedback.success('交互式变基已完成');
        onClose();
      }
    } catch (error: any) {
      if (current === revision.current)
        setError(`${error.message} 请核对仓库状态；需要时重新读取计划。`);
    } finally {
      pending.current = false;
      if (current === revision.current) setBusy(false);
      notifyRebaseChanged(repoId);
    }
  };

  return (
    <AluneModal
      open
      size="xl"
      level={confirming ? 2 : 0}
      levelLabel={confirming ? '重写提交历史' : false}
      title={confirming ? '确认变基结果' : '交互式变基'}
      description={
        preview
          ? `${preview.branch} · 基准 ${preview.base.slice(0, 8)} 之后的 ${preview.commits.length} 个提交（从旧到新）`
          : '正在核验当前分支和工作区。'
      }
      onCancel={() => {
        if (!pending.current) onClose();
      }}
      onOk={() => (confirming ? void execute() : setConfirming(true))}
      okText={confirming ? '执行变基' : '预览结果'}
      confirmLoading={busy}
      busyText="正在变基…"
      okDisabled={
        checking || !preview || !!validation || (!!published && confirming && !acknowledged)
      }
      extra={
        confirming ? (
          <Button disabled={busy} onClick={() => setConfirming(false)}>
            返回编辑
          </Button>
        ) : error ? (
          <Button onClick={() => void load()} disabled={checking}>
            重新读取
          </Button>
        ) : null
      }
    >
      {checking && <p role="status">正在读取基准之后的提交…</p>}
      {error && (
        <p className="rebase-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          {published > 0 && (
            <div className="rebase-warning" role="note">
              {published} 个提交已出现在远程跟踪分支中。重写后推送可能需要强制推送，请与协作者协调。
              <span className="rebase-muted">
                判断基于本地远程引用；若远端有新变化，请先获取远程更新。
              </span>
              {confirming && (
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />{' '}
                  我了解重写已推送历史的影响
                </label>
              )}
            </div>
          )}
          {confirming ? (
            <div>
              <p>
                {result.length
                  ? `变基后将得到 ${result.length} 个提交，顺序如下。`
                  : '将删除基准之后的全部提交，当前分支回到基准提交。'}
              </p>
              <ol className="rebase-plan rebase-preview">
                {result.map((commit) => (
                  <li key={commit.hashes[0]}>
                    <pre>{commit.message}</pre>
                    <span className="rebase-muted">
                      来源：{commit.hashes.map((hash) => hash.slice(0, 8)).join(' + ')}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="rebase-muted">
                预览展示提交顺序和信息。执行时仍可能发生内容冲突，可解决后继续或中止以恢复原状态。
              </p>
              <p className="rebase-muted">重写的提交会生成新的哈希，本次变基不会自动签名。</p>
            </div>
          ) : (
            <>
              <p className="rebase-muted">
                拖动序号调整顺序，或聚焦条目后按 Alt + ↑ / ↓。合并操作作用于前一个未删除的提交。
              </p>
              <ol className="rebase-plan" aria-label="变基提交计划">
                {entries.map((entry, index) => {
                  const original = preview.commits.find((commit) => commit.hash === entry.hash)!;
                  return (
                    <li
                      key={entry.hash}
                      className={
                        entry.action === 'drop' ? 'rebase-entry is-dropped' : 'rebase-entry'
                      }
                      tabIndex={0}
                      aria-label={`第 ${index + 1} 个提交 ${original.message.split('\n')[0]}`}
                      onKeyDown={(event) => {
                        if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                          event.preventDefault();
                          event.stopPropagation();
                          move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                        }
                      }}
                      onDragOver={(event) => {
                        if (dragHash.current) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from = entries.findIndex((item) => item.hash === dragHash.current);
                        if (from >= 0) move(from, index);
                        dragHash.current = null;
                      }}
                    >
                      <div className="rebase-entry__row">
                        <button
                          type="button"
                          className="rebase-drag"
                          draggable
                          onDragStart={(event) => {
                            dragHash.current = entry.hash;
                            event.dataTransfer.setData('text/plain', entry.hash);
                          }}
                          onDragEnd={() => {
                            dragHash.current = null;
                          }}
                          aria-label={`拖动第 ${index + 1} 个提交`}
                        >
                          {index + 1}
                        </button>
                        <select
                          aria-label={`${original.message.split('\n')[0]} 的操作`}
                          value={entry.action}
                          onChange={(event) =>
                            changeAction(index, event.target.value as RebaseAction)
                          }
                        >
                          {actions.map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}（{value}）
                            </option>
                          ))}
                        </select>
                        <span className="rebase-entry__subject" title={original.message}>
                          {original.message.split('\n')[0]}
                          <small>
                            {entry.hash.slice(0, 8)} · {original.author}
                            {original.published ? ' · 已推送' : ''}
                          </small>
                        </span>
                        <Button
                          size="small"
                          disabled={index === 0}
                          aria-label={`上移 ${original.message.split('\n')[0]}`}
                          onClick={() => move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="small"
                          disabled={index === entries.length - 1}
                          aria-label={`下移 ${original.message.split('\n')[0]}`}
                          onClick={() => move(index, index + 1)}
                        >
                          ↓
                        </Button>
                      </div>
                      {(entry.action === 'reword' || entry.action === 'squash') && (
                        <label className="rebase-message">
                          {entry.action === 'squash' ? '合并后的完整提交信息' : '新的提交信息'}
                          <Input.TextArea
                            aria-label={`${entry.hash.slice(0, 8)} 提交信息`}
                            value={entry.message ?? ''}
                            autoSize={{ minRows: 2, maxRows: 8 }}
                            onChange={(event) =>
                              setEntries((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, message: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ol>
              {validation && (
                <p role="alert" className="rebase-error">
                  {validation}
                </p>
              )}
            </>
          )}
        </>
      )}
    </AluneModal>
  );
}
