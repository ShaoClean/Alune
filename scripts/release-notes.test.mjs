import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateReleaseNotes, selectPreviousTag } from './generate-release-notes.mjs';
import { generateReleaseHistoryMarkdown } from './generate-release-history.mjs';
import { deduplicateReleaseCommits } from './release-notes.mjs';

function fixture(t) {
  const directory = mkdtempSync(fileURLToPath(new URL('../.release-notes-test-', import.meta.url)));
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

test('public release history keeps unpublished tags pending and moves them into history after publication', (t) => {
  const { directory, git, commit } = fixture(t);
  commit('feat: 等待发布的功能');
  git('tag', 'v1.0.1'); // A tag alone is not a published release.
  commit('fix: 后续修复');
  const history = (publishedTags) => generateReleaseHistoryMarkdown({ publishedTags, repository: 'example/project', directory });
  const beforeFirstRelease = history([]);
  assert.match(beforeFirstRelease, /## 待发布[\s\S]*旧版本功能[\s\S]*等待发布的功能/);
  assert.doesNotMatch(beforeFirstRelease, /## v1\.0\.0/);
  const pending = history(['v1.0.0']);
  assert.match(pending, /## 待发布[\s\S]*等待发布的功能[\s\S]*后续修复/);
  assert.match(pending, /compare\/v1\.0\.0\.\.\.development/);
  assert.equal((pending.match(/等待发布的功能/g) || []).length, 1);
  commit('chore(release): 发布 1.1.0');
  git('tag', 'v1.1.0');
  const released = history(['v1.0.0', 'v1.1.0']);
  assert.match(released, /## 待发布\n\n暂无待发布变更。/);
  assert.match(released, /## v1\.1\.0[\s\S]*等待发布的功能[\s\S]*后续修复/);
  assert.equal((released.match(/等待发布的功能/g) || []).length, 1);
  assert.equal(history(['v1.0.0', 'v1.1.0']), released);
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

test('同一功能及同一 Issue 去重，连续生成结果一致', (t) => {
  const { git, commit, notes } = fixture(t);
  commit('feat(desktop): 支持 macOS 下载更新后一键重启安装 (#14)\n\nRefs #12');
  commit('feat(desktop): 支持 macOS 下载更新后一键重启安装 (#17)\n\nRefs #12');
  commit('feat(desktop): 完成 macOS 更新安装入口 (#18)\n\nCloses #12');
  commit('feat(workspace): 记住布局 (#20)');
  commit('feat(workspace): 记住布局 (#21)');
  git('tag', 'v1.1.0');
  const body = notes('v1.1.0', 'v1.0.0');
  assert.equal((body.match(/支持 macOS 下载更新后一键重启安装/g) || []).length, 1, body);
  assert.doesNotMatch(body, /完成 macOS 更新安装入口/);
  assert.equal((body.match(/记住布局/g) || []).length, 1, body);
  assert.match(body, /安装 \(#14\)/);
  assert.equal(notes('v1.1.0', 'v1.0.0'), body);
});

test('不同模块、分类、Issue 集合和迁移说明不会被误删', (t) => {
  const { git, commit, notes } = fixture(t);
  commit('feat(desktop): 添加入口\n\nRefs #12');
  commit('feat(web): 添加入口\n\nRefs #12');
  commit('fix(desktop): 添加入口\n\nRefs #12');
  commit('feat(desktop): 另一个功能\n\nRefs #13');
  commit('feat(desktop): 联合功能\n\nRefs #12, #13');
  commit('feat(desktop): 外部功能\n\nRefs other/project#12');
  commit('feat(desktop): 外部修复\n\nRefs another/project#12');
  commit('feat(desktop): 提及编号 #12 不代表同一功能');
  commit('feat(desktop)!: 添加入口\n\nBREAKING CHANGE: 重新导入配置。\n\nRefs #12');
  commit('feat(desktop)!: 添加入口\n\nBREAKING CHANGE: 升级系统版本。\n\nRefs #12');
  git('tag', 'v1.1.0');
  const body = notes('v1.1.0', 'v1.0.0');
  assert.equal((body.match(/^- /gm) || []).length, 10, body);
  for (const text of ['另一个功能', '联合功能', '外部功能', '外部修复', '重新导入配置。', '升级系统版本。']) {
    assert.ok(body.includes(text), body);
  }
});

test('本地预览也去重，并保留不同版本中的同名记录', (t) => {
  const { directory, git, commit } = fixture(t);
  commit('feat: 重复功能 (#1)');
  commit('feat: 重复功能 (#2)');
  git('tag', 'v1.1.0');
  commit('feat: 重复功能 (#3)');
  commit('feat: 重复功能 (#4)');
  git('tag', 'v1.2.0');
  const cli = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const body = execFileSync(process.execPath, [cli, 'v1.0.0..v1.2.0', '--repository', directory], { encoding: 'utf8' });
  assert.equal((body.match(/重复功能/g) || []).length, 2, body);
  assert.match(body, /## v1.1.0/);
  assert.match(body, /## v1.2.0/);
});

test('重复写入预览文件保持稳定且不追加，预览标签及格式不变', (t) => {
  const { directory, commit, notes, git } = fixture(t);
  commit('feat(desktop): 支持更新 (#14)');
  commit('feat(desktop): 支持更新 (#17)');
  git('tag', 'v1.1.0');
  const cli = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const output = path.join(directory, 'release notes.md');
  const args = [cli, 'v1.0.0..HEAD', '--repository', directory, '--tag', 'v1.1.0', '--tag-pattern', '^v1\\.1\\.0$', '--output', output];
  const run = () => execFileSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(run(), '');
  const body = readFileSync(output, 'utf8');
  assert.equal(run(), '');
  assert.equal(readFileSync(output, 'utf8'), body);
  assert.equal(body.trim(), '## v1.1.0\n\n### 🚀 新功能\n- **desktop**：支持更新 (#14)');
  assert.equal(notes('v1.1.0', 'v1.0.0').split('\n\n**完整变更**')[0], body.trim());
});

test('Issue 引用集合排序去重，普通正文与尾部以外的编号保持原意', () => {
  const record = (message, body = '') => ({
    group: '新功能', scope: 'desktop', message,
    raw_message: `feat(desktop): ${message}\n\n${body}`,
  });
  const commits = [
    record('集合功能', 'Refs #12, #13'),
    record('集合功能的后续提交', 'Fixes: #13 and #12'),
    record('另一个集合', 'Resolves #12, #14'),
    record('外部功能', 'Refs owner/project#12'),
    record('外部功能后续', 'Closed OWNER/PROJECT#12'),
    record('普通正文', 'Refs #12 for compatibility'),
    record('提到 #12 的另一功能'),
    record('PR 标记相同不代表同一功能 (#14)'),
    record('不同功能 (#14)'),
    record('完全重复'),
    record('完全重复'),
    record('多个 PR 标记 (#20) (#21)'),
    record('多个 PR 标记 (#22)'),
  ];
  const result = deduplicateReleaseCommits(commits);
  assert.deepEqual(result, [commits[0], commits[2], commits[3], ...commits.slice(5, 10), commits[11]]);
  assert.deepEqual(deduplicateReleaseCommits(result), result);
});
