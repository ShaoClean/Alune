import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { changeActions } from '@alune/shared';
import { ChangesView } from '../src/components/ChangesView.tsx';
import { useRepositoryStore } from '../src/stores/repositoryStore.ts';

function render(files) {
  const status = { branch: 'main', ahead: 0, behind: 0, files };
  Object.assign(useRepositoryStore.getInitialState(), {
    status,
    repositoryStatuses: {
      'directory-fixture': { phase: 'success', data: status, updatedAt: Date.now() },
    },
  });
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ChangesView, { repoId: 'directory-fixture', onRefresh: async () => {} }),
    ),
  );
}

test('directory rows have names, repository icons, type labels and appropriate actions', () => {
  const path = '.claude/worktrees/demo/';
  const html = render([
    { path, kind: 'worktree', repositoryPath: '/repo/' + path, status: 'untracked', staged: false },
  ]);
  assert.match(html, /<strong>demo<\/strong>/);
  assert.match(html, /folder-git/);
  assert.match(html, /file-row__kind[^>]*>Worktree/);
  assert.ok(html.includes(`aria-label="打开 Worktree ${path}"`));
  assert.ok(html.includes(`aria-label="本地忽略 ${path}"`));
  assert.ok(!html.includes(`aria-label="查看差异 ${path}`));
  assert.ok(!html.includes(`aria-label="暂存 ${path}"`));
  assert.ok(!html.includes(`aria-label="删除整个新增文件 ${path}`));
  assert.match(html, /<button[^>]*disabled=""[^>]*><span>全部暂存<\/span>/);
});

test('old trailing-slash responses and tracked directory replacements never expose file deletion', () => {
  for (const file of [
    { path: 'nested/', status: 'untracked', staged: false },
    { path: 'replaced', status: 'deleted', kind: 'directory', staged: false },
  ]) {
    const html = render([file]);
    assert.ok(!html.includes('aria-label="删除整个新增文件'));
    assert.ok(!html.includes('aria-label="丢弃 '));
    assert.equal(changeActions(file).stage, false);
  }
});

test('normal files and submodule pointer changes remain actionable; dirty-only submodules do not stage', () => {
  const file = { path: 'file.txt', status: 'untracked', staged: false };
  assert.ok(render([file]).includes('aria-label="暂存 file.txt"'));
  const module = {
    path: 'module',
    kind: 'submodule',
    status: 'modified',
    staged: false,
    submodule: { commitChanged: false, trackedChanges: true, untrackedChanges: false },
  };
  assert.equal(changeActions(module).stage, false);
  assert.equal(changeActions(module).diff, true);
  module.submodule.commitChanged = true;
  const html = render([module]);
  assert.ok(html.includes('aria-label="暂存 module"'));
  assert.ok(!html.includes('aria-label="丢弃 module"'));
});
