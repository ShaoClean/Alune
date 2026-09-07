import { useState } from 'react';
import { Button, Segmented } from 'antd';
import { CloseOutlined, DiffOutlined } from '@ant-design/icons';
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

export function DiffViewer({ oldCode = '', newCode = '', diff, title, splitView = false, onClose, loading = false, error }: Props) {
  const [mode, setMode] = useState<'unified' | 'split'>(splitView ? 'split' : 'unified');
  const hasDiff = Boolean(diff || oldCode || newCode);

  const renderRawDiff = () => {
    if (!diff) return <div className="diff-empty">This file has no textual diff to display.</div>;
    return (
      <pre>{diff.split('\n').map((line, index) => {
        const className = line.startsWith('+') && !line.startsWith('+++') ? 'diff-line--add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-line--remove' : line.startsWith('@@') || line.startsWith('diff ') ? 'diff-line--meta' : undefined;
        return <span className={className} key={`${index}-${line}`}>{line}{index < diff.split('\n').length - 1 ? '\n' : ''}</span>;
      })}</pre>
    );
  };

  return (
    <div className="diff-shell">
      <div className="diff-shell__header">
        <div className="diff-shell__title"><DiffOutlined /><span>{title || 'Diff preview'}</span></div>
        <div className="diff-toolbar">
          <span className="diff-mode">View</span>
          <Segmented size="small" value={mode} onChange={(value) => setMode(value as 'unified' | 'split')} options={[{ label: 'Unified', value: 'unified' }, { label: 'Split', value: 'split' }]} />
          {onClose && <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Close diff" onClick={onClose} />}
        </div>
      </div>
      <div className="diff-shell__body">
        {loading ? <div className="diff-empty">Loading diff…</div> : error ? <div className="diff-error"><strong>Unable to load diff</strong><span>{error}</span></div> : !hasDiff ? <div className="diff-empty">Select a changed file or commit to inspect its diff.</div> : diff ? renderRawDiff() : <ReactDiffViewer oldValue={oldCode} newValue={newCode} splitView={mode === 'split'} compareMethod={DiffMethod.WORDS} leftTitle="Original" rightTitle="Modified" />}
      </div>
    </div>
  );
}
