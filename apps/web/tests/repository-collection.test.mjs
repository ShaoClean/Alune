import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RepositoriesPage } from '../src/pages/RepositoriesPage.tsx';
import { useConnectionStore } from '../src/stores/connectionStore.ts';
import { useRepositoryStore } from '../src/stores/repositoryStore.ts';
import { useWorkspaceStore } from '../src/stores/workspaceStore.ts';

const local = { id: 'local', name: 'local-project', source: 'local', path: '/local/project' };
const remote = {
  id: 'remote',
  name: 'remote-project',
  connectionId: 'host',
  path: '/remote/project',
};

// React server rendering reads Zustand's initial snapshot rather than its live state.
function initialState(t, store, patch) {
  const snapshot = store.getInitialState();
  const previous = { ...snapshot };
  Object.assign(snapshot, patch);
  t.after(() => Object.assign(snapshot, previous));
}

for (const view of ['grid', 'list']) {
  test(`${view} view preserves local and SSH sources, filtering and repository actions`, (t) => {
    const previousWindow = globalThis.window;
    globalThis.window = {};
    t.after(() => {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    });
    initialState(t, useConnectionStore, { connections: [{ id: 'host', name: '开发服务器' }] });
    initialState(t, useRepositoryStore, {
      repositories: [local, remote],
      listLoaded: true,
      listLoading: false,
      listError: null,
    });
    initialState(t, useWorkspaceStore, {
      collectionViews: { repositories: view, connections: 'grid' },
    });
    const render = (query = '') =>
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: [`/repositories${query}`] },
          createElement(RepositoriesPage),
        ),
      );
    const html = render();
    assert.match(html, /打开本地仓库/);
    assert.match(html, /local-project/);
    assert.match(html, /remote-project/);
    assert.match(html, />本机</);
    assert.match(html, view === 'list' ? />SSH · 开发服务器</ : />SSH</);
    assert.equal((html.match(/>打开工作区</g) || []).length, 2);
    assert.match(html, /aria-label="刷新 local-project 状态"/);
    assert.match(html, /aria-label="删除 local-project"/);
    const localOnly = render('?connectionId=%40local');
    assert.match(localOnly, /local-project/);
    assert.doesNotMatch(localOnly, /remote-project|未知连接/);
    const remoteOnly = render('?connectionId=host');
    assert.match(remoteOnly, /remote-project/);
    assert.doesNotMatch(remoteOnly, /local-project/);
  });
}
