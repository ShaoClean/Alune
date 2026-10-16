import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AluneUIProvider } from '@alune/ui';
import { DiffViewer } from '../src/components/DiffViewer';
import { FilePreviewPane } from '../src/components/FilesView';
import { CodeView } from '../src/components/CodeView';
import { FindScope } from '../src/components/FindWidget';
import { fileLanguage } from '../src/components/file-language';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/workspace-layout.css';
import '../src/files.css';
import '../src/find.css';
import '../src/theme.css';

// Isolated fixture for #234: a long Diff, a large file preview, and a Blame-like
// code view, plus unrelated inputs that must keep their own Cmd/Ctrl+F.
const context = Array.from({ length: 600 }, (_, index) => ` const line${index} = ${index};`);
const patch = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,604 +1,604 @@ needle header',
  '-const value = foo.bar(baz); // needle',
  '+const value = foo.bar(qux); // needle',
  ...context,
  '-export const useAlpha = 1; // id userId',
  '+export const useBeta = 2; // id userId',
  ` const tail = '${'x'.repeat(400)} needle';`,
].join('\n');
const refreshed = patch.replace('qux', 'needle');
const bigFile = Array.from({ length: 12000 }, (_, index) =>
  index % 1000 === 0 ? `const m${index} = 'needle';` : `const f${index} = ${index};`,
).join('\n');

function Fixture() {
  const [diff, setDiff] = useState(patch);
  const [file, setFile] = useState('big.ts');
  return (
    <AluneUIProvider>
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <input id="other-input" aria-label="其他输入框" defaultValue="needle" />
        <textarea id="terminal-input" aria-label="终端" defaultValue="needle" />
        <button id="refresh-diff" type="button" onClick={() => setDiff(refreshed)}>
          刷新 Diff
        </button>
        <button
          id="switch-file"
          type="button"
          onClick={() => setFile((value) => (value === 'big.ts' ? 'small.ts' : 'big.ts'))}
        >
          切换文件
        </button>
      </div>
      <div
        className="workspace-body"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, height: 560 }}
      >
        <section id="diff-panel" style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
          <DiffViewer
            diff={diff}
            title="src/app.ts"
            filePath="src/app.ts"
            comparisonKey="fixture"
          />
        </section>
        <section
          id="files-panel"
          className="files-view__preview"
          style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <FilePreviewPane
            entry={{ name: file, path: file, kind: 'file' }}
            file={{
              phase: 'ready',
              path: file,
              preview: {
                kind: 'text',
                content: file === 'big.ts' ? bigFile : 'const small = "needle";\n',
                size: 1,
              },
            }}
            onRetry={() => {}}
          />
        </section>
        <section
          id="blame-panel"
          style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <FindScope>
            <CodeView
              path="blame.ts"
              text={'const needle = foo.bar(needle);\nreturn needle;'}
              lines={2}
              language={fileLanguage('blame.ts')}
              annotations={<div className="blame-annotations">needle author · needle summary</div>}
            />
          </FindScope>
        </section>
      </div>
    </AluneUIProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
