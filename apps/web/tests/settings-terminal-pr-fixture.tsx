import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AluneUIProvider } from '@alune/ui';
import { SettingsNavigation, SettingsCenter, getSettingsCategory } from '../src/components/settings/SettingsCenter';
import { TerminalWorkspace } from '../src/components/TerminalWorkspace';
import { PullRequestCenterPage } from '../src/pages/PullRequestCenterPage';
import { aiApi } from '../src/api/ai';
import { pullRequestCenterApi, repositoryApi } from '../src/api';
import { useTerminalStore } from '../src/stores/terminalState';
import { useRepositoryStore } from '../src/stores/repositoryStore';
import type { Repository, TerminalSession } from '@alune/domain';
import type { PullRequestCenterPage as CenterPage, PullRequestSources } from '@alune/protocol';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';

const repo: Repository = { id: 'fixture-repo', name: '验收仓库', path: '/fixture/repo', source: 'local' };
let failSettings = false;
aiApi.settings = async () => {
  if (failSettings) throw new Error('模拟 AI 设置读取失败');
  return { revision: 'fixture', providers: [{ id: 'openai', name: 'OpenAI', enabled: true, protocol: 'openai', baseUrl: 'https://api.openai.com', models: [{ id: 'gpt', name: 'GPT', enabled: true }] }], commit: { providerId: 'openai', modelId: 'gpt', language: 'zh-CN', format: 'conventional', prompt: '' }, secretStorage: { available: true, description: 'isolated synthetic storage' } };
};
const session: TerminalSession = { id: 'terminal-1', requestId: 'request-1', repositoryId: repo.id, repositoryName: repo.name, source: 'local', environment: 'Alune fixture', initialPath: repo.path, state: 'failed', error: '模拟终端启动失败', createdAt: Date.now() };
useRepositoryStore.setState({ currentRepo: repo, repositories: [repo] });
useTerminalStore.setState({ sessions: [session], selected: { [repo.id]: session.id }, visible: true, connected: true });
const source = { id: 'source-1', repositoryId: repo.id, repositoryName: repo.name, location: repo.path, remote: { name: 'origin', webUrl: 'https://github.com/example/repo', provider: 'github', selection: null }, provider: 'github', projectKey: 'example/repo', account: null, status: 'ready' };
const sources: PullRequestSources = { discoveryId: 'fixture', sources: [source], repositoryCount: 1, discoveredCount: 1, complete: true, cursor: null };
pullRequestCenterApi.sources = async () => sources;
pullRequestCenterApi.context = async () => ({ account: null });
pullRequestCenterApi.list = async (): Promise<CenterPage> => ({ items: [{ key: 'pr-1', sourceId: source.id, sourceIds: [source.id], projectKey: 'example/repo', project: 'example/repo', host: 'github.com', number: 1, title: 'Fixture PR', url: 'https://github.com/example/repo/pull/1', state: 'open', draft: false, author: 'fixture', sourceBranch: 'feature', targetBranch: 'main', updatedAt: new Date().toISOString() }], sources: [source], nextCursor: null, scanning: false, completedSources: 1, totalSources: 1, updatedAt: new Date().toISOString() });
repositoryApi.pullRequestRemotes = async () => [source.remote];

function SettingsAndTerminal() {
  const [category, setCategory] = useState('providers');
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <section><button id="fail-settings" onClick={() => { failSettings = true; }}>下次设置读取失败</button><button id="reload-settings" onClick={() => { void import('../src/stores/aiSettingsStore').then(({ useAiSettingsStore }) => useAiSettingsStore.getState().load()); }}>重新读取设置</button><SettingsNavigation category={getSettingsCategory(`/settings/${category}`)} onSelect={setCategory} /><SettingsCenter category={getSettingsCategory(`/settings/${category}`)} returnTo="/settings" onSelect={setCategory} updates={{ state: null, bridgeError: null, invoke: async () => {}, isDesktop: false } as any} /><div ref={setSlot} /><TerminalWorkspace slot={slot} repository={repo} switching={false} /></section>;
}
function Fixture() { return <main><SettingsAndTerminal /><section aria-label="PR 中心"><PullRequestCenterPage /></section></main>; }
createRoot(document.getElementById('root')!).render(<AluneUIProvider theme="light" reduceMotion><MemoryRouter initialEntries={['/pull-requests']}><Fixture /></MemoryRouter></AluneUIProvider>);
