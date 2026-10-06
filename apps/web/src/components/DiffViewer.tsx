import { usePartialDiff } from './usePartialDiff';
import type { PartialDiffControls } from './usePartialDiff';
import { FeedbackAlert } from '@alune/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Segmented } from '@alune/ui';
import {
  CloseOutlined,
  CompressOutlined,
  DiffOutlined,
  ExpandOutlined,
  AimOutlined,
} from '@ant-design/icons';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { getNumberedDiffLines, getDiffNotice, getImageDiffKind } from './diff-lines';
import type { CSSProperties, ReactNode } from 'react';
import { useCodeTheme } from './useCodeTheme';
import { useDiffHighlight } from './useDiffHighlight';
import { HIGHLIGHT_MAX_CHARS, useHighlighter } from './useHighlighter';
import { fileLanguage } from './file-language';
import type { NumberedDiffLine } from './diff-lines';
import { ImageDiffView } from './ImageDiffView';
import type { DiffImageOptions } from '@alune/shared';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { SplitViewIcon, UnifiedViewIcon } from './DiffViewIcons';
import { useDiffFullscreen } from './useDiffFullscreen';

const DIFF_MODES = [
  { value: 'unified' as const, label: '统一视图', icon: <UnifiedViewIcon /> },
  { value: 'split' as const, label: '分栏视图', icon: <SplitViewIcon /> },
];

interface Props {
  oldCode?: string;
  newCode?: string;
  diff?: string;
  title?: string;
  subtitle?: string;
  onFocus?: () => void;
  splitView?: boolean;
  onClose?: () => void;
  loading?: boolean;
  comparisonKey?: string;
  // Set together to enable image previews for the compared file.
  repoId?: string;
  filePath?: string;
  imageRequest?: Omit<DiffImageOptions, 'file' | 'side'>;
  error?: string | null;
  partial?: PartialDiffControls;
}

type SplitCellKind = 'context' | 'add' | 'remove' | 'empty';

interface SplitDiffRow {
  meta?: string;
  metaIndex?: number;
  leftIndex?: number;
  rightIndex?: number;
  left?: ReactNode;
  right?: ReactNode;
  leftKind?: SplitCellKind;
  rightKind?: SplitCellKind;
  oldLine?: number;
  newLine?: number;
}

function getSplitDiffRows(
  lines: NumberedDiffLine[],
  tokens: Array<ReactNode[] | undefined>,
): SplitDiffRow[] {
  const indexByLine = new Map(lines.map((line, index) => [line, index]));
  const contentByLine = new Map(
    lines.map((line, index) => [line, tokens[index] ?? line.text.slice(1)]),
  );
  const content = (line: NumberedDiffLine) => contentByLine.get(line);
  const rows: SplitDiffRow[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind === 'meta') {
      rows.push({ meta: line.text, metaIndex: index });
      index += 1;
      continue;
    }

    if (line.kind === 'remove') {
      const removed: NumberedDiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'remove') {
        removed.push(lines[index]);
        index += 1;
      }
      const added: NumberedDiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'add') {
        added.push(lines[index]);
        index += 1;
      }
      const rowCount = Math.max(removed.length, added.length);
      for (let row = 0; row < rowCount; row += 1) {
        rows.push({
          leftIndex: indexByLine.get(removed[row]),
          rightIndex: indexByLine.get(added[row]),
          left: removed[row] ? content(removed[row]) : '',
          right: added[row] ? content(added[row]) : '',
          oldLine: removed[row]?.oldLine,
          newLine: added[row]?.newLine,
          leftKind: removed[row] === undefined ? 'empty' : 'remove',
          rightKind: added[row] === undefined ? 'empty' : 'add',
        });
      }
      continue;
    }

    if (line.kind === 'add') {
      const added: NumberedDiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'add') {
        added.push(lines[index]);
        index += 1;
      }
      added.forEach((value) =>
        rows.push({
          left: '',
          rightIndex: indexByLine.get(value),
          right: content(value),
          newLine: value.newLine,
          leftKind: 'empty',
          rightKind: 'add',
        }),
      );
      continue;
    }

    const context = tokens[index] ?? line.text.slice(1);
    rows.push({
      left: context,
      right: context,
      oldLine: line.oldLine,
      newLine: line.newLine,
      leftKind: 'context',
      rightKind: 'context',
    });
    index += 1;
  }

  return rows;
}

export function DiffViewer({
  oldCode = '',
  newCode = '',
  diff,
  title,
  subtitle,
  onFocus,
  splitView,
  onClose,
  loading = false,
  comparisonKey,
  repoId,
  filePath,
  imageRequest,
  error,
  partial,
}: Props) {
  const { theme, style } = useCodeTheme();
  const partialActions = usePartialDiff(repoId, filePath, diff, partial, loading || !!error);
  const lines = useMemo(() => getNumberedDiffLines(diff ?? ''), [diff]);
  const highlighted = useDiffHighlight(lines, diff?.length ?? 0, filePath);
  const gutterWidth = `${Math.max(4, String(lines.reduce((max, line) => Math.max(max, line.oldLine ?? 0, line.newLine ?? 0), 0)).length + 1)}ch`;
  const language = fileLanguage(filePath ?? title ?? '');
  const rawHighlightable =
    !diff && Boolean(language) && oldCode.length + newCode.length <= HIGHLIGHT_MAX_CHARS;
  const { module: highlighter } = useHighlighter(rawHighlightable, filePath ?? '');
  const rawTokens = useMemo(() => {
    const result = new Map<string, string>();
    if (rawHighlightable && highlighter && language) {
      try {
        for (const source of [oldCode, newCode]) {
          const highlightedLines = highlighter.highlightLinesHTML(source, language.id);
          source.split('\n').forEach((line, index) => result.set(line, highlightedLines[index]));
        }
      } catch {
        /* Keep readable plain text if tokenization fails. */
      }
    }
    return result;
  }, [rawHighlightable, highlighter, language, oldCode, newCode]);
  const imageKind = diff && repoId && filePath ? getImageDiffKind(diff, filePath) : null;
  const textDiff =
    !loading &&
    !error &&
    !imageKind &&
    Boolean(diff || oldCode || newCode) &&
    !(diff && getDiffNotice(diff));
  const preferredMode = useWorkspaceStore((state) => state.layout.diffMode);
  const [mode, setMode] = useState<'unified' | 'split'>(
    splitView === undefined ? preferredMode : splitView ? 'split' : 'unified',
  );
  useEffect(() => {
    setMode(splitView === undefined ? preferredMode : splitView ? 'split' : 'unified');
  }, [preferredMode, splitView]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    fullscreen,
    shellRef,
    toggleFullscreen,
    onFullscreenKeyDown,
    onFullscreenCancel,
    onFullscreenClose,
  } = useDiffFullscreen(bodyRef, JSON.stringify([comparisonKey, mode, title]));
  const hasDiff = Boolean(diff || oldCode || newCode);

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
  }, [comparisonKey, mode, title]);

  const renderUnifiedDiff = () => {
    return (
      <div
        className={`diff-unified-view${partialActions.enabled ? ' diff-partial-enabled' : ''}`}
        aria-label="统一差异"
      >
        {lines.map(({ text: line, kind, oldLine, newLine }, index) => {
          const className = `diff-code-row diff-code-row--${kind}${partialActions.selected.has(index) ? ' diff-row-selected' : ''}`;
          return (
            <div className={className} key={index}>
              {kind !== 'meta' && (
                <>
                  {partialActions.lineSelector(index, oldLine, newLine)}
                  <span className="diff-line-number" aria-hidden="true">
                    {oldLine}
                  </span>
                  <span className="diff-line-number" aria-hidden="true">
                    {newLine}
                  </span>
                </>
              )}
              <code>
                {kind === 'meta' ? (
                  line
                ) : (
                  <>
                    {line.slice(0, 1)}
                    {highlighted.tokens[index] ?? line.slice(1)}
                  </>
                )}
              </code>
              {kind === 'meta' && partialActions.hunkActions(index)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSplitDiff = () => (
    <div
      className={`diff-split-view${partialActions.enabled ? ' diff-partial-enabled' : ''}`}
      aria-label="分栏差异"
    >
      <div className="diff-split-labels">
        <span>原版本</span>
        <span>修改后</span>
      </div>
      {getSplitDiffRows(lines, highlighted.tokens).map((row, index) =>
        row.meta !== undefined ? (
          <div className="diff-split-row diff-split-row--meta" key={`${index}-${row.meta}`}>
            <span>{row.meta}</span>
            {partialActions.hunkActions(row.metaIndex)}
          </div>
        ) : (
          <div className="diff-split-row" key={index}>
            <span
              className={`diff-split-cell diff-split-cell--${row.leftKind}${row.leftIndex !== undefined && partialActions.selected.has(row.leftIndex) ? ' diff-row-selected' : ''}`}
            >
              {partialActions.lineSelector(row.leftIndex, row.oldLine)}
              <span className="diff-line-number" aria-hidden="true">
                {row.oldLine}
              </span>
              <code>{row.left}</code>
            </span>
            <span
              className={`diff-split-cell diff-split-cell--${row.rightKind}${row.rightIndex !== undefined && partialActions.selected.has(row.rightIndex) ? ' diff-row-selected' : ''}`}
            >
              {partialActions.lineSelector(row.rightIndex, undefined, row.newLine)}
              <span className="diff-line-number" aria-hidden="true">
                {row.newLine}
              </span>
              <code>{row.right}</code>
            </span>
          </div>
        ),
      )}
    </div>
  );

  const renderDiffContent = () => {
    if (loading) return <div className="diff-empty">正在加载差异…</div>;
    if (error)
      return (
        <FeedbackAlert
          source="diff-error"
          context={filePath}
          type="error"
          title="无法加载差异"
          description={error}
        />
      );
    if (!hasDiff)
      return (
        <div className="diff-empty">
          {diff === undefined
            ? '请选择改动文件或提交以查看差异。'
            : '当前比较没有差异，请刷新仓库状态。'}
        </div>
      );
    if (diff && imageKind && repoId && filePath)
      return (
        <ImageDiffView
          repoId={repoId}
          path={filePath}
          kind={imageKind}
          request={imageRequest || {}}
        />
      );
    const notice = diff && getDiffNotice(diff);
    if (notice) return <FeedbackAlert source="diff-limitation" context={filePath} title={notice} />;
    if (!diff)
      return (
        <ReactDiffViewer
          renderContent={
            rawHighlightable && highlighter && language
              ? (source) => {
                  try {
                    return (
                      <span
                        dangerouslySetInnerHTML={{
                          __html:
                            rawTokens.get(source) ??
                            highlighter.highlightLineHTML(source, language.id),
                        }}
                      />
                    );
                  } catch {
                    return <span>{source}</span>;
                  }
                }
              : undefined
          }
          styles={{
            contentText: {
              fontFamily: 'var(--code-font-family)',
              fontSize: 'var(--code-font-size)',
              lineHeight: '1.65',
              padding: 0,
              background: 'transparent',
            },
            gutter: { fontFamily: 'var(--code-font-family)', fontSize: 'var(--code-font-size)' },
            variables: {
              light: {
                diffViewerBackground: 'var(--code-background)',
                diffViewerColor: 'var(--code-foreground)',
                addedBackground: 'var(--code-diff-added)',
                addedColor: 'var(--code-foreground)',
                removedBackground: 'var(--code-diff-removed)',
                removedColor: 'var(--code-foreground)',
                wordAddedBackground: 'var(--code-diff-wordAdded)',
                wordRemovedBackground: 'var(--code-diff-wordRemoved)',
                addedGutterBackground: 'var(--code-diff-added)',
                removedGutterBackground: 'var(--code-diff-removed)',
                gutterBackground: 'var(--code-gutter)',
                gutterBackgroundDark: 'var(--code-gutter)',
                gutterColor: 'var(--code-lineNumber)',
                addedGutterColor: 'var(--code-foreground)',
                removedGutterColor: 'var(--code-foreground)',
                codeFoldBackground: 'var(--code-gutter)',
                codeFoldContentColor: 'var(--code-lineNumber)',
                emptyLineBackground: 'var(--code-gutter)',
                diffViewerTitleBackground: 'var(--code-gutter)',
                diffViewerTitleColor: 'var(--code-foreground)',
                diffViewerTitleBorderColor: 'var(--code-selection)',
              },
            },
          }}
          oldValue={oldCode}
          newValue={newCode}
          splitView={mode === 'split'}
          compareMethod={DiffMethod.WORDS}
          leftTitle="原始版本"
          rightTitle="修改后"
        />
      );

    return mode === 'split' ? renderSplitDiff() : renderUnifiedDiff();
  };

  return (
    <dialog
      open
      className={`diff-shell${fullscreen ? ' diff-shell--fullscreen' : ''}`}
      ref={shellRef}
      role={fullscreen ? 'dialog' : 'region'}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? `${title || '差异预览'} · 全屏查看` : title || '差异预览'}
      tabIndex={fullscreen ? -1 : undefined}
      onKeyDown={onFullscreenKeyDown}
      onCancel={onFullscreenCancel}
      onClose={onFullscreenClose}
    >
      <div className="diff-shell__header">
        <div className="diff-shell__title" title={title || '差异预览'}>
          <DiffOutlined />
          <div className="diff-shell__filename">
            <span>{title || '差异预览'}</span>
            {subtitle && <small>{subtitle}</small>}
          </div>
        </div>
        <div className="diff-toolbar">
          <span className="diff-mode">视图</span>
          <Segmented
            className="diff-view-switch"
            aria-label="Diff 视图"
            size="small"
            value={mode}
            onChange={(value) => setMode(value as 'unified' | 'split')}
            options={DIFF_MODES.map(({ value, label, icon }) => ({
              value,
              icon,
              // The visually hidden text keeps the radio's accessible name after dropping the caption.
              label: <span className="diff-view-switch__label">{label}</span>,
              tooltip: label,
            }))}
          />
          {onFocus && !fullscreen && (
            <Button
              type="text"
              size="small"
              icon={<AimOutlined />}
              aria-label="专注阅读差异"
              title="专注阅读差异 · 隐藏两侧面板"
              disabled={loading || Boolean(error) || !hasDiff}
              onClick={onFocus}
            />
          )}
          <Button
            type="text"
            size="small"
            icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
            aria-label={fullscreen ? '退出全屏查看' : '全屏查看差异'}
            title={fullscreen ? '退出全屏查看 · Esc' : '全屏查看差异 · 铺满应用窗口'}
            aria-pressed={fullscreen}
            disabled={!fullscreen && (loading || Boolean(error) || !hasDiff)}
            onClick={toggleFullscreen}
          />
          {onClose && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label="关闭差异"
              onClick={onClose}
            />
          )}
        </div>
      </div>
      {partialActions.toolbar}
      {partialActions.feedback}
      <div
        className={`diff-shell__body${textDiff ? ' code-diff' : ''}`}
        ref={bodyRef}
        style={
          textDiff ? ({ ...style, '--diff-gutter-width': gutterWidth } as CSSProperties) : undefined
        }
        data-code-theme={textDiff ? theme.id : undefined}
      >
        {renderDiffContent()}
      </div>
    </dialog>
  );
}
