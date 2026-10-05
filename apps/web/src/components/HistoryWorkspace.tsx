import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CommitFile, GraphCommit } from '@alune/shared';
import { Button } from '@alune/ui';
import { ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons';
import { HistoryReference, HistoryView } from './HistoryView';
import { repositoryApi } from '../api';
import { DiffViewer } from './DiffViewer';
import { FileIcon, ErrorState } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';

const statuses = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C' };

export function HistoryWorkspace({ repoId, targetHash }: { repoId: string; targetHash?: string }) {
  const { compact, updateLayout } = useWorkspaceLayout();
  const {
    log,
    logGeneration,
    logBranch,
    fetchLog,
    commitFiles,
    commitFilesLoading,
    commitFilesError,
    diff,
    diffLoading,
    diffError,
    fetchCommitFiles,
    fetchDiff,
    clearDiff,
  } = useRepositoryStore();
  const [jumpError, setJumpError] = useState<string>();
  const [jumpAttempt, setJumpAttempt] = useState(0);
  const [selected, setSelected] = useState<GraphCommit | null>(null);
  const [file, setFile] = useState<CommitFile | null>(null);
  const [ratio, setRatio] = useState(60);
  const [focusDiff, setFocusDiff] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; ratio: number; height: number } | null>(null);
  const close = () => {
    setSelected(null);
    setFile(null);
    setFocusDiff(false);
    requestAnimationFrame(() =>
      container.current
        ?.querySelector<HTMLElement>('[role="grid"]')
        ?.focus({ preventScroll: true }),
    );
  };
  useLayoutEffect(() => {
    if (!targetHash) return;
    const controller = new AbortController();
    setJumpError(undefined);
    const detail = repositoryApi.blameCommit(repoId, targetHash, controller.signal);
    const history = fetchLog(repoId, 'refresh', targetHash);
    Promise.all([detail, history]).then(
      ([commit]) => {
        if (!controller.signal.aborted) {
          setSelected(
            useRepositoryStore.getState().log.find((item) => item.hash === commit.hash) ?? commit,
          );
          setFile(null);
        }
      },
      (error) => {
        if (!controller.signal.aborted) setJumpError(error.message || '无法定位提交');
      },
    );
    return () => controller.abort();
  }, [repoId, targetHash, jumpAttempt]);
  useEffect(() => {
    if (!selected) return;
    const next = log.find((commit) => commit.hash === selected.hash);
    if (next) setSelected(next);
    else if (selected.hash !== targetHash) close();
  }, [logGeneration]);
  useEffect(() => {
    if (compact && selected) back.current?.focus();
  }, [compact, selected?.hash]);
  useLayoutEffect(() => {
    if (selected) void fetchCommitFiles(repoId, selected.hash);
  }, [repoId, selected?.hash, fetchCommitFiles]);
  useLayoutEffect(() => {
    if (selected) void fetchDiff(repoId, { commit: selected.hash, file: file?.path });
    else clearDiff();
    return clearDiff;
  }, [repoId, selected?.hash, file?.path, fetchDiff, clearDiff]);
  const clampRatio = (value: number) => {
    const height = container.current?.clientHeight || 600;
    const min = Math.min(45, (180 / height) * 100);
    return Math.max(min, Math.min(100 - min, value));
  };

  return (
    <div
      ref={container}
      className={
        'history-workspace' +
        (selected ? ' history-workspace--selected' : '') +
        (compact ? ' history-workspace--compact' : '') +
        (focusDiff ? ' history-workspace--focus' : '')
      }
      style={{ '--history-ratio': ratio + '%' } as CSSProperties}
    >
      <FeedbackNotice
        source="history-jump"
        title={jumpError}
        actionLabel="重试"
        onAction={() => setJumpAttempt((value) => value + 1)}
      />
      {logBranch && (
        <div className="blame-history-scope">
          正在显示从 {logBranch.slice(0, 8)} 开始的历史
          <Button size="small" onClick={() => void fetchLog(repoId)}>
            查看全部历史
          </Button>
        </div>
      )}
      <div className="history-workspace__graph" inert={!!selected && (compact || focusDiff)}>
        <HistoryView
          repoId={repoId}
          selectedHash={selected?.hash}
          visible={!selected || (!compact && !focusDiff)}
          onSelectCommit={(commit) => {
            setSelected(commit);
            setFile(null);
          }}
        />
      </div>
      {selected && (
        <>
          {!compact && !focusDiff && (
            <div
              className="history-resize"
              role="separator"
              tabIndex={0}
              aria-label="调整提交图与详情高度"
              aria-orientation="horizontal"
              aria-valuemin={Math.round(clampRatio(0))}
              aria-valuemax={Math.round(clampRatio(100))}
              aria-valuenow={Math.round(ratio)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { y: event.clientY, ratio, height: container.current!.clientHeight };
              }}
              onPointerMove={(event) => {
                if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId))
                  setRatio(
                    clampRatio(
                      drag.current.ratio +
                        ((event.clientY - drag.current.y) / drag.current.height) * 100,
                    ),
                  );
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 2;
                const next =
                  event.key === 'ArrowUp'
                    ? ratio - step
                    : event.key === 'ArrowDown'
                      ? ratio + step
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 100
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  setRatio(clampRatio(next));
                }
              }}
            />
          )}
          <section className="history-detail" aria-label="提交详情">
            <header className="history-detail__header">
              {(compact || focusDiff) && (
                <Button
                  ref={back}
                  aria-label={focusDiff && !compact ? '返回提交图' : '返回列表'}
                  type="text"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  onClick={focusDiff && !compact ? () => setFocusDiff(false) : close}
                >
                  返回{focusDiff && !compact ? '提交图' : '列表'}
                </Button>
              )}
              <strong title={selected.message}>{selected.message}</strong>
              <code title={selected.hash}>{selected.shortHash}</code>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭提交详情"
                onClick={close}
              />
            </header>
            <div className="history-detail__content">
              <aside className="history-detail__files" aria-label="提交元数据与文件变更">
                <div className="history-detail__meta">
                  <span title={selected.email}>{selected.author}</span>
                  <time>{new Date(selected.date).toLocaleString('zh-CN')}</time>
                  <code title={selected.hash}>{selected.hash}</code>
                  <div>
                    {selected.references.map((reference) => (
                      <HistoryReference key={reference.fullName} reference={reference} />
                    ))}
                  </div>
                  {selected.parents.length > 1 && <span>合并提交 · 与第一父提交比较</span>}
                </div>
                <div className="history-detail__file-heading">
                  <strong>文件变更</strong>
                  <span>{commitFilesLoading ? '读取中…' : commitFiles.length}</span>
                  {file && (
                    <Button type="text" size="small" onClick={() => setFile(null)}>
                      查看全部
                    </Button>
                  )}
                </div>
                <FeedbackNotice
                  source="commit-files"
                  context={selected.shortHash}
                  title={commitFilesError ? '提交文件读取失败' : null}
                  description={commitFilesError || undefined}
                  actionLabel="重试"
                  busy={commitFilesLoading}
                  onAction={() => fetchCommitFiles(repoId, selected.hash)}
                />
                {commitFilesError ? (
                  <ErrorState
                    announce={false}
                    title="无法读取提交文件"
                    description="请重试读取此提交的文件变更。"
                    onRetry={() => void fetchCommitFiles(repoId, selected.hash)}
                  />
                ) : (
                  commitFiles.map((item: CommitFile) => (
                    <button
                      key={item.path}
                      type="button"
                      className={
                        'commit-file-row' +
                        (file?.path === item.path ? ' commit-file-row--selected' : '')
                      }
                      aria-label={'查看提交文件 ' + item.path}
                      onClick={() => setFile(item)}
                      title={item.oldPath ? item.oldPath + ' → ' + item.path : item.path}
                    >
                      <span
                        className={
                          'commit-file-row__status commit-file-row__status--' + item.status
                        }
                      >
                        {statuses[item.status]}
                      </span>
                      <FileIcon path={item.path} />
                      <span className="commit-file-row__path">{item.path}</span>
                      <span className="commit-file-row__stats">
                        {item.additions ? (
                          <span className="additions">+{item.additions}</span>
                        ) : null}
                        {item.deletions ? (
                          <span className="deletions">−{item.deletions}</span>
                        ) : null}
                      </span>
                    </button>
                  ))
                )}
              </aside>
              <DiffViewer
                diff={diff}
                loading={diffLoading}
                comparisonKey={JSON.stringify([repoId, selected.hash, file?.path])}
                repoId={repoId}
                filePath={file?.path}
                imageRequest={{ commit: selected.hash }}
                error={diffError}
                title={file?.path || '全部文件变更'}
                onFocus={() => {
                  updateLayout({ sidebarCollapsed: true });
                  setFocusDiff(true);
                }}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
