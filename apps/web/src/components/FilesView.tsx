import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Spin } from 'antd';
import {
  ApiOutlined,
  CopyOutlined,
  EyeOutlined,
  FileExclamationOutlined,
  FileSearchOutlined,
  LinkOutlined,
  LockOutlined,
  MinusSquareOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { DIFF_IMAGE_MAX_BYTES, REPOSITORY_TREE_MAX_ENTRIES } from '@alune/shared';
import type { RepositoryFilePreview, RepositoryTreeEntry } from '@alune/shared';
import { repositoryApi } from '../api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { FILES_STACKED_WIDTH, FILES_TREE_MAX, FILES_TREE_MIN } from '../stores/workspaceLayout';
import { PanelResizeHandle } from './PanelResizeHandle';
import { ImagePreview, formatBytes } from './ImageDiffView';
import { CommandButton, FileIcon, FolderIcon } from './ui';
import { fileLanguage } from './file-language';
import type { FileLanguage } from './file-language';
import {
  ROOT,
  errorMessage,
  errorStatus,
  isExpandable,
  parentOf,
  treeRows,
  visibleDirectories,
} from './files-tree';
import type { DirectoryState, TreeRow } from './files-tree';

type FileState =
  | { phase: 'loading'; path: string; stale?: RepositoryFilePreview }
  | { phase: 'ready'; path: string; preview: RepositoryFilePreview }
  | { phase: 'error'; path: string; message: string; status?: number };

type Snapshot = {
  directories: Record<string, DirectoryState>;
  expanded: string[];
  selected: RepositoryTreeEntry | null;
  focused: string | null;
};

// Returning to the view restores the tree and selection, then revalidates them.
const sessions = new Map<string, Snapshot>();
const SESSION_LIMIT = 12;

// Prism turns every token into an element; beyond this the preview stays plain text.
export const HIGHLIGHT_MAX_CHARS = 256 * 1024;
const PREVIEW_MIN = 320;

let highlighterModule: Promise<typeof import('./syntax-highlight')> | undefined;
const loadHighlighter = () => (highlighterModule ??= import('./syntax-highlight'));

const encodingLabels = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE' };

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

// CRLF is shown as LF; one final newline does not add an empty numbered line.
export function displayText(content: string): { text: string; lines: number; crlf: boolean } {
  const crlf = content.includes('\r\n');
  let text = content.replace(/\r\n?/g, '\n');
  if (text.endsWith('\n')) text = text.slice(0, -1);
  let lines = 1;
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) lines++;
  return { text, lines, crlf };
}

export function FilesView({ repoId, refreshToken = 0 }: { repoId: string; refreshToken?: number }) {
  const snapshot = sessions.get(repoId);
  const savedTreeWidth = useWorkspaceStore((state) => state.layout.filesTreeWidth);
  const updateLayout = useWorkspaceStore((state) => state.updateLayout);
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>(
    () => snapshot?.directories || {},
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(snapshot?.expanded));
  const [selected, setSelected] = useState<RepositoryTreeEntry | null>(
    () => snapshot?.selected || null,
  );
  const [file, setFile] = useState<FileState | null>(null);
  const [focused, setFocused] = useState<string | null>(() => snapshot?.focused || null);
  const [width, setWidth] = useState<number | null>(null);
  const container = useRef<HTMLElement>(null);
  const requests = useRef(new Map<string, AbortController>());
  const fileRequest = useRef<AbortController | null>(null);
  const items = useRef(new Map<string, HTMLDivElement>());
  const focusPending = useRef(false);
  const typeahead = useRef({ text: '', at: 0 });
  const current = useRef({ directories, expanded, selected });
  current.current = { directories, expanded, selected };

  const { rows } = useMemo(() => treeRows(directories, expanded), [directories, expanded]);
  const entryRows = useMemo(
    () => rows.filter((row): row is Extract<TreeRow, { type: 'entry' }> => row.type === 'entry'),
    [rows],
  );

  const loadDirectory = useCallback(
    (path: string) => {
      requests.current.get(path)?.abort();
      const controller = new AbortController();
      requests.current.set(path, controller);
      setDirectories((state) => ({
        ...state,
        [path]: { phase: 'loading', listing: state[path]?.listing },
      }));
      const settle = (next: (previous?: DirectoryState) => DirectoryState) => {
        if (requests.current.get(path) !== controller) return;
        requests.current.delete(path);
        setDirectories((state) => ({ ...state, [path]: next(state[path]) }));
      };
      repositoryApi.tree(repoId, path, controller.signal).then(
        (listing) => settle(() => ({ phase: 'ready', listing })),
        (error) => {
          if (controller.signal.aborted) return;
          settle((previous) => ({
            phase: 'error',
            message: errorMessage(error, '无法读取目录'),
            status: errorStatus(error),
            listing: previous?.listing,
          }));
        },
      );
    },
    [repoId],
  );

  const loadFile = useCallback(
    (path: string) => {
      fileRequest.current?.abort();
      const controller = new AbortController();
      fileRequest.current = controller;
      setFile((state) => ({
        phase: 'loading',
        path,
        stale:
          state?.path === path
            ? state.phase === 'ready'
              ? state.preview
              : state.phase === 'loading'
                ? state.stale
                : undefined
            : undefined,
      }));
      repositoryApi.file(repoId, path, controller.signal).then(
        (preview) => {
          if (fileRequest.current !== controller) return;
          fileRequest.current = null;
          setFile({ phase: 'ready', path, preview });
        },
        (error) => {
          if (controller.signal.aborted || fileRequest.current !== controller) return;
          fileRequest.current = null;
          setFile({
            phase: 'error',
            path,
            message: errorMessage(error, '无法读取文件'),
            status: errorStatus(error),
          });
        },
      );
    },
    [repoId],
  );

  // Revalidate a restored tree and preview; stop every request when leaving.
  useEffect(() => {
    const restored = current.current;
    if (snapshot) {
      for (const path of visibleDirectories(restored.directories, restored.expanded))
        loadDirectory(path);
    }
    if (restored.selected?.kind === 'file') loadFile(restored.selected.path);
    const pending = requests.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      fileRequest.current?.abort();
      fileRequest.current = null;
    };
    // Mount only: the snapshot is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load directories as they become visible. Nothing under a collapsed folder is read.
  useEffect(() => {
    for (const path of visibleDirectories(directories, expanded)) {
      const state = directories[path];
      if ((!state || state.phase === 'loading') && !requests.current.has(path)) loadDirectory(path);
    }
  }, [directories, expanded, loadDirectory]);

  // The toolbar refresh reloads what is on screen and forgets hidden listings.
  const seenToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === seenToken.current) return;
    seenToken.current = refreshToken;
    const { directories: known, expanded: open, selected: entry } = current.current;
    const visible = visibleDirectories(known, open);
    setDirectories((state) =>
      Object.fromEntries(Object.entries(state).filter(([path]) => visible.includes(path))),
    );
    for (const path of visible) loadDirectory(path);
    if (entry?.kind === 'file') loadFile(entry.path);
  }, [refreshToken, loadDirectory, loadFile]);

  useEffect(() => {
    const ready: Record<string, DirectoryState> = {};
    for (const [path, state] of Object.entries(directories))
      if (state.listing) ready[path] = { phase: 'ready', listing: state.listing };
    sessions.delete(repoId);
    sessions.set(repoId, { directories: ready, expanded: [...expanded], selected, focused });
    if (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value!);
  }, [repoId, directories, expanded, selected, focused]);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Roving focus falls back to the nearest visible ancestor when a folder collapses.
  const visiblePaths = useMemo(() => new Set(entryRows.map((row) => row.entry.path)), [entryRows]);
  let focusPath = focused;
  while (focusPath && !visiblePaths.has(focusPath)) focusPath = parentOf(focusPath) || null;
  if (!focusPath) focusPath = selected && visiblePaths.has(selected.path) ? selected.path : null;
  if (!focusPath) focusPath = entryRows[0]?.entry.path ?? null;

  useEffect(() => {
    if (!focusPending.current || !focusPath) return;
    focusPending.current = false;
    items.current.get(focusPath)?.focus();
  }, [focusPath]);

  const moveFocus = (path: string) => {
    setFocused(path);
    if (path === focusPath) items.current.get(path)?.focus();
    else focusPending.current = true;
  };

  const toggle = (entry: RepositoryTreeEntry, open?: boolean) => {
    const next = open ?? !expanded.has(entry.path);
    setExpanded((state) => {
      const copy = new Set(state);
      if (next) copy.add(entry.path);
      else copy.delete(entry.path);
      return copy;
    });
    if (next && directories[entry.path]?.phase === 'error') loadDirectory(entry.path);
  };

  const open = (entry: RepositoryTreeEntry) => {
    setFocused(entry.path);
    if (isExpandable(entry)) {
      toggle(entry);
      return;
    }
    if (selected?.path === entry.path && file?.phase !== 'error') return;
    setSelected(entry);
    if (entry.kind === 'file') loadFile(entry.path);
    else {
      fileRequest.current?.abort();
      fileRequest.current = null;
      setFile(null);
    }
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = entryRows.findIndex((row) => row.entry.path === focusPath);
    const row = entryRows[index];
    if (!row) return;
    const go = (target?: { entry: RepositoryTreeEntry }) => {
      event.preventDefault();
      if (target) moveFocus(target.entry.path);
    };
    switch (event.key) {
      case 'ArrowDown':
        return go(entryRows[index + 1]);
      case 'ArrowUp':
        return go(entryRows[index - 1]);
      case 'Home':
        return go(entryRows[0]);
      case 'End':
        return go(entryRows[entryRows.length - 1]);
      case 'ArrowRight':
        event.preventDefault();
        if (!isExpandable(row.entry)) return;
        if (!row.expanded) return toggle(row.entry, true);
        if (entryRows[index + 1]?.parent === row.entry.path)
          moveFocus(entryRows[index + 1].entry.path);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.expanded) return toggle(row.entry, false);
        if (row.parent !== ROOT) moveFocus(row.parent);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        return open(row.entry);
      default:
        if (event.key.length !== 1 || event.key === ' ') return;
        {
          const now = Date.now();
          const text =
            (now - typeahead.current.at < 600 ? typeahead.current.text : '') +
            event.key.toLowerCase();
          typeahead.current = { text, at: now };
          const ordered = [...entryRows.slice(index + (text.length > 1 ? 0 : 1)), ...entryRows];
          const match = ordered.find((item) => item.entry.name.toLowerCase().startsWith(text));
          if (match) go(match);
        }
    }
  };

  const collapseAll = () => {
    setExpanded(new Set());
    if (focusPath?.includes('/')) setFocused(focusPath.slice(0, focusPath.indexOf('/')));
  };

  const stacked = width !== null && width < FILES_STACKED_WIDTH;
  const treeMax =
    width === null
      ? FILES_TREE_MAX
      : Math.max(FILES_TREE_MIN, Math.min(FILES_TREE_MAX, width - PREVIEW_MIN));
  const treeWidth = Math.min(savedTreeWidth, treeMax);
  const root = directories[ROOT];

  return (
    <section
      ref={container}
      className={`workspace-panel files-view${stacked ? ' files-view--stacked' : ''}`}
      aria-label="仓库文件"
    >
      <div
        id="files-tree-panel"
        className="files-view__tree"
        style={stacked ? undefined : { width: treeWidth }}
      >
        <div className="files-tree__header">
          <div className="files-tree__title">
            <span>工作区文件</span>
            <span className="files-badge" title="只读浏览，不会修改远端文件">
              <EyeOutlined /> 只读
            </span>
          </div>
          <CommandButton label="折叠全部文件夹" onClick={collapseAll} disabled={!expanded.size}>
            <MinusSquareOutlined />
          </CommandButton>
        </div>
        {!root?.listing ? (
          root?.phase === 'error' ? (
            <FilesNotice
              tone="error"
              icon={<FileExclamationOutlined />}
              title={root.status === 403 ? '没有读取仓库目录的权限' : '无法读取仓库目录'}
              action={{ label: '重试', onClick: () => loadDirectory(ROOT) }}
            >
              {root.message}
            </FilesNotice>
          ) : (
            <div className="files-tree__loading" role="status">
              <Spin size="small" />
              <span>正在读取目录…</span>
            </div>
          )
        ) : (
          <>
            {root.phase === 'error' && (
              <div className="files-tree__banner" role="alert">
                <span>刷新目录失败：{root.message}</span>
                <button type="button" className="text-button" onClick={() => loadDirectory(ROOT)}>
                  重试
                </button>
              </div>
            )}
            {root.listing.entries.length === 0 ? (
              <p className="files-tree__empty">此仓库工作区没有可显示的文件。</p>
            ) : (
              <div
                className="files-tree"
                role="tree"
                aria-label="仓库文件树"
                aria-busy={root.phase === 'loading'}
                onKeyDown={onTreeKeyDown}
              >
                {rows.map((row) =>
                  row.type === 'entry' ? (
                    <TreeItem
                      key={row.entry.path}
                      row={row}
                      selected={selected?.path === row.entry.path}
                      focusable={focusPath === row.entry.path}
                      loading={directories[row.entry.path]?.phase === 'loading'}
                      failed={directories[row.entry.path]?.phase === 'error'}
                      itemRef={(element) => {
                        if (element) items.current.set(row.entry.path, element);
                        else items.current.delete(row.entry.path);
                      }}
                      onOpen={() => open(row.entry)}
                    />
                  ) : (
                    <TreeNotice
                      key={`${row.directory}\0${row.notice}`}
                      row={row}
                      state={directories[row.directory]}
                      onRetry={() => loadDirectory(row.directory)}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
      {!stacked && (
        <PanelResizeHandle
          label="调整文件树宽度"
          controls="files-tree-panel"
          value={treeWidth}
          min={FILES_TREE_MIN}
          max={treeMax}
          onChange={(value) => updateLayout({ filesTreeWidth: value })}
        />
      )}
      <FilePreviewPane
        entry={selected}
        file={file && selected?.path === file.path ? file : null}
        onRetry={() => selected && loadFile(selected.path)}
      />
    </section>
  );
}

function TreeItem({
  row,
  selected,
  focusable,
  loading,
  failed,
  itemRef,
  onOpen,
}: {
  row: Extract<TreeRow, { type: 'entry' }>;
  selected: boolean;
  focusable: boolean;
  loading: boolean;
  failed: boolean;
  itemRef: (element: HTMLDivElement | null) => void;
  onOpen: () => void;
}) {
  const { entry } = row;
  const expandable = isExpandable(entry);
  const hint =
    entry.kind === 'symlink'
      ? `符号链接 → ${entry.target ?? '未知目标'}`
      : entry.kind === 'submodule'
        ? '嵌套仓库或子模块'
        : entry.kind === 'other'
          ? '特殊文件'
          : undefined;
  return (
    <div
      ref={itemRef}
      role="treeitem"
      className={`files-tree__item files-tree__item--${entry.kind}${selected ? ' files-tree__item--selected' : ''}`}
      style={{ '--level': row.level } as CSSProperties}
      aria-level={row.level}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      aria-expanded={row.expanded}
      aria-selected={expandable ? undefined : selected}
      aria-busy={loading || undefined}
      aria-invalid={failed || undefined}
      aria-label={hint ? `${entry.name}，${hint}` : undefined}
      tabIndex={focusable ? 0 : -1}
      title={hint ? `${entry.path}\n${hint}` : entry.path}
      onClick={onOpen}
    >
      <span className="files-tree__twisty" aria-hidden="true">
        {expandable &&
          (loading ? <Spin size="small" /> : <RightOutlined rotate={row.expanded ? 90 : 0} />)}
      </span>
      <span className="files-tree__icon" aria-hidden="true">
        {expandable ? (
          <FolderIcon open={row.expanded} />
        ) : entry.kind === 'submodule' ? (
          <FolderIcon variant="repository" />
        ) : (
          <FileIcon path={entry.name} />
        )}
        {entry.kind === 'symlink' && <LinkOutlined className="files-tree__link-mark" />}
      </span>
      <span className="files-tree__name">{entry.name}</span>
      {entry.kind === 'symlink' && entry.target && (
        <span className="files-tree__meta" aria-hidden="true">
          → {entry.target}
        </span>
      )}
      {entry.kind === 'submodule' && (
        <span className="files-tree__meta" aria-hidden="true">
          子模块
        </span>
      )}
    </div>
  );
}

function TreeNotice({
  row,
  state,
  onRetry,
}: {
  row: Extract<TreeRow, { type: 'notice' }>;
  state?: DirectoryState;
  onRetry: () => void;
}) {
  // A notice sits at the level of the folder's children, aligned with their icons.
  const style = { '--level': row.level } as CSSProperties;
  if (row.notice === 'loading')
    return (
      <div className="files-tree__notice" role="none" style={style}>
        <Spin size="small" /> 正在读取…
      </div>
    );
  if (row.notice === 'empty')
    return (
      <div className="files-tree__notice" role="none" style={style}>
        空文件夹
      </div>
    );
  if (row.notice === 'truncated') {
    const total = state?.listing?.total ?? 0;
    return (
      <div className="files-tree__notice files-tree__notice--warning" role="none" style={style}>
        仅显示前 {REPOSITORY_TREE_MAX_ENTRIES.toLocaleString()} 项，共 {total.toLocaleString()} 项。
      </div>
    );
  }
  const message = state?.phase === 'error' ? state.message : '无法读取目录';
  return (
    <div className="files-tree__notice files-tree__notice--error" role="none" style={style}>
      <span>{message}</span>
      <button type="button" className="text-button" tabIndex={-1} onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function FilesNotice({
  icon,
  title,
  children,
  tone = 'info',
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  tone?: 'info' | 'warning' | 'error';
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      className={`files-notice files-notice--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="files-notice__icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && (
        <button type="button" className="text-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function FilePreviewPane({
  entry,
  file,
  onRetry,
}: {
  entry: RepositoryTreeEntry | null;
  file: FileState | null;
  onRetry: () => void;
}) {
  if (!entry)
    return (
      <div className="files-view__preview">
        <FilesNotice icon={<FileSearchOutlined />} title="选择文件以预览">
          在左侧目录树中选择文件，查看当前工作区中的内容。浏览为只读，不会修改远端文件。
        </FilesNotice>
      </div>
    );

  const preview =
    file?.phase === 'ready' ? file.preview : file?.phase === 'loading' ? file.stale : undefined;
  const language = fileLanguage(entry.path);
  const text = preview?.kind === 'text' ? displayText(preview.content) : null;
  const meta: string[] = [];
  if (preview?.kind === 'text') {
    meta.push(language?.label ?? '纯文本', encodingLabels[preview.encoding]);
    if (text!.crlf) meta.push('CRLF');
    meta.push(`${text!.lines.toLocaleString()} 行`);
  }
  if (preview && 'size' in preview) meta.push(formatBytes(preview.size));

  return (
    <div
      className="files-view__preview"
      aria-label="文件预览"
      aria-busy={file?.phase === 'loading'}
    >
      <div className="files-preview__header">
        <h3 className="files-preview__path" title={entry.path}>
          {entry.path.includes('/') && (
            <span className="files-preview__dir">
              {entry.path.slice(0, entry.path.lastIndexOf('/') + 1)}
            </span>
          )}
          <span className="files-preview__name">{fileName(entry.path)}</span>
        </h3>
        <div className="files-preview__meta">
          {file?.phase === 'loading' && preview && <Spin size="small" aria-label="正在刷新" />}
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
          <CommandButton
            label="复制文件路径"
            onClick={() => void navigator.clipboard?.writeText(entry.path)}
          >
            <CopyOutlined />
          </CommandButton>
        </div>
      </div>
      <div className="files-preview__body">
        <PreviewBody
          entry={entry}
          file={file}
          preview={preview}
          text={text}
          language={language}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

function PreviewBody({
  entry,
  file,
  preview,
  text,
  language,
  onRetry,
}: {
  entry: RepositoryTreeEntry;
  file: FileState | null;
  preview?: RepositoryFilePreview;
  text: ReturnType<typeof displayText> | null;
  language: FileLanguage | null;
  onRetry: () => void;
}) {
  if (entry.kind === 'submodule')
    return (
      <FilesNotice icon={<ApiOutlined />} title="嵌套仓库或子模块">
        此目录包含独立的 Git 仓库，文件浏览不会进入其中。如需查看，请将其作为仓库单独添加。
      </FilesNotice>
    );
  if (entry.kind === 'symlink' || preview?.kind === 'symlink')
    return (
      <FilesNotice icon={<LinkOutlined />} title="符号链接">
        指向{' '}
        <code>{preview?.kind === 'symlink' ? preview.target : (entry.target ?? '未知目标')}</code>
        。为避免越出仓库，只读浏览不会跟随链接。
      </FilesNotice>
    );
  if (entry.kind === 'other' || preview?.kind === 'other')
    return (
      <FilesNotice icon={<FileExclamationOutlined />} title="特殊文件">
        这是管道、套接字或设备等特殊文件，不会读取其内容。
      </FilesNotice>
    );
  if (file?.phase === 'error')
    return (
      <FilesNotice
        tone="error"
        icon={file.status === 403 ? <LockOutlined /> : <FileExclamationOutlined />}
        title={
          file.status === 404 ? '文件不存在' : file.status === 403 ? '没有读取权限' : '无法读取文件'
        }
        action={{ label: '重试', onClick: onRetry }}
      >
        {file.message}
      </FilesNotice>
    );
  if (!preview)
    return (
      <div className="files-preview__loading" role="status">
        <Spin size="small" />
        <span>正在读取文件…</span>
      </div>
    );
  switch (preview.kind) {
    case 'text':
      return preview.content === '' ? (
        <FilesNotice icon={<FileSearchOutlined />} title="空文件">
          此文件没有内容。
        </FilesNotice>
      ) : (
        <CodeView path={entry.path} text={text!.text} lines={text!.lines} language={language} />
      );
    case 'image':
      return (
        <div className="files-preview__image">
          <ImagePreview
            label="工作区版本"
            alt={fileName(entry.path)}
            state={{
              phase: 'ready',
              mediaType: preview.mediaType,
              byteLength: preview.size,
              content: preview.content,
            }}
          />
        </div>
      );
    case 'binary':
      return (
        <FilesNotice icon={<FileExclamationOutlined />} title="二进制文件">
          此文件包含二进制内容（{formatBytes(preview.size)}），不提供文本预览。
        </FilesNotice>
      );
    case 'too-large':
      return (
        <FilesNotice tone="warning" icon={<FileExclamationOutlined />} title="文件过大">
          文件大小为 {formatBytes(preview.size)}，超过
          {preview.limit === DIFF_IMAGE_MAX_BYTES ? '图片' : '文本'}预览上限{' '}
          {formatBytes(preview.limit)}，因此不会读取内容。
        </FilesNotice>
      );
    case 'unsupported-encoding':
      return (
        <FilesNotice icon={<FileExclamationOutlined />} title="不支持的文本编码">
          仅预览 UTF-8 以及带 BOM 的 UTF-16 文本。此文件可能使用 GBK
          等其他编码，为避免乱码不作显示。
        </FilesNotice>
      );
  }
}

function useHighlighter(enabled: boolean) {
  const [module, setModule] = useState<Awaited<ReturnType<typeof loadHighlighter>> | null>(null);
  useEffect(() => {
    if (!enabled || module) return;
    let active = true;
    loadHighlighter().then(
      (loaded) => active && setModule(loaded),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [enabled, module]);
  return module;
}

export function CodeView({
  path,
  text,
  lines,
  language,
}: {
  path: string;
  text: string;
  lines: number;
  language: FileLanguage | null;
}) {
  const highlightable = Boolean(language) && text.length <= HIGHLIGHT_MAX_CHARS;
  const highlighter = useHighlighter(highlightable);
  const tokens = useMemo(
    () =>
      highlightable && highlighter && language ? highlighter.highlight(text, language.id) : null,
    [highlightable, highlighter, language, text],
  );
  const gutter = useMemo(
    () => Array.from({ length: lines }, (_, index) => index + 1).join('\n'),
    [lines],
  );
  return (
    <>
      {language && !highlightable && (
        <p className="files-preview__hint" role="status">
          文件超过 {formatBytes(HIGHLIGHT_MAX_CHARS)}，已关闭语法高亮以保持流畅。
        </p>
      )}
      <div
        className="files-code"
        role="region"
        aria-label={`${fileName(path)} 的内容`}
        tabIndex={0}
      >
        <div className="files-code__lines">
          <pre className="files-code__gutter" aria-hidden="true">
            {gutter}
          </pre>
          <pre className="files-code__content" data-language={language?.id}>
            <code>{tokens ?? text}</code>
          </pre>
        </div>
      </div>
    </>
  );
}
