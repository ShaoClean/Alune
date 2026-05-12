import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

interface Props {
  oldCode?: string;
  newCode?: string;
  diff?: string;
  title?: string;
  splitView?: boolean;
}

export function DiffViewer({ oldCode = '', newCode = '', diff, title, splitView = false }: Props) {
  if (diff) {
    return (
      <div>
        {title && <h4>{title}</h4>}
        <div style={{ background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4 }}>
          <pre style={{ padding: 12, fontSize: 13, overflow: 'auto', maxHeight: 500 }}>{diff}</pre>
        </div>
      </div>
    );
  }

  return (
    <div>
      {title && <h4>{title}</h4>}
      <ReactDiffViewer
        oldValue={oldCode}
        newValue={newCode}
        splitView={splitView}
        compareMethod={DiffMethod.WORDS}
        leftTitle="Original"
        rightTitle="Modified"
      />
    </div>
  );
}