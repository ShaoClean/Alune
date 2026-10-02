import { useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AluneUIProvider } from '@alune/ui';
import { FeedbackContext } from '../src/components/feedback-context';
import { ChangesView } from '../src/components/ChangesView';
import { gitApi, repositoryApi } from '../src/api';
import { aiApi } from '../src/api/ai';
import { useRepositoryStore } from '../src/stores/repositoryStore';
import type { FileStatus, Repository, RepositoryStatus } from '@alune/shared';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';

const source = new URLSearchParams(location.search).get('source') === 'ssh' ? 'ssh' : 'local';
const repo: Repository = {
  id: 'quiet-fixture',
  name: '静默反馈验收',
  path: '/fixture',
  source,
  connectionId: 'ssh',
};
let files: FileStatus[] = Array.from({ length: 30 }, (_, i) => ({
  path: `file-${String(i).padStart(2, '0')}.txt`,
  status: 'modified',
  staged: false,
}));
let failNext = false;
let writes = 0;
let reads = 0;
let published = 0;
const status = (): RepositoryStatus => ({ branch: 'main', ahead: 0, behind: 0, files });
// Only transport is replaced; the real component and repository refresh store run unchanged.
repositoryApi.status = async () => {
  reads++;
  return status();
};
for (const action of ['stage', 'unstage'] as const) {
  gitApi[action] = async (_id, paths) => {
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (failNext) {
      failNext = false;
      throw new Error('模拟 Git 写入失败');
    }
    files = files.map((file) =>
      paths.includes(file.path) ? { ...file, staged: action === 'stage' } : file,
    );
    return { success: true };
  };
}
aiApi.settings = async () => {
  throw new Error('验收不调用 AI 服务');
};
useRepositoryStore.getState().resetWorkspace(repo.id);
useRepositoryStore.setState({
  currentRepo: repo,
  repositories: [repo],
  status: status(),
  repositoryStatuses: { [repo.id]: { phase: 'success', data: status(), updatedAt: Date.now() } },
});
function Fixture() {
  const store = useContext(FeedbackContext)!;
  const [selected, setSelected] = useState<FileStatus | null>(null);
  const revision = useRepositoryStore((s) => s.worktreeDiffRevision);
  useEffect(() => {
    const original = store.getState().publish;
    store.setState({
      publish: (event) => {
        published++;
        return original(event);
      },
    });
    (window as any).quietProbe = () => ({
      writes,
      reads,
      published,
      entries: store.getState().entries,
      files: useRepositoryStore.getState().status?.files,
      revision: useRepositoryStore.getState().worktreeDiffRevision,
    });
    return () => {
      store.setState({ publish: original });
    };
  }, [store]);
  return (
    <main style={{ width: 600, height: 750, margin: '0 auto' }}>
      <style>{`.changes-panel { height: 700px; display: flex; flex-direction: column; } .changes-content { min-height: 0; flex: 1; overflow: auto; } .commit-box { flex-shrink: 0; }`}</style>
      <button
        id="fail-next"
        onClick={() => {
          failNext = true;
        }}
      >
        下次写入失败
      </button>
      <output id="revision">{revision}</output>
      <ChangesView
        repoId={repo.id}
        onRefresh={() => useRepositoryStore.getState().fetchStatus(repo.id, true)}
        selectedFile={selected}
        onSelectFile={setSelected}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <AluneUIProvider theme="light" reduceMotion>
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>
  </AluneUIProvider>,
);
