import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Segmented } from 'antd';
import { CloseOutlined, DiffOutlined, ExpandOutlined } from '@ant-design/icons';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

interface Props {
  oldCode?: string;
  newCode?: string;
  diff?: string;
  title?: string;
  splitView?: boolean;
  onClose?: () => void;
  loading?: boolean;
  error?: string | null;
}

type SplitCellKind = 'context' | 'add' | 'remove' | 'empty';

interface SplitDiffRow {
  meta?: string;
  left?: string;
  right?: string;
  leftKind?: SplitCellKind;
  rightKind?: SplitCellKind;
}

const isFileHeader = (line: string) => line.startsWith('--- ') || line.startsWith('+++ ');

const isMetaLine = (line: string) =>
  line.startsWith('diff ') ||
  line.startsWith('index ') ||
  line.startsWith('@@') ||
  isFileHeader(line) ||
  line.startsWith('old mode ') ||
  line.startsWith('new mode ') ||
  line.startsWith('new file mode ') ||
  line.startsWith('deleted file mode ') ||
  line.startsWith('similarity index ') ||
  line.startsWith('rename from ') ||
  line.startsWith('rename to ') ||
  line.startsWith('copy from ') ||
  line.startsWith('copy to ') ||
  line.startsWith('Binary files ') ||
  line.startsWith('\\ No newline');

const isRemovedLine = (line: string) => line.startsWith('-') && !isFileHeader(line);
const isAddedLine = (line: string) => line.startsWith('+') && !isFileHeader(line);

function getSplitDiffRows(diff: string): SplitDiffRow[] {
  const lines = diff.split('\n');
  const rows: SplitDiffRow[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    if (isMetaLine(line)) {
      rows.push({ meta: line });
      index += 1;
      continue;
    }

    if (isRemovedLine(line)) {
      const removed: string[] = [];
      while (index < lines.length && isRemovedLine(lines[index])) {
        removed.push(lines[index].slice(1));
        index += 1;
      }
      const added: string[] = [];
      while (index < lines.length && isAddedLine(lines[index])) {
        added.push(lines[index].slice(1));
        index += 1;
      }
      const rowCount = Math.max(removed.length, added.length);
      for (let row = 0; row < rowCount; row += 1) {
        rows.push({
          left: removed[row] || '',
          right: added[row] || '',
          leftKind: removed[row] === undefined ? 'empty' : 'remove',
          rightKind: added[row] === undefined ? 'empty' : 'add',
        });
      }
      continue;
    }

    if (isAddedLine(line)) {
      const added: string[] = [];
      while (index < lines.length && isAddedLine(lines[index])) {
        added.push(lines[index].slice(1));
        index += 1;
      }
      added.forEach((value) =>
        rows.push({ left: '', right: value, leftKind: 'empty', rightKind: 'add' }),
      );
      continue;
    }

    const context = line.startsWith(' ') ? line.slice(1) : line;
    rows.push({ left: context, right: context, leftKind: 'context', rightKind: 'context' });
    index += 1;
  }

  return rows;
}

export function DiffViewer({
  oldCode = '',
  newCode = '',
  diff,
  title,
  splitView = false,
  onClose,
  loading = false,
  error,
}: Props) {
  const [mode, setMode] = useState<'unified' | 'split'>(splitView ? 'split' : 'unified');
  const [zoomed, setZoomed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const zoomBodyRef = useRef<HTMLDivElement>(null);
  const hasDiff = Boolean(diff || oldCode || newCode);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
    zoomBodyRef.current?.scrollTo({ top: 0, left: 0 });
  }, [diff, error, loading, mode, title, zoomed]);

  const renderUnifiedDiff = (value: string) => {
    const lines = value.split('\n');
    return (
      <pre>
        {lines.map((line, index) => {
          const className =
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-line--add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-line--remove'
                : line.startsWith('@@') || line.startsWith('diff ')
                  ? 'diff-line--meta'
                  : undefined;
          return (
            <span className={className} key={`${index}-${line}`}>
              {line}
              {index < lines.length - 1 ? '\n' : ''}
            </span>
          );
        })}
      </pre>
    );
  };

  const renderSplitDiff = (value: string) => (
    <div className="diff-split-view" aria-label="分栏差异">
      {getSplitDiffRows(value).map((row, index) =>
        row.meta !== undefined ? (
          <div className="diff-split-row diff-split-row--meta" key={`${index}-${row.meta}`}>
            <span>{row.meta}</span>
          </div>
        ) : (
          <div className="diff-split-row" key={`${index}-${row.left}-${row.right}`}>
            <span className={`diff-split-cell diff-split-cell--${row.leftKind}`}>{row.left}</span>
            <span className={`diff-split-cell diff-split-cell--${row.rightKind}`}>{row.right}</span>
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
    if (!hasDiff) return <div className="diff-empty">请选择改动文件或提交以查看差异。</div>;
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
            <span>{title || '差异预览'}</span>
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
              aria-label="放大查看差异"
              title="放大查看差异"
              disabled={loading || Boolean(error) || !hasDiff}
              onClick={() => setZoomed(true)}
            >
              放大
            </Button>
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
