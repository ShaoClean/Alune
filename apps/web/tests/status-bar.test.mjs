import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RepositoryToolbar } from '../src/components/RepositoryToolbar.tsx';
import { RepositorySwitcher, filterRepositories } from '../src/components/RepositorySwitcher.tsx';
import { toolbarTier } from '../src/hooks/useToolbarTier.ts';

const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(RepositoryToolbar, {
        repoId: 'fixture',
        status: null,
        activePanel: 'changes',
        syncing: null,
        tier: 'full',
        onSelect() {},
        onSync() {},
        onRefresh() {},
        onBranchSwitched() {},
        ...props,
      }),
    ),
  );
const renderSwitcher = (props = {}) =>
  renderToStaticMarkup(
    createElement(RepositorySwitcher, {
      repository: {
        id: 'repo-a',
        connectionId: 'dev',
        name: 'remote-git',
        path: '/workspace/remote-git',
      },
      repositories: [
        {
          id: 'repo-a',
          connectionId: 'dev',
          name: 'remote-git',
          path: '/workspace/remote-git',
        },
        {
          id: 'repo-b',
          connectionId: 'test',
          name: 'design-system',
          path: '/workspace/design-system',
        },
      ],
      connections: [
        { id: 'dev', name: '开发服务器', host: 'dev.example.com', username: 'git' },
        { id: 'test', name: '预发布服务器', host: 'test.example.com', username: 'git' },
      ],
      statuses: {
        dev: { status: 'connected' },
        test: { status: 'disconnected' },
      },
      version: 'v0.3.0',
      onSelect() {},
      onBrowse() {},
      onConnections() {},
      onSettings() {},
      ...props,
    }),
  );
const buttons = (html) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, content]) => ({
    attributes,
    label: attributes.match(/aria-label="([^"]*)"/)?.[1],
    text: content.replace(/<[^>]*>/g, ''),
  }));
const status = (overrides = {}) => ({
  branch: 'feature/long-branch',
  ahead: 2,
  behind: 3,
  files: [
    { path: 'a', staged: true },
    { path: 'a', staged: false },
    { path: 'b', staged: false },
  ],
  ...overrides,
});

test('工具条按导航 / 上下文 / 动作三段排列，改动数按路径去重', () => {
  const items = buttons(render({ status: status() }));
  assert.deepEqual(
    items.map((item) => item.label),
    [
      '改动 · 2 个文件',
      '提交历史',
      '分支',
      '更多仓库视图',
      '当前分支 feature/long-branch，切换分支',
      '查看关联 Worktrees',
      '拉取',
      '推送',
      '更多推送选项',
    ],
  );
  const pull = items.find((item) => item.label === '拉取');
  const push = items.find((item) => item.label === '推送');
  assert.equal(pull.text, '拉取3');
  assert.equal(push.text, '推送2');
});

test('落后计数随拉取按钮使用琥珀色徽标，改动数随改动标签', () => {
  const html = render({ status: status() });
  assert.match(html, /toolbar-count toolbar-count--behind[^>]*>3</);
  const changes = buttons(html).find((item) => item.label.startsWith('改动'));
  assert.equal(changes.text, '改动2');
});

test('未知状态不显示虚假的零改动，干净仓库明确显示零', () => {
  const unknown = buttons(render());
  assert.equal(unknown.find((item) => item.label.startsWith('改动')).text, '改动');
  const clean = buttons(render({ status: { branch: '', files: [], ahead: 0, behind: 0 } }));
  assert.equal(clean.find((item) => item.label.startsWith('改动')).text, '改动0');
  assert.ok(clean.some((item) => item.label === '当前分支 游离 HEAD，切换分支'));
});

test('执行同步时拉取与推送都不可用，只有对应操作标记忙碌', () => {
  for (const [operation, label] of [
    ['fetch', null],
    ['pull', '拉取'],
    ['push', '推送'],
  ]) {
    const items = buttons(render({ syncing: operation }));
    for (const item of items.filter((item) => ['拉取', '推送'].includes(item.label))) {
      assert.match(item.attributes, /aria-disabled="true"/);
      assert.match(item.attributes, new RegExp(`aria-busy="${item.label === label}"`));
    }
  }
});

test('推送执行中按钮内联显示转圈与文案，强制推送有独立文案', () => {
  const pushing = buttons(render({ syncing: 'push' })).find((item) => item.label === '推送');
  assert.equal(pushing.text, '推送中…');
  const forcing = buttons(render({ syncing: 'push', syncingForce: true })).find(
    (item) => item.label === '推送',
  );
  assert.equal(forcing.text, '强制推送中…');
});

test('推送是工具条上唯一的主色实心按钮', () => {
  const html = render({ status: status() });
  const primary = buttons(html).filter((item) =>
    item.attributes.includes('toolbar-button--primary'),
  );
  assert.deepEqual(
    primary.map((item) => item.label),
    ['推送', '更多推送选项'],
  );
  assert.equal(
    buttons(html).filter((item) => item.attributes.includes('toolbar-button--nav')).length,
    3,
  );
});

test('主视图及溢出菜单中的低频视图都有唯一选中态', () => {
  for (const [activePanel, label] of [
    ['changes', '改动'],
    ['history', '提交历史'],
    ['branches', '分支'],
    ['stashes', '更多仓库视图'],
    ['remotes', '更多仓库视图'],
  ]) {
    const selected = buttons(render({ activePanel })).filter((item) =>
      item.attributes.includes('toolbar-button--active'),
    );
    assert.equal(selected.length, 1);
    assert.equal(selected[0].label, label);
    // Selection always lives in the view segment, never on a sync action.
    assert.doesNotMatch(selected[0].attributes, /toolbar-button--(action|primary)/);
  }
});

test('分支胶囊是打开切换菜单的选择器，而不是跳转到分支视图', () => {
  const branchPill = buttons(render({ status: status() })).find((item) =>
    item.attributes.includes('branch-pill'),
  );
  assert.match(branchPill.attributes, /aria-haspopup="dialog"/);
  assert.match(branchPill.attributes, /aria-expanded="false"/);
  assert.equal(branchPill.text, 'feature/long-branch');
});

test('分支菜单锚定按钮右下方，不随右侧文件列表横移', () => {
  const source = readFileSync(new URL('../src/components/BranchPicker.tsx', import.meta.url), 'utf8');
  const popover = source.slice(source.indexOf('<Popover'), source.indexOf('content={'));
  assert.match(popover, /placement="bottomRight"/);
  assert.doesNotMatch(popover, /\balign=|\bmeasure\(/);
  assert.doesNotMatch(source, /useMenuAlign|#workspace-list/);
});

test('推送菜单锚定按钮右下方，不受当前视图的文件列表位置影响', () => {
  const source = readFileSync(new URL('../src/components/RepositoryToolbar.tsx', import.meta.url), 'utf8');
  const menuId = source.indexOf("id: 'repository-push-menu'");
  assert.ok(menuId >= 0);
  const dropdown = source.slice(source.lastIndexOf('<Dropdown', menuId), menuId);
  assert.match(dropdown, /placement="bottomRight"/);
  assert.match(dropdown, /onOpenChange=\{setPushOpen\}/);
  assert.doesNotMatch(dropdown, /\balign=|\bmeasure\(/);
  assert.doesNotMatch(source, /useMenuAlign|pushAlign/);
});

test('窄屏功能收进溢出菜单而不是隐藏，核心操作始终可触达', () => {
  const required = ['改动', '提交历史', '分支', '拉取', '推送'];
  for (const tier of ['full', 'compact', 'condensed', 'minimal']) {
    const items = buttons(render({ status: status(), tier }));
    for (const label of required)
      assert.ok(
        items.some((item) => item.label === label || item.label.startsWith(`${label} ·`)),
        `${tier} 缺少 ${label}`,
      );
    assert.ok(items.some((item) => item.label === '更多仓库视图'));
    // Worktrees leaves the toolbar below 900px, but only into the overflow menu.
    assert.equal(
      items.some((item) => item.label === '查看关联 Worktrees'),
      tier === 'full' || tier === 'compact',
    );
  }
});

test('同步动作在 900-1100px 收起文字，<700px 视图导航转为图标分段', () => {
  const compact = buttons(render({ status: status(), tier: 'compact' }));
  assert.equal(compact.find((item) => item.label === '拉取').text, '3');
  assert.equal(compact.find((item) => item.label === '推送').text, '');
  const minimal = buttons(render({ status: status(), tier: 'minimal' }));
  assert.equal(minimal.find((item) => item.label.startsWith('改动')).text, '2');
  assert.equal(minimal.find((item) => item.label === '提交历史').text, '');
});

test('四档断点按窗口宽度划分', () => {
  assert.equal(toolbarTier(1440), 'full');
  assert.equal(toolbarTier(1100), 'full');
  assert.equal(toolbarTier(1099), 'compact');
  assert.equal(toolbarTier(900), 'compact');
  assert.equal(toolbarTier(899), 'condensed');
  assert.equal(toolbarTier(700), 'condensed');
  assert.equal(toolbarTier(699), 'minimal');
});

test('统一导航入口同时展示当前连接、当前仓库和全部打开数量', () => {
  const html = renderSwitcher();
  const [trigger] = buttons(html);
  assert.equal(trigger.label, '工作区导航，开发服务器 / remote-git，共 2 个已打开仓库');
  assert.match(trigger.text, /开发服务器.*remote-git.*2/);
});

test('未选中仓库时统一入口显示品牌与实际打开数量', () => {
  const html = renderSwitcher({ repository: null });
  const [trigger] = buttons(html);
  assert.equal(trigger.label, '工作区导航，RemoteGit，共 2 个已打开仓库');
  assert.match(trigger.text, /RemoteGit.*2/);
});

test('仓库搜索覆盖名称、分支、路径、连接名和端点', () => {
  const repositories = [
    { id: 'a', connectionId: 'dev', name: 'remote-git', path: '/workspace/remote-git', currentBranch: 'main' },
    { id: 'b', connectionId: 'test', name: 'design-system', path: '/workspace/ui', currentBranch: 'feature/theme' },
  ];
  const connections = [
    { id: 'dev', name: '开发服务器', host: 'dev.example.com', username: 'git' },
    { id: 'test', name: '预发布服务器', host: 'test.example.com', username: 'deploy' },
  ];
  for (const query of ['remote', 'feature/theme', '/workspace/ui', '预发布', 'git@dev.example.com'])
    assert.equal(filterRepositories(repositories, connections, query).length, 1, query);
  assert.equal(filterRepositories(repositories, connections, '不存在').length, 0);
  assert.equal(filterRepositories(repositories, connections, '  ').length, 2);
});

test('统一导航保留工作区与应用入口，旧侧栏菜单不再参与布局', () => {
  const switcher = readFileSync(new URL('../src/components/RepositorySwitcher.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
  assert.match(switcher, /浏览全部仓库/);
  assert.match(switcher, /管理远程连接/);
  assert.match(switcher, /帮助与文档/);
  assert.match(switcher, /<span>\{version\}<\/span>/);
  assert.doesNotMatch(layout, /WorkspaceMenu|app-sidebar__footer/);
});

test('移动布局覆盖后置工具栏列定义，状态栏和仓库徽标保持可见', () => {
  const css = readFileSync(new URL('../src/workspace-layout.css', import.meta.url), 'utf8');
  const toolbar = css.indexOf('.repository-toolbar-row {');
  const mobileOverride = css.indexOf('@media (max-width: 899px)', toolbar);
  assert.ok(toolbar >= 0 && mobileOverride > toolbar);
  assert.match(
    css.slice(mobileOverride, css.indexOf('.repository-toolbar {', mobileOverride)),
    /\.repository-toolbar-row\s*\{\s*grid-column: 1;/,
  );
  const narrow = css.slice(css.indexOf('@media (max-width: 520px)'));
  assert.doesNotMatch(
    narrow.slice(0, narrow.indexOf('/* Repository toolbar')),
    /\.repository-switcher__count[\s\S]*?display: none;/,
  );
});
