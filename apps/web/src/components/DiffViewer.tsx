import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Segmented } from 'antd';
import { CloseOutlined, DiffOutlined, ExpandOutlined } from '@ant-design/icons';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { getNumberedDiffLines, getDiffNotice, getImageDiffKind } from './diff-lines';
import type { NumberedDiffLine } from './diff-lines';
import { ImageDiffView } from './ImageDiffView';
import type { DiffImageOptions } from '@remote-git/shared';
import { useWorkspaceStore } from '../stores/workspaceStore';

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
}

type SplitCellKind = 'context' | 'add' | 'remove' | 'empty';

interface SplitDiffRow {
  meta?: string;
  left?: string;
  right?: string;
  leftKind?: SplitCellKind;
  rightKind?: SplitCellKind;
  oldLine?: number;
  newLine?: number;
}

function getSplitDiffRows(diff: string): SplitDiffRow[] {
  const lines = getNumberedDiffLines(diff);
  const rows: SplitDiffRow[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (line.kind === 'meta') {
      rows.push({ meta: line.text });
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
          left: removed[row]?.text.slice(1) || '',
          right: added[row]?.text.slice(1) || '',
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
          right: value.text.slice(1),
          newLine: value.newLine,
          leftKind: 'empty',
          rightKind: 'add',
        }),
      );
      continue;
    }

    const context = line.text.slice(1);
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
}: Props) {
  const preferredMode = useWorkspaceStore((state) => state.layout.diffMode);
  const [mode, setMode] = useState<'unified' | 'split'>(
    splitView === undefined ? preferredMode : splitView ? 'split' : 'unified',
  );
  useEffect(() => {
    setMode(splitView === undefined ? preferredMode : splitView ? 'split' : 'unified');
  }, [preferredMode, splitView]);
  const [zoomed, setZoomed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const zoomBodyRef = useRef<HTMLDivElement>(null);
  const hasDiff = Boolean(diff || oldCode || newCode);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
    zoomBodyRef.current?.scrollTo({ top: 0, left: 0 });
  }, [comparisonKey, mode, title, zoomed]);

  const renderUnifiedDiff = (value: string) => {
    const lines = getNumberedDiffLines(value);
    return (
      <div className="diff-unified-view" aria-label="统一差异">
        {lines.map(({ text: line, kind, oldLine, newLine }, index) => {
          const className = `diff-code-row diff-code-row--${kind}`;
          return (
            <div className={className} key={index}>
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
              <code>{line}</code>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSplitDiff = (value: string) => (
    <div className="diff-split-view" aria-label="分栏差异">
      <div className="diff-split-labels">
        <span>原版本</span>
        <span>修改后</span>
      </div>
      {getSplitDiffRows(value).map((row, index) =>
        row.meta !== undefined ? (
          <div className="diff-split-row diff-split-row--meta" key={`${index}-${row.meta}`}>
            <span>{row.meta}</span>
          </div>
        ) : (
          <div className="diff-split-row" key={`${index}-${row.left}-${row.right}`}>
            <span className={`diff-split-cell diff-split-cell--${row.leftKind}`}>
              <span className="diff-line-number" aria-hidden="true">
                {row.oldLine}
              </span>
              <code>{row.left}</code>
            </span>
            <span className={`diff-split-cell diff-split-cell--${row.rightKind}`}>
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
        <div className="diff-error">
          <strong>无法加载差异</strong>
          <span>{error}</span>
        </div>
      );
    if (!hasDiff)
      return (
        <div className="diff-empty">
          {diff === undefined
            ? '请选择改动文件或提交以查看差异。'
            : '当前比较没有差异，请刷新仓库状态。'}
        </div>
      );
    const imageKind =
      diff && repoId && filePath ? getImageDiffKind(diff, filePath) : null;
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
    if (notice) return <div className="diff-empty">{notice}</div>;
    if (!diff)
      return (
        <ReactDiffViewer
          oldValue={oldCode}
          newValue={newCode}
          splitView={mode === 'split'}
          compareMethod={DiffMethod.WORDS}
          leftTitle="原始版本"
          rightTitle="修改后"
        />
      );

    return mode === 'split' ? renderSplitDiff(diff) : renderUnifiedDiff(diff);
  };

  return (
    <>
      <div className="diff-shell">
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
              size="small"
              value={mode}
              onChange={(value) => setMode(value as 'unified' | 'split')}
              options={[
                { label: '统一', value: 'unified' },
                { label: '分栏', value: 'split' },
              ]}
            />
            <Button
              type="text"
              size="small"
              icon={<ExpandOutlined />}
              aria-label={onFocus ? '专注阅读差异' : '放大查看差异'}
              title={onFocus ? '专注阅读差异 · 隐藏两侧面板' : '放大查看差异'}
              disabled={loading || Boolean(error) || !hasDiff}
              onClick={() => (onFocus ? onFocus() : setZoomed(true))}
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
        <div className="diff-shell__body" ref={bodyRef}>
          {renderDiffContent()}
        </div>
      </div>
      {zoomed && (
        <Modal
          className="diff-zoom-modal"
          open
          onCancel={() => setZoomed(false)}
          footer={null}
          title={title || '差异预览'}
          width="calc(100vw - 48px)"
        >
          <div className="diff-zoom-modal__body" ref={zoomBodyRef}>
            {renderDiffContent()}
          </div>
        </Modal>
      )}
    </>
  );
}
