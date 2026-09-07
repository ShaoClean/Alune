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
    if (!diff) return <div className="diff-empty">此文件没有可显示的文本差异。</div>;
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
        <div className="diff-shell__title"><DiffOutlined /><span>{title || '差异预览'}</span></div>
        <div className="diff-toolbar">
          <span className="diff-mode">视图</span>
          <Segmented size="small" value={mode} onChange={(value) => setMode(value as 'unified' | 'split')} options={[{ label: '统一', value: 'unified' }, { label: '分栏', value: 'split' }]} />
          {onClose && <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭差异" onClick={onClose} />}
        </div>
      </div>
      <div className="diff-shell__body">
        {loading ? <div className="diff-empty">正在加载差异…</div> : error ? <div className="diff-error"><strong>无法加载差异</strong><span>{error}</span></div> : !hasDiff ? <div className="diff-empty">请选择改动文件或提交以查看差异。</div> : diff ? renderRawDiff() : <ReactDiffViewer oldValue={oldCode} newValue={newCode} splitView={mode === 'split'} compareMethod={DiffMethod.WORDS} leftTitle="原始版本" rightTitle="修改后" />}
      </div>
    </div>
  );
}
