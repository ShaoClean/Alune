import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AluneUIProvider } from '@alune/ui';
import { FilesView } from '../src/components/FilesView';
import { ChangesView } from '../src/components/ChangesView';
import { DiffViewer } from '../src/components/DiffViewer';
import { RepositoryToolbar } from '../src/components/RepositoryToolbar';
import { gitApi, repositoryApi } from '../src/api';
import { hydrateWorkspace } from '../src/stores/workspaceStore';
import { useRepositoryStore } from '../src/stores/repositoryStore';
import type { FileStatus, Repository, RepositoryStatus } from '@alune/domain';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/workspace-layout.css';
import '../src/files.css';
import '../src/theme.css';
import '../src/dialogs.css';

const repo: Repository = { id: 'fixture-repo', name: '验收仓库', path: '/fixture/repo', source: 'local' };
let failNext = false;
let files: FileStatus[] = [
  { path: 'src/App.tsx', status: 'modified', staged: false },
  { path: 'README.md', status: 'added', staged: false },
];
const status = (): RepositoryStatus => ({ branch: 'feature/fixture', ahead: 1, behind: 0, files });
repositoryApi.status = async () => status();
repositoryApi.tree = async (_id, path = '') => ({
  path,
  entries: path === ''
    ? [{ name: 'src', path: 'src', kind: 'directory' }]
    : [{ name: 'App.tsx', path: 'src/App.tsx', kind: 'file' }],
  total: 1,
  truncated: false,
});
repositoryApi.file = async (_id, path) => ({ path, kind: 'text', encoding: 'utf-8', size: 7, content: 'fixture' });
repositoryApi.submodules = async () => [];
repositoryApi.lfs = async () => ({ used: false, installed: false });
gitApi.stage = async (_id, paths) => {
  if (failNext) { failNext = false; throw new Error('模拟暂存失败'); }
  files = files.map((file) => paths.includes(file.path) ? { ...file, staged: true } : file);
  return { success: true };
};
gitApi.unstage = async (_id, paths) => {
  files = files.map((file) => paths.includes(file.path) ? { ...file, staged: false } : file);
  return { success: true };
};
await hydrateWorkspace();
useRepositoryStore.getState().activateWorkspace(repo.id);
useRepositoryStore.setState({ currentRepo: repo, repositories: [repo], repositoryStatuses: { [repo.id]: { phase: 'success', data: status(), updatedAt: Date.now() } } });

function Fixture() {
  const [panel, setPanel] = useState<'changes' | 'files'>('changes');
  const [selected, setSelected] = useState<FileStatus | null>(null);
  return <main style={{ maxWidth: 920, margin: '0 auto' }}>
    <button id="fail-stage" onClick={() => { failNext = true; }}>下次暂存失败</button>
    <RepositoryToolbar repoId={repo.id} status={status()} activePanel={panel} syncing={null} tier="full"
      onSelect={(next) => setPanel(next === 'changes' ? 'changes' : 'files')}
      onSync={() => {}} onRefresh={() => { void useRepositoryStore.getState().fetchStatus(repo.id, true); }} onBranchSwitched={() => {}} />
    {panel === 'changes' ? <ChangesView repoId={repo.id} onRefresh={async () => { await useRepositoryStore.getState().fetchStatus(repo.id, true); }} selectedFile={selected} onSelectFile={setSelected} /> : <section className="workspace-main-panel" aria-label="文件面板" style={{ height: 360 }}><FilesView repoId={repo.id} /></section>}
    <section aria-label="差异预览"><DiffViewer title="src/App.tsx" filePath="src/App.tsx" repoId={repo.id} diff={'@@ -1 +1 @@\n-old\n+new\n'} splitView={false} /></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<AluneUIProvider theme="light" reduceMotion><MemoryRouter><Fixture /></MemoryRouter></AluneUIProvider>);
