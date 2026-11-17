import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AluneUIProvider } from '@alune/ui';
import { LayoutSettings } from '../src/components/LayoutSettings';
import { useWorkspaceStore } from '../src/stores/workspaceStore';
import { useDiffChangeNavigation } from '../src/components/useDiffChangeNavigation';
import { useDiffFullscreen } from '../src/components/useDiffFullscreen';
import { MarkdownPreview } from '../src/components/MarkdownPreview';
import { useWorkspaceFileMenu } from '../src/components/WorkspaceFileMenu';
import { useDiffHighlight } from '../src/components/useDiffHighlight';
import { HIGHLIGHT_MAX_CHARS } from '../src/components/useHighlighter';
import { useRepositoryStore } from '../src/stores/repositoryStore';
import '@alune/ui/styles.css';
import '../src/index.css';
import '../src/theme.css';
import '../src/dialogs.css';

// Enables acceptance counters only. Every backend and resource is synthetic;
// this fixture does not install a real Agent or claim integration acceptance.
window.aluneAgent = {} as any;
const scrollListeners = new Set<EventListenerOrEventListenerObject>();
const nativeAdd = HTMLElement.prototype.addEventListener, nativeRemove = HTMLElement.prototype.removeEventListener;
(HTMLElement.prototype as any).addEventListener = function(type: string, listener: EventListenerOrEventListenerObject, options: any) {
  if (this.id === 'diff-body' && type === 'scroll') scrollListeners.add(listener);
  return nativeAdd.call(this, type, listener, options);
};
(HTMLElement.prototype as any).removeEventListener = function(type: string, listener: EventListenerOrEventListenerObject, options: any) {
  if (this.id === 'diff-body' && type === 'scroll') scrollListeners.delete(listener);
  return nativeRemove.call(this, type, listener, options);
};
(window as any).__p0ScrollListenerCount = () => scrollListeners.size;
useRepositoryStore.setState({ repositories: [{ id: 'p0-fixture', name: 'Fixture', path: '/synthetic', source: 'local' } as any] });
const segments = [[1], [2], [3]];
function Fixture() {
  const [open, setOpen] = useState(false), [mounted, setMounted] = useState(true);
  const layout = useWorkspaceStore(s => s.layout);
  return <main style={{ padding: 24 }}>
    <h1>P0 布局与导航隔离验收</h1>
    <button id="open-layout" onClick={() => setOpen(true)}>布局弹窗</button>
    <LayoutSettings open={open} onClose={() => setOpen(false)} />
    <pre id="layout-state">{JSON.stringify(layout)}</pre>
    <button id="toggle-navigation" onClick={() => setMounted(v => !v)}>挂载/卸载导航</button>
    {mounted && <Navigation />}
    <Fullscreen />
    <MarkdownPreview content={'![broken external](http://127.0.0.1:5188/tests/does-not-exist.png)'} path="README.md" />
    <FileMenu />
    <Highlight />
  </main>;
}
function Fullscreen() {
  const body = useRef<HTMLDivElement>(null), state = useDiffFullscreen(body, 'fixture');
  return <dialog id="fullscreen-shell" ref={state.shellRef} onKeyDown={state.onFullscreenKeyDown} onCancel={state.onFullscreenCancel} onClose={state.onFullscreenClose}>
    <button id="fullscreen-toggle" aria-label={state.fullscreen ? '退出全屏查看' : '全屏查看'} onClick={state.toggleFullscreen}>全屏</button>
    <div id="fullscreen-body" ref={body} style={{ height: 80, width: 300, overflow: 'auto' }}><div style={{ height: 800 }}>保留滚动位置</div></div>
    <output id="fullscreen-state">{String(state.fullscreen)}</output>
  </dialog>;
}
function FileMenu() {
  const menu = useWorkspaceFileMenu('p0-fixture', () => {}, false, () => {});
  return <section><button id="file-menu-target" {...menu.bindings('literal.txt', false, true)}>文件上下文菜单</button>{menu.element}</section>;
}
const highlightLines = [{ kind: 'add' as const, text: '+const answer = 42;' }];
function Highlight() {
  const [size, setSize] = useState(0);
  const result = useDiffHighlight(highlightLines, [30, HIGHLIGHT_MAX_CHARS, HIGHLIGHT_MAX_CHARS + 1][size], 'example.ts');
  return <section><button id="toggle-highlight-size" onClick={() => setSize(v => (v + 1) % 3)}>切换高亮长度边界</button><pre id="highlight-state">{JSON.stringify({ tokens: result.tokens.length, failed: result.failed, tooLarge: result.tooLarge, limit: HIGHLIGHT_MAX_CHARS })}</pre><pre id="highlight-tokens">{result.tokens.map((row, index) => <div key={index}>{row}</div>)}</pre></section>;
}
function Navigation() {
  const body = useRef<HTMLDivElement>(null);
  const nav = useDiffChangeNavigation(body, segments, true);
  return <section>
    <button id="previous" onClick={nav.prev}>上一处</button><button id="next" onClick={nav.next}>下一处</button>
    <output id="navigation-state">{JSON.stringify({ total: nav.total, index: nav.index, notice: nav.notice })}</output>
    <div id="diff-body" ref={body} onKeyDown={nav.onKeyDown} tabIndex={0} style={{ height: 150, overflow: 'auto', border: '1px solid #999' }}>
      <input aria-label="导航内输入框" />
      {Array.from({ length: 30 }, (_, i) => <div key={i} data-change={i === 1 ? 0 : i === 10 ? 1 : i === 20 ? 2 : undefined} style={{ height: 30 }}>{i} literal 中文</div>)}
    </div>
  </section>;
}
createRoot(document.getElementById('root')!).render(<AluneUIProvider theme="light" reduceMotion><Fixture /></AluneUIProvider>);
