import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { discardResultMessage } from '../src/components/DiscardChangesDialog.tsx';

const root = new URL('../src/', import.meta.url);
function sources(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sources(url) : /\.tsx?$/.test(entry.name) ? [url] : [];
  });
}
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('业务操作不再发布常规成功消息，公共反馈系统仍可报告诊断结果', () => {
  for (const file of sources()) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /message\.success\s*\(/, file.pathname);
  }
  assert.match(source('components/settings/ProviderSettings.tsx'), /await aiApi\.test\(/);
  assert.match(
    source('components/settings/ProxySettings.tsx'),
    /results\[kind\]!\.success \? 'success' : 'error'/,
  );
});

test('非命令式的常规完成提示同样移除，不替换为通知横条', () => {
  assert.doesNotMatch(source('components/PullRequestActions.tsx'), /review-success|setNotice/);
  assert.doesNotMatch(source('hooks/useCommitGeneration.ts'), /已填入提交信息/);
  assert.doesNotMatch(
    source('components/settings/ProviderSettings.tsx'),
    /配置已保存。|模型列表已更新。|已取消操作。/,
  );
  assert.doesNotMatch(
    source('components/settings/CommitSettings.tsx'),
    /type=.*success|error: false/,
  );
  assert.doesNotMatch(source('components/settings/ProxySettings.tsx'), /代理配置已保存。/);
  assert.match(
    source('components/settings/CodeAppearanceSettings.tsx'),
    /if \(result\.ignoredRules\)[\s\S]*?type: 'warning'/,
  );
});

test('部分放弃结果保留恢复、删除、未完成与未知计数', () => {
  assert.equal(
    discardResultMessage({ restored: 2, deleted: 1, remaining: 3, unknown: 4 }),
    '已恢复 2 个文件，已删除 1 个未跟踪文件；3 个文件未完成；4 个文件的结果无法确认',
  );
  const dialog = source('components/DiscardChangesDialog.tsx');
  assert.match(dialog, /if \(!result\.success && revision\.current === current\)/);
  assert.match(dialog, /setError\(`\$\{discardResultMessage\(result\)\}/);
  assert.match(dialog, /await refresh\(\)/);
  assert.match(dialog, /!acknowledged/);
  assert.match(dialog, /message\.warning/);
});
