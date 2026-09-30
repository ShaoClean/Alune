import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const source = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('settings reuse workspace navigation and have no independent full-screen shell', () => {
  const center = source('components/settings/SettingsCenter.tsx');
  const layout = source('components/Layout.tsx');
  const css = source('settings.css');
  assert.match(center, /sidebar-nav-item/);
  assert.match(center, /sidebar-section__heading/);
  assert.match(center, /aria-label="设置分类"/);
  assert.doesNotMatch(
    center + css,
    /settings-(?:center|header|brand|body|navigation|footer|mobile-category)/,
  );
  assert.doesNotMatch(css, /--settings-line|100dvh|@media/);
  assert.match(css, /container: settings \/ inline-size/);
  assert.match(css, /@container settings \(width < 600px\)/);
  assert.match(css, /@container settings \(width < 900px\)/);
  assert.match(layout, /hidden=\{isSettings\}/);
  assert.match(layout, /active=\{!isSettings\}/);
  assert.doesNotMatch(layout, /display: isSettings \? 'none'/);
});

test('all eleven settings dropdowns use named, explicitly associated antd inputs', () => {
  const files = readdirSync(new URL('../src/components/settings/', import.meta.url))
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => source(`components/settings/${file}`));
  assert.doesNotMatch(files.join('\n'), /<select\b/);
  const selects = files.flatMap((file) =>
    [...file.matchAll(/<Select\b[\s\S]*?\/>/g)].map((match) => ({ markup: match[0], file })),
  );
  assert.equal(selects.length, 11);
  for (const { markup, file } of selects) {
    const id = markup.match(/id="([^"]+)"/)?.[1];
    assert.ok(id);
    assert.match(markup, /aria-label="[^"]+"/);
    assert.ok(file.includes(`htmlFor="${id}"`), `${id} label must focus its input`);
  }
  assert.match(
    source('components/settings/ProviderSettings.tsx'),
    /value: '', label: '仅测试模型列表接口'/,
  );
  const themes = source('components/settings/CodeAppearanceSettings.tsx');
  assert.match(themes, /aria-describedby="code-theme-mode-hint"/);
  assert.match(themes, /label: '内置主题'/);
  assert.match(themes, /label: '已安装主题'/);
  assert.match(themes, /disabled: item.mode !== mode/);
});
