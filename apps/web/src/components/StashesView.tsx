import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@alune/ui';
import { DeleteOutlined, InboxOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { AlunePopconfirm } from '@alune/ui';
import { AluneModal, CheckCard, DialogHints, Kbd } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogEmpty, DialogPath } from '@alune/ui';
import { getNumberedDiffLines } from './diff-lines';
import type { NumberedDiffLine } from './diff-lines';
import { ErrorState, EmptyState, PanelHeader } from '@alune/ui';
import { formatRelativeDate } from './ui';

interface StashFile {
  path: string;
  added: boolean;
  deleted: boolean;
  binary: boolean;
  adds: number;
  dels: number;
  lines: NumberedDiffLine[];
}

// Groups `git stash show --patch` output by file; headers become the file row and
// only hunk content is rendered as diff rows.
function parseStashDiff(diff: string): StashFile[] {
  const files: StashFile[] = [];
  let current: StashFile | null = null;
  let inHunk = false;
  for (const line of getNumberedDiffLines(diff)) {
    const { text } = line;
    if (text.startsWith('diff --git ')) {
      const paths = /^diff --git "?a\/(.*?)"? "?b\/(.*?)"?$/.exec(text);
      current = {
        path: paths?.[2] ?? text.slice('diff --git '.length),
        added: false,
        deleted: false,
        binary: false,
        adds: 0,
        dels: 0,
        lines: [],
      };
      inHunk = false;
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (text.startsWith('@@')) inHunk = true;
    else if (!inHunk) {
      if (text.startsWith('+++ b/')) current.path = text.slice(6);
      else if (text.startsWith('rename to ')) current.path = text.slice(10);
      else if (text.startsWith('new file mode')) current.added = true;
      else if (text.startsWith('deleted file mode')) current.deleted = true;
      else if (/^Binary files |^GIT binary patch$/.test(text)) current.binary = true;
      continue;
    }
    if (line.kind === 'add') current.adds++;
    if (line.kind === 'remove') current.dels++;
    current.lines.push(line);
  }
  // The trailing newline of the patch would otherwise show up as an empty meta row.
  for (const file of files) {
    while (file.lines.length && file.lines[file.lines.length - 1].text === '') file.lines.pop();
  }
  return files;
}

function StashDiff({ diff }: { diff: string }) {
  const files = useMemo(() => parseStashDiff(diff), [diff]);
  if (!diff.trim()) {
    return (
      <DialogCard>
        <DialogEmpty>此储藏没有文本差异。</DialogEmpty>
      </DialogCard>
    );
  }
  if (!files.length) {
    return (
      <DialogCard>
        <pre className="stash-diff">{diff}</pre>
      </DialogCard>
    );
  }
  const adds = files.reduce((sum, file) => sum + file.adds, 0);
  const dels = files.reduce((sum, file) => sum + file.dels, 0);
  return (
    <>
      <div className="dlg-badges">
        <span className="dlg-badge">
          <DialogIcon name="file" />
          {files.length} 个文件
        </span>
        <span className="dlg-badge is-mono" data-tone="success" aria-label={`新增 ${adds} 行`}>
          +{adds}
        </span>
        <span className="dlg-badge is-mono" data-tone="danger" aria-label={`删除 ${dels} 行`}>
          −{dels}
        </span>
      </div>
      <DialogCard>
        <div className="stash-diff" tabIndex={0} aria-label="储藏差异内容">
          <div className="diff-unified-view">
            {files.map((file, fileIndex) => (
              <div key={`${fileIndex}-${file.path}`}>
                <div className="dlg-diff-file">
                  <DialogIcon name={file.added ? 'file-plus' : 'file'} />
                  <DialogPath path={file.path} />
                  {file.added ? (
                    <span className="dlg-badge" data-tone="success">
                      新文件
                    </span>
                  ) : file.deleted ? (
                    <span className="dlg-badge" data-tone="danger">
                      已删除
                    </span>
                  ) : null}
                  {file.adds || file.dels ? (
                    <span className="dlg-badges">
                      <span className="dlg-badge is-mono" data-tone="success">
                        +{file.adds}
                      </span>
                      <span className="dlg-badge is-mono" data-tone="danger">
                        −{file.dels}
                      </span>
                    </span>
                  ) : null}
                </div>
                {file.lines.length ? (
                  file.lines.map(({ text, kind, oldLine, newLine }, index) => (
                    <div className={`diff-code-row diff-code-row--${kind}`} key={index}>
                      {kind !== 'meta' && (
                        <>
                          <span className="diff-line-number" aria-hidden="true">
                            {oldLine}
                          </span>
                          <span className="diff-line-number" aria-hidden="true">
                            {newLine}
                          </span>
                        </>
                      )}
                      <code>{text}</code>
                    </div>
                  ))
                ) : (
                  <div className="diff-code-row diff-code-row--meta">
                    <code>
                      {file.binary
                        ? '二进制文件，无法显示文本差异。'
                        : file.added
                          ? '新增空文件'
                          : '没有文本内容变化'}
                    </code>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogCard>
    </>
  );
}

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function StashesView({ repoId, onRefresh }: Props) {
  const message = useFeedbackMessage();
  const { stashes, fetchStashes, error, errorPanel } = useRepositoryStore();
  const repoName = useRepositoryStore(
    (state) => state.repositories.find((repo) => repo.id === repoId)?.name,
  );
  const status = useRepositoryStore((state) => state.repositoryStatuses[repoId]?.data);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [stashModalVisible, setStashModalVisible] = useState(false);
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [preview, setPreview] = useState<{ index: number; diff: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);

  useEffect(() => {
    void fetchStashes(repoId);
  }, [repoId, fetchStashes]);

  const refresh = async () => {
    await fetchStashes(repoId);
    onRefresh();
  };

  const runStashAction = async (action: 'stashPop' | 'stashApply' | 'stashDrop', index: number) => {
    setLoading(true);
    try {
      await gitApi[action](repoId, index);
      await refresh();
    } catch (err: any) {
      message.error(err.message || '储藏操作失败');
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const createStash = async () => {
    setLoading(true);
    try {
      await gitApi.stash(repoId, stashMessage.trim() || undefined, includeUntracked);
      setStashMessage('');
      setStashModalVisible(false);
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法创建储藏');
    } finally {
      setLoading(false);
    }
  };

  const showStash = async (index: number) => {
    setPreviewLoading(index);
    try {
      setPreview({ index, ...(await gitApi.stashShow(repoId, index)) });
    } catch (error: any) {
      message.error(error.message);
    } finally {
      setPreviewLoading(null);
    }
  };

  // Keep the last preview while the dialog animates out.
  const lastPreview = useRef(preview);
  if (preview) lastPreview.current = preview;
  const shownPreview = preview ?? lastPreview.current;
  const previewStash = shownPreview
    ? stashes.find((stash: any) => stash.index === shownPreview.index)
    : undefined;
  // Counts come from the last status read, so they only describe what that read saw.
  const stashCounts = useMemo(() => {
    if (!status) return null;
    const tracked = new Set<string>();
    const untracked = new Set<string>();
    for (const file of status.files) {
      if (file.status === 'ignored') continue;
      (file.status === 'untracked' ? untracked : tracked).add(file.path);
    }
    return { tracked: tracked.size, untracked: untracked.size };
  }, [status]);

  return (
    <section className="workspace-panel">
      <PanelHeader
        title="储藏"
        count={stashes.length}
        description="暂时保存改动，无需提交"
        icon={<InboxOutlined />}
        extra={
          <>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              aria-label="刷新储藏"
              onClick={() => void refresh()}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setStashModalVisible(true)}
            >
              储藏改动
            </Button>
          </>
        }
      />
      {error && errorPanel === 'stashes' && !stashes.length ? (
        <ErrorState
          title="无法读取储藏"
          description={error}
          onRetry={() => void fetchStashes(repoId)}
        />
      ) : stashes.length === 0 ? (
        <EmptyState
          title="暂无储藏"
          description="切换工作上下文时，可以使用储藏安全保存进行中的改动。"
          action={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setStashModalVisible(true)}
            >
              储藏当前改动
            </Button>
          }
        />
      ) : (
        <div className="stash-list">
          {stashes.map((stash: any) => (
            <article className="stash-card" key={stash.index}>
              <div className="stash-card__top">
                <InboxOutlined />
                <strong>stash@&#123;{stash.index}&#125;</strong>
                {stash.branch && <span className="stash-card__meta">位于 {stash.branch}</span>}
              </div>
              <div className="stash-card__message">{stash.message || '工作区快照'}</div>
              <div className="stash-card__meta">
                {formatRelativeDate(stash.date)} · 快照 {stash.index + 1}
              </div>
              <div className="stash-card__actions">
                <Button
                  size="small"
                  loading={previewLoading === stash.index}
                  onClick={() => void showStash(stash.index)}
                >
                  查看差异
                </Button>
                <Button
                  size="small"
                  onClick={() => void runStashAction('stashApply', stash.index)}
                  loading={loading}
                >
                  应用
                </Button>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => void runStashAction('stashPop', stash.index)}
                  loading={loading}
                >
                  弹出
                </Button>
                <AlunePopconfirm
                  icon="archive"
                  title={
                    <>
                      删除{' '}
                      <code>
                        stash@{'{'}
                        {stash.index}
                        {'}'}
                      </code>
                      ？
                    </>
                  }
                  description={
                    stash.message
                      ? `“${stash.message}”删除后无法恢复。`
                      : '这条储藏删除后无法恢复。'
                  }
                  okText="删除储藏"
                  disabled={loading}
                  onConfirm={() => runStashAction('stashDrop', stash.index)}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除储藏 ${stash.index}`}
                  >
                    删除
                  </Button>
                </AlunePopconfirm>
              </div>
            </article>
          ))}
        </div>
      )}
      <AluneModal
        open={preview !== null}
        size="xl"
        glyph="archive"
        eyebrow={{
          label: '储藏',
          detail: [
            repoName,
            previewStash?.branch,
            previewStash && formatRelativeDate(previewStash.date),
          ]
            .filter(Boolean)
            .join(' · '),
        }}
        title={
          <>
            储藏差异 · <code>{`stash@{${shownPreview?.index ?? 0}}`}</code>
          </>
        }
        description={previewStash?.message || undefined}
        onCancel={() => setPreview(null)}
        afterOpenChange={(visible) => {
          if (visible) closeRef.current?.focus();
        }}
        hints={
          <DialogHints>
            <span>
              <Kbd>Esc</Kbd> 关闭
            </span>
            <i />
            <span>只读预览</span>
          </DialogHints>
        }
        footer={
          <Button ref={closeRef} autoFocus onClick={() => setPreview(null)}>
            关闭
          </Button>
        }
      >
        {shownPreview && <StashDiff diff={shownPreview.diff} />}
      </AluneModal>
      <AluneModal
        open={stashModalVisible}
        size="sm"
        glyph="archive"
        eyebrow={{
          label: '储藏',
          detail: [repoName, status?.branch].filter(Boolean).join(' · ') || undefined,
        }}
        title="储藏当前改动"
        description="保存改动并还原工作区，之后可以随时恢复。"
        hintVerb="创建"
        onCancel={() => setStashModalVisible(false)}
        onOk={createStash}
        confirmLoading={loading}
        okText="创建储藏"
        busyText="正在储藏…"
      >
        <label className="dlg-fld">
          <span className="dlg-fld-label">
            <span>备注</span>
            <small>可选</small>
          </span>
          <Input
            data-autofocus
            placeholder="例如：设置页布局实验"
            value={stashMessage}
            prefix={<DialogIcon name="pencil" />}
            onChange={(event) => setStashMessage(event.target.value)}
          />
        </label>
        <CheckCard
          checked={includeUntracked}
          onChange={setIncludeUntracked}
          disabled={loading}
          title="包含未跟踪文件"
          description="忽略文件仍会保留在工作区"
        />
        {stashCounts && (
          <p className="dlg-fld-hint">
            {includeUntracked && stashCounts.untracked
              ? `将储藏 ${stashCounts.tracked + stashCounts.untracked} 项改动，包括 ${stashCounts.untracked} 个未跟踪项`
              : `将储藏 ${stashCounts.tracked} 项已跟踪改动`}
          </p>
        )}
      </AluneModal>
    </section>
  );
}
