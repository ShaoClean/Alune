import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChangesView, commitDisabled } from '../src/components/ChangesView.tsx';

const render = () =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ChangesView, { repoId: 'layout', onRefresh: async () => {} }),
    ),
  );
const order = (html, markers) =>
  markers.map((marker) => {
    const index = html.indexOf(marker);
    assert.notEqual(index, -1, `缺少 ${marker}`);
    return index;
  });

test('辅助工具栏在描述输入之后、提交按钮之前，提交始终是最后一步', () => {
  const html = render();
  const [summary, description, bar, model, submit] = order(html, [
    'aria-label="提交摘要"',
    'aria-label="提交描述"',
    'class="commit-ai-bar"',
    'commit-ai-bar__model',
    '提交已暂存内容',
  ]);
  assert.ok(summary < description && description < bar && bar < submit);
  assert.ok(bar < model && model < submit);
});

test('生成入口是摘要输入框右侧的图标，文案只在悬停时提示', () => {
  const html = render();
  const [summary, generate, description] = order(html, [
    'aria-label="提交摘要"',
    'aria-label="AI 生成提交信息"',
    'aria-label="提交描述"',
  ]);
  // The button lives inside the summary field's suffix, before the description.
  assert.ok(summary < generate && generate < description);
  assert.match(html, /ant-input-suffix/);
  const button = html.slice(generate - 120, html.indexOf('</button>', generate));
  assert.match(button, /commit-ai-generate/);
  // Icon only: no visible label text is rendered next to the glyph.
  assert.doesNotMatch(button.replace(/<[^>]*>/g, ''), /生成提交信息/);
});

test('模型选择与生成操作均有可访问名称', () => {
  const html = render();
  assert.match(html, /aria-label="AI 模型 尚未配置 AI，打开提交生成设置"/);
  assert.match(html, /aria-label="AI 生成提交信息"/);
});

test('重排控件顺序不改变提交按钮的启用条件', () => {
  assert.equal(commitDisabled(false, 0, 'feat: 调整布局'), true);
  assert.equal(commitDisabled(false, 2, '   '), true);
  assert.equal(commitDisabled(true, 2, 'feat: 调整布局'), true);
  assert.equal(commitDisabled(false, 2, 'feat: 调整布局'), false);
});

test('工具栏在窄侧栏下换行，模型选择始终可见', () => {
  const css = readFileSync(new URL('../src/settings.css', import.meta.url), 'utf8');
  const bar = css.slice(css.indexOf('.commit-ai-bar {'), css.indexOf('.commit-ai-bar__model {'));
  const hint = css.slice(css.indexOf('.commit-ai-bar__hint {'));
  // Wrapping is content-driven: the hint moves to its own row once it runs out of room.
  assert.match(bar, /flex-wrap: wrap;/);
  assert.match(hint.slice(0, hint.indexOf('}')), /min-width: 12em;/);
  // Only the hint may be dropped, and only when vertical space is scarce.
  const layout = readFileSync(new URL('../src/workspace-layout.css', import.meta.url), 'utf8');
  const short = layout.slice(layout.indexOf('@media (max-height: 700px)'));
  assert.match(short, /\.changes-panel \.commit-ai-bar__hint \{\s*display: none;/);
  assert.doesNotMatch(short, /commit-ai-(bar__model|generate) \{\s*display: none;/);
});

test('提交表单不再保留居中的底部说明样式', () => {
  for (const file of ['../src/index.css', '../src/workspace-layout.css', '../src/settings.css']) {
    const css = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /commit-box__hint|commit-ai-meta|commit-ai-button/, file);
  }
});
