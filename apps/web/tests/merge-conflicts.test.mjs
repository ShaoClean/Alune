import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AluneConfirmProvider } from '../src/components/AluneModal.tsx';
import { ChangesView } from '../src/components/ChangesView.tsx';
import { ConflictOperationBar } from '../src/components/ConflictOperationBar.tsx';
import {
  contextExcerpt,
  hasConflictBlocks,
  operationProgress,
  operationTitle,
  sideNames,
  wholeFileActions,
} from '../src/components/conflict-model.ts';
import { useRepositoryStore } from '../src/stores/repositoryStore.ts';

const wrap = (element) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(AluneConfirmProvider, null, element)),
  );

const bar = (props) =>
  wrap(
    createElement(ConflictOperationBar, {
      repoId: 'conflicts',
      onChanged: async () => {},
      ...props,
    }),
  );

function changes(files, operation, managedRebase = false) {
  const status = { branch: 'main', ahead: 0, behind: 0, files, operation };
  Object.assign(useRepositoryStore.getInitialState(), {
    status,
    repositoryStatuses: {
      conflicts: { phase: 'success', data: status, updatedAt: Date.now() },
    },
  });
  return wrap(
    createElement(ChangesView, { repoId: 'conflicts', onRefresh: async () => {}, managedRebase }),
  );
}

const rebase = {
  kind: 'rebase',
  branch: 'feature/中文',
  onto: '0123456789abcdef',
  commit: 'fedcba9876543210',
  subject: '修改 说明.md',
  step: 2,
  total: 5,
};

test('操作标题、进度与双方含义按操作类型区分', () => {
  assert.equal(operationTitle(rebase), '正在变基 feature/中文');
  assert.equal(operationProgress(rebase), '2/5');
  assert.deepEqual(sideNames(rebase), {
    current: '变基目标 0123456',
    incoming: '正在重放 fedcba9',
  });
  assert.equal(operationTitle({ kind: 'merge', branch: 'topic' }), '正在合并 topic');
  assert.equal(operationTitle({ kind: 'cherry-pick', commit: 'abcdef123456' }), '正在拣选 abcdef1');
  assert.equal(operationProgress({ kind: 'merge' }), '');
  assert.deepEqual(sideNames(undefined), { current: '当前 HEAD', incoming: '传入的改动' });
});

test('删除/修改与重命名冲突只提供整文件操作，删除操作被标记', () => {
  assert.equal(hasConflictBlocks('both-modified'), true);
  assert.equal(hasConflictBlocks('both-added'), true);
  assert.equal(hasConflictBlocks('deleted-by-them'), false);
  assert.deepEqual(wholeFileActions('deleted-by-them'), [
    { side: 'current', label: '保留当前版本' },
    { side: 'incoming', label: '删除文件', removes: true },
  ]);
  assert.deepEqual(wholeFileActions('deleted-by-us'), [
    { side: 'incoming', label: '保留传入版本' },
    { side: 'current', label: '删除文件', removes: true },
  ]);
  assert.deepEqual(wholeFileActions('both-deleted'), [
    { side: 'current', label: '确认删除', removes: true },
  ]);
  assert.deepEqual(
    wholeFileActions('both-modified').map((action) => action.label),
    ['采用当前', '采用传入'],
  );
});

test('冲突之间的未改动内容只保留相邻几行', () => {
  const text = Array.from({ length: 10 }, (_, index) => `line ${index}\n`).join('');
  assert.deepEqual(contextExcerpt(text, { before: true, after: true }), {
    head: 'line 0\nline 1\nline 2\n',
    hidden: 4,
    tail: 'line 7\nline 8\nline 9\n',
  });
  assert.deepEqual(contextExcerpt(text, { before: false, after: true }).head, '');
  assert.equal(contextExcerpt('a\nb\n', { before: true, after: true }).hidden, 0);
});

test('仍有冲突时不能继续，变基可以跳过，中止始终可用', () => {
  const html = bar({ operation: rebase, conflicts: 2 });
  assert.match(html, /正在变基 feature\/中文/);
  assert.match(html, /第 2\/5 个提交/);
  assert.match(html, /修改 说明\.md/);
  assert.match(html, /2 个文件仍有冲突/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*继续变基/);
  assert.match(html, /跳过此提交/);
  assert.match(html, /中止变基/);
});

test('交互式变基使用专用控制栏，同时保留通用冲突文件入口', () => {
  const html = changes(
    [
      {
        path: 'conflict.txt',
        status: 'modified',
        staged: false,
        conflicted: true,
        conflict: 'both-modified',
      },
    ],
    rebase,
    true,
  );
  assert.doesNotMatch(html, /class="conflict-bar"/);
  assert.doesNotMatch(html, /跳过此提交|中止变基/);
  assert.match(html, /change-group--conflict/);
  assert.match(html, /aria-label="标记为已解决 conflict\.txt"/);
});

test('冲突解决后可以继续；合并没有跳过', () => {
  const html = bar({ operation: { kind: 'merge', branch: 'topic' }, conflicts: 0 });
  assert.match(html, /冲突已全部解决，可以继续合并/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*继续合并/);
  assert.doesNotMatch(html, /跳过此提交/);
});

test('储藏应用留下的冲突只显示提示，没有继续或中止', () => {
  const html = bar({ conflicts: 1 });
  assert.match(html, /1 个文件有未解决的冲突/);
  assert.match(html, /应用储藏/);
  assert.doesNotMatch(html, /继续|中止/);
  assert.equal(bar({ conflicts: 0 }), '');
});

test('冲突文件在变更列表顶部单独分组，显示冲突类型并提供标记为已解决', () => {
  const html = changes(
    [
      { path: 'a.txt', status: 'modified', staged: false },
      {
        path: '文档/说明.md',
        status: 'modified',
        staged: false,
        conflicted: true,
        conflict: 'both-modified',
      },
      {
        path: 'gone.txt',
        status: 'deleted',
        staged: false,
        conflicted: true,
        conflict: 'deleted-by-them',
      },
      { path: 'b.txt', status: 'modified', staged: true },
    ],
    { kind: 'merge', branch: 'topic' },
  );
  const conflictGroup = html.indexOf('change-group--conflict');
  const unstaged = html.indexOf('未暂存');
  assert.ok(html.indexOf('正在合并 topic') < conflictGroup);
  assert.ok(conflictGroup !== -1 && conflictGroup < unstaged);
  assert.match(html, /双方修改/);
  assert.match(html, /传入删除/);
  assert.match(html, /aria-label="标记为已解决 文档\/说明\.md"/);
  assert.match(html, /aria-label="标记为已解决 gone\.txt"/);
  assert.doesNotMatch(html, /aria-label="暂存 文档\/说明\.md"/);
  assert.match(html, /进行中的操作请用上方的“继续”完成/);
});
