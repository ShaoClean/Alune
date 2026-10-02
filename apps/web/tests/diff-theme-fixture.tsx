import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AluneUIProvider } from '@alune/ui';
import { CodeView } from '../src/components/CodeView';
import { DiffViewer } from '../src/components/DiffViewer';
import { PullRequestPatch } from '../src/components/PullRequestDetails';
import { CodeAppearanceSettings } from '../src/components/settings/CodeAppearanceSettings';
import { fileLanguage } from '../src/components/file-language';
import { initializeAppearance, useAppearance } from '../src/appearance';
import { hydrateWorkspace, useWorkspaceStore } from '../src/stores/workspaceStore';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/workspace-layout.css';
import '../src/files.css';
import '../src/pull-requests.css';
import '../src/settings.css';
import '../src/theme.css';

const oldCode =
  '// Alune\nexport function greet(name: string) {\n  /* A multiline\n     comment */\n  const count = 12;\n  return "Hello " + name;\n}\n';
const newCode = oldCode.replace('12', '42').replace('"Hello "', '"Welcome "');
const patch =
  'diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1,7 +1,7 @@\n // Alune\n export function greet(name: string) {\n   /* A multiline\n      comment */\n-  const count = 12;\n-  return "Hello " + name;\n+  const count = 42;\n+  return "Welcome " + name;\n }\n';
function Fixture() {
  const mode = useAppearance((state) => state.theme);
  const [source, setSource] = useState('patch');
  const [settings, setSettings] = useState(false);
  const [selection, setSelection] = useState<any>();
  return (
    <AluneUIProvider theme={mode}>
      <main style={{ padding: 20 }}>
        <header style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 20 }}>Alune · Diff 代码主题</h1>
          <button
            onClick={() =>
              useWorkspaceStore
                .getState()
                .updateAppearance({ theme: mode === 'light' ? 'dark' : 'light' })
            }
          >
            切换浅色／深色
          </button>
          <button onClick={() => setSettings(!settings)}>代码外观设置</button>
          <select aria-label="Diff 来源" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="patch">Git Patch</option>
            <option value="raw">完整文本对比</option>
            <option value="review">PR/MR 评论</option>
          </select>
        </header>
        {settings && <CodeAppearanceSettings />}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)',
            gap: 16,
            height: 520,
          }}
        >
          <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <h2 style={{ fontSize: 14 }}>文件预览</h2>
            <CodeView
              path="example.ts"
              text={newCode}
              lines={7}
              language={fileLanguage('example.ts')}
            />
          </section>
          <section style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 14 }}>文本 Diff</h2>
            {source === 'review' ? (
              <PullRequestPatch
                patch={patch}
                selection={selection}
                onSelect={(side, line, extend) =>
                  setSelection({
                    side,
                    startLine: extend ? (selection?.startLine ?? line) : line,
                    endLine: line,
                  })
                }
              />
            ) : (
              <DiffViewer
                title="example.ts"
                filePath="example.ts"
                {...(source === 'raw' ? { oldCode, newCode } : { diff: patch })}
              />
            )}
          </section>
        </div>
      </main>
    </AluneUIProvider>
  );
}
await hydrateWorkspace();
initializeAppearance();
createRoot(document.getElementById('root')!).render(<Fixture />);
