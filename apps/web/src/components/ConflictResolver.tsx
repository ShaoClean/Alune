import { useCallback, useEffect, useMemo, useState } from 'react';
import { AimOutlined, CloseOutlined, CheckOutlined } from '@ant-design/icons';
import { AlunePopconfirm, Button, useAluneConfirm, useFeedbackMessage } from '@alune/ui';
import { parseConflictMarkers } from '@alune/shared';
import type {
  ConflictBlock,
  ConflictBlockChoice,
  ConflictSide,
  FileStatus,
  RepositoryFilePreview,
  RepositoryOperationState,
} from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import {
  conflictHint,
  conflictKindLabels,
  contextExcerpt,
  hasConflictBlocks,
  sideNames,
  wholeFileActions,
} from './conflict-model';

interface Props {
  repoId: string;
  file: FileStatus;
  operation?: RepositoryOperationState;
  // Changes when the repository status is re-read, so the file is read again too.
  revision?: string;
  onChanged: () => Promise<void>;
  onFocus?: () => void;
  onClose?: () => void;
}

const unreadable: Partial<Record<RepositoryFilePreview['kind'], string>> = {
  binary: '这是二进制文件',
  image: '这是图片文件',
  'too-large': '文件超过 1 MiB',
  'unsupported-encoding': '文件不是 UTF-8 文本',
  symlink: '这是符号链接',
  other: '这不是普通文件',
};

/** Count conflict blocks still in a worktree file; marks are only a hint before staging. */
export async function remainingConflictBlocks(repoId: string, path: string) {
  try {
    const preview = await repositoryApi.file(repoId, path);
    return preview.kind === 'text'
      ? parseConflictMarkers(preview.content).filter((segment) => segment.kind === 'conflict')
          .length
      : 0;
  } catch {
    // A deleted side has no worktree file; staging records the deletion.
    return 0;
  }
}

/** Marks a conflicted path resolved (stages it), confirming first if markers remain. */
export function useMarkResolved(repoId: string, onChanged: () => Promise<void>) {
  const confirm = useAluneConfirm();
  const message = useFeedbackMessage();
  return useCallback(
    async (path: string, known?: number) => {
      const blocks = known ?? (await remainingConflictBlocks(repoId, path));
      const stage = async () => {
        try {
          await gitApi.stage(repoId, [path]);
        } catch (error: any) {
          message.error(error.message || '无法标记为已解决');
        } finally {
          await onChanged().catch(() => undefined);
        }
      };
      if (!blocks) return stage();
      await confirm({
        level: 1,
        glyph: 'warning',
        eyebrow: { label: '冲突', detail: path },
        title: `仍有 ${blocks} 处冲突标记，确认标记为已解决？`,
        description: '冲突标记会作为文件内容一起暂存并提交。通常应先逐块选择要保留的内容。',
        hintVerb: '标记',
        okText: '仍然标记为已解决',
        busyText: '正在暂存…',
        initialFocus: 'cancel',
        onOk: stage,
      });
    },
    [confirm, message, onChanged, repoId],
  );
}

function Excerpt({ text, before, after }: { text: string; before: boolean; after: boolean }) {
  const [open, setOpen] = useState(false);
  const excerpt = contextExcerpt(text, { before, after });
  if (open || !excerpt.hidden) return <pre className="conflict-context">{text}</pre>;
  return (
    <>
      {excerpt.head && <pre className="conflict-context">{excerpt.head}</pre>}
      <button type="button" className="conflict-fold" onClick={() => setOpen(true)}>
        展开 {excerpt.hidden} 行未冲突的内容
      </button>
      {excerpt.tail && <pre className="conflict-context">{excerpt.tail}</pre>}
    </>
  );
}

function BlockSide({
  side,
  title,
  label,
  text,
}: {
  side: ConflictSide | 'base';
  title: string;
  label?: string;
  text: string;
}) {
  return (
    <div className="conflict-side" data-side={side}>
      <div className="conflict-side__title">
        <strong>{title}</strong>
        {label && <span title={label}>{label}</span>}
      </div>
      {text ? (
        <pre>{text}</pre>
      ) : (
        <p className="conflict-side__empty">此方没有内容（删除了这些行）</p>
      )}
    </div>
  );
}

export function ConflictResolver({
  repoId,
  file,
  operation,
  revision,
  onChanged,
  onFocus,
  onClose,
}: Props) {
  const message = useFeedbackMessage();
  const [preview, setPreview] = useState<RepositoryFilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const markResolved = useMarkResolved(repoId, onChanged);
  const kind = file.conflict;
  const sides = sideNames(operation);
  const blocksAllowed = hasConflictBlocks(kind);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    repositoryApi
      .file(repoId, file.path, controller.signal)
      .then((value) => !controller.signal.aborted && setPreview(value))
      .catch((reason: any) => {
        if (controller.signal.aborted) return;
        setPreview(null);
        // Deleted on one side: there may be no worktree file to read.
        setError(blocksAllowed ? reason.message || '无法读取文件' : null);
      })
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [repoId, file.path, revision, reload, blocksAllowed]);

  const segments = useMemo(
    () => (preview?.kind === 'text' && blocksAllowed ? parseConflictMarkers(preview.content) : []),
    [preview, blocksAllowed],
  );
  const blocks = segments.filter((segment) => segment.kind === 'conflict').length;

  const resolveBlock = async (block: ConflictBlock, choice: ConflictBlockChoice) => {
    setBusy(`block-${block.index}-${choice}`);
    try {
      await gitApi.resolveConflictBlock(repoId, file.path, block.index, choice, block.raw);
    } catch (reason: any) {
      message.error(reason.message || '无法应用此选择');
    } finally {
      setBusy(null);
      setReload((value) => value + 1);
    }
  };

  const resolveFile = async (side: ConflictSide) => {
    setBusy(`file-${side}`);
    try {
      await gitApi.resolveConflictFile(repoId, file.path, side);
    } catch (reason: any) {
      message.error(reason.message || '无法采用所选版本');
    } finally {
      setBusy(null);
      await onChanged().catch(() => undefined);
    }
  };

  const renderBody = () => {
    if (loading && !preview) return <p className="conflict-empty">正在读取文件…</p>;
    if (error) return <p className="conflict-empty conflict-empty--error">{error}</p>;
    if (!blocksAllowed) return null;
    if (!preview) return null;
    if (preview.kind !== 'text')
      return (
        <p className="conflict-empty">
          {unreadable[preview.kind] || '无法读取文件内容'}
          ，无法逐块合并。请整体采用当前或传入的版本。
        </p>
      );
    if (!blocks)
      return (
        <>
          <p className="conflict-empty">文件中已没有冲突标记。检查内容无误后标记为已解决。</p>
          <pre className="conflict-context conflict-context--full">{preview.content}</pre>
        </>
      );
    let seen = 0;
    return segments.map((segment, position) => {
      if (segment.kind === 'text')
        return (
          <Excerpt
            key={`text-${position}`}
            text={segment.text}
            before={position > 0}
            after={position < segments.length - 1}
          />
        );
      const { block } = segment;
      seen += 1;
      return (
        <section
          className="conflict-block"
          key={`block-${block.index}-${block.raw.length}`}
          aria-label={`冲突 ${seen}/${blocks}`}
        >
          <div className="conflict-block__header">
            <strong>
              冲突 {seen}/{blocks}
            </strong>
            <div className="conflict-block__actions">
              {(
                [
                  ['current', '采用当前'],
                  ['incoming', '采用传入'],
                  ['both', '两者都保留'],
                ] as const
              ).map(([choice, label]) => (
                <Button
                  key={choice}
                  size="small"
                  data-choice={choice}
                  aria-label={`冲突 ${seen}：${label}`}
                  loading={busy === `block-${block.index}-${choice}`}
                  disabled={busy !== null || loading}
                  onClick={() => void resolveBlock(block, choice)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className={`conflict-block__sides${block.base !== undefined ? ' has-base' : ''}`}>
            <BlockSide
              side="current"
              title={`当前 · ${sides.current}`}
              label={block.currentLabel}
              text={block.current}
            />
            {block.base !== undefined && (
              <BlockSide side="base" title="共同祖先" label={block.baseLabel} text={block.base} />
            )}
            <BlockSide
              side="incoming"
              title={`传入 · ${sides.incoming}`}
              label={block.incomingLabel}
              text={block.incoming}
            />
          </div>
        </section>
      );
    });
  };

  const actions = wholeFileActions(kind);
  return (
    <section className="diff-shell conflict-shell" aria-label={`解决冲突 ${file.path}`}>
      <div className="diff-shell__header">
        <div className="diff-shell__title" title={file.path}>
          <span className="conflict-kind">{kind ? conflictKindLabels[kind] : '冲突'}</span>
          <div className="diff-shell__filename">
            <span>{file.path}</span>
            <small>
              {blocksAllowed && preview?.kind === 'text'
                ? blocks
                  ? `还有 ${blocks} 处冲突 · 工作区`
                  : '冲突标记已处理 · 工作区'
                : '未合并 · 工作区'}
            </small>
          </div>
        </div>
        <div className="diff-toolbar">
          {onFocus && (
            <Button
              type="text"
              size="small"
              icon={<AimOutlined />}
              aria-label="专注解决冲突"
              title="专注解决冲突 · 隐藏两侧面板"
              onClick={onFocus}
            />
          )}
          {onClose && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label="关闭冲突视图"
              onClick={onClose}
            />
          )}
        </div>
      </div>
      <div className="conflict-summary">
        <p>{conflictHint(kind)}</p>
        <div className="conflict-summary__actions">
          {actions.map((action) => (
            <AlunePopconfirm
              key={action.side + action.label}
              icon={action.removes ? 'trash' : 'swap'}
              tone={action.removes ? 'danger' : 'warning'}
              title={
                action.removes ? '删除此文件并标记为已解决？' : `整个文件${action.label}的版本？`
              }
              description={
                action.removes
                  ? '文件会从工作区和暂存区移除。'
                  : `工作区中的此文件会被${action.side === 'current' ? sides.current : sides.incoming}的版本覆盖（包括已逐块处理的内容），并标记为已解决。`
              }
              okText={action.removes ? '删除文件' : action.label}
              disabled={busy !== null}
              onConfirm={() => resolveFile(action.side)}
            >
              <Button
                size="small"
                danger={action.removes}
                data-side={action.removes ? undefined : action.side}
                loading={busy === `file-${action.side}`}
                disabled={busy !== null}
              >
                {blocksAllowed && !action.removes ? `整个文件${action.label}` : action.label}
              </Button>
            </AlunePopconfirm>
          ))}
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            disabled={busy !== null || loading}
            onClick={() => void markResolved(file.path, blocksAllowed ? blocks : 0)}
          >
            标记为已解决
          </Button>
        </div>
      </div>
      <div className="diff-shell__body conflict-body" aria-busy={loading || undefined}>
        {renderBody()}
      </div>
    </section>
  );
}
