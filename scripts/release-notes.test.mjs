import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { generateReleaseNotes, selectPreviousTag } from './generate-release-notes.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'remote-git-release-notes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config') };
  const git = (...args) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release notes test');
  git('config', 'user.email', 'release-notes@example.invalid');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  git('config', 'core.hooksPath', '.disabled-hooks');
  const commit = (message) => git('commit', '--allow-empty', '-m', message);
  commit('feat: 旧版本功能');
  git('tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0');
  const notes = (tag, previousTag) => generateReleaseNotes({ tag, previousTag, repository: 'example/project', directory });
  return { directory, git, commit, notes };
}

test('release boundaries use successful stable releases on the first-parent history', (t) => {
  const { directory, git, commit } = fixture(t);
  commit('feat: 未发布版本中的功能');
  git('tag', 'v1.0.1');
  git('switch', '-c', 'side', 'v1.0.0');
  commit('feat: 侧分支功能');
  git('tag', 'v1.5.0');
  git('switch', 'main');
  git('merge', '--no-ff', 'side', '-m', 'Merge branch side');
  commit('chore(release): 发布 2.0.0');
  git('tag', 'v2.0.0');
  assert.equal(selectPreviousTag('v2.0.0', ['v1.0.0', 'v1.5.0', 'v2.0.0'], directory), 'v1.0.0');
  assert.equal(selectPreviousTag('v2.0.0', ['v1.0.0', 'v1.0.1'], directory), 'v1.0.1');
  assert.equal(selectPreviousTag('v1.0.0', ['v1.0.0'], directory), undefined);
});

test('git-cliff groups changes, preserves breaking and legacy messages, and folds unpublished tags into one release', (t) => {
  const { git, commit, notes } = fixture(t);
  commit('feat(workspace): 记住侧边栏设置');
  git('tag', 'v1.0.1'); // Build failed: its changes must still appear in v2.0.0.
  commit('fix(ssh): 修复重连失败');
  commit('perf: 加快仓库列表加载');
  commit('refactor: 简化连接状态管理');
  commit('保留旧格式的变更说明');
  commit('chore!: 更新配置格式\n\nBREAKING CHANGE: 请重新导入旧连接配置。');
  commit('build: 更新系统要求\n\nBREAKING CHANGE: 最低系统版本已提高。');
  commit('docs: 内部文档调整');
  commit('test: 增加内部测试');
  commit('chore(release): 发布 2.0.0');
  git('tag', 'v2.0.0');
  const body = notes('v2.0.0', 'v1.0.0');
  for (const text of ['不兼容变更', '新功能', 'Bug 修复', '性能优化', '重构改进', '其他变更', '记住侧边栏设置', '请重新导入旧连接配置。', '最低系统版本已提高。', '保留旧格式的变更说明']) {
    assert.ok(body.includes(text), `Missing ${text}: ${body}`);
  }
  assert.match(body, /\*\*workspace\*\*/);
  assert.match(body, /https:\/\/github.com\/example\/project\/compare\/v1.0.0\.\.\.v2.0.0/);
  assert.equal((body.match(/^## /gm) || []).length, 1, body);
  for (const text of ['旧版本功能', '内部文档调整', '增加内部测试', '发布 2.0.0', '<!--']) assert.ok(!body.includes(text), body);
});

test('maintenance-only releases have a meaningful body and a comparison link', (t) => {
  const { git, commit, notes } = fixture(t);
  commit('ci: 调整构建环境');
  commit('chore(release): 发布 1.0.1');
  git('tag', 'v1.0.1');
  const body = notes('v1.0.1', 'v1.0.0');
  assert.match(body, /构建、测试或维护调整/);
  assert.match(body, /完整变更/);
  assert.doesNotMatch(body, /待发布/);
});

test('the first release includes history and links to its commits', (t) => {
  const { notes, commit } = fixture(t);
  commit('feat: 下个版本的功能');
  const body = notes('v1.0.0');
  assert.match(body, /旧版本功能/);
  assert.doesNotMatch(body, /下个版本的功能/);
  assert.match(body, /https:\/\/github.com\/example\/project\/commits\/v1.0.0/);
});
