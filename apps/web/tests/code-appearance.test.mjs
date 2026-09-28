import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BUILTIN_CODE_THEMES,
  MAX_THEME_BYTES,
  importCodeTheme,
  defaultCodeTheme,
} from '../src/code-themes.ts';
import {
  DEFAULT_CODE_APPEARANCE,
  readCodeAppearance,
  resolveCodeTheme,
  codeAppearanceStyle,
} from '../src/stores/codeAppearance.ts';
import { highlight } from '../src/components/syntax-highlight.ts';

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
const { useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');
const themeJSON = (mode = 'dark') =>
  JSON.stringify({
    name: `Fixture ${mode}`,
    type: mode,
    colors: {
      'editor.background': mode === 'dark' ? '#112233' : '#f5f6f7',
      'editor.foreground': '#778899',
      'editor.selectionBackground': '#556677aa',
      'editorLineNumber.foreground': '#aabbcc',
    },
    tokenColors: [
      { scope: 'comment', settings: { foreground: '#998877', fontStyle: 'italic' } },
      {
        scope: ['keyword', 'storage'],
        settings: { foreground: '#1122ee', fontStyle: 'bold underline' },
      },
      { scope: 'string', settings: { foreground: '#11cc55' } },
      { scope: 'constant.numeric', settings: { foreground: '#dd9911' } },
      { scope: 'support.type.property-name.json', settings: { foreground: '#aa00bb' } },
    ],
  });
const imported = (mode = 'dark') =>
  importCodeTheme(themeJSON(mode), `${mode}.json`, `custom-${mode}`).theme;

async function reset(state = {}) {
  saved.set('alune-workspace', JSON.stringify({ version: 1, state }));
  await workspace.persist.rehydrate();
}

test('all four Catppuccin palettes are immediately available and match their appearance', () => {
  assert.deepEqual(
    BUILTIN_CODE_THEMES.map((t) => [t.name, t.mode]),
    [
      ['Catppuccin Latte', 'light'],
      ['Catppuccin Frappé', 'dark'],
      ['Catppuccin Macchiato', 'dark'],
      ['Catppuccin Mocha', 'dark'],
    ],
  );
  for (const mode of ['light', 'dark']) {
    const expected = mode === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte';
    assert.equal(resolveCodeTheme(DEFAULT_CODE_APPEARANCE, mode).id, expected);
    for (const candidate of BUILTIN_CODE_THEMES) {
      const theme = resolveCodeTheme(
        { ...DEFAULT_CODE_APPEARANCE, [`${mode}Theme`]: candidate.id },
        mode,
      );
      assert.equal(theme.mode, mode);
      assert.equal(theme.id, candidate.mode === mode ? candidate.id : expected);
    }
  }
});

test('imports JSONC, editor colors and syntax styles with scope priority and a documented fallback', () => {
  const text = `// a JSONC theme\n${themeJSON().replace(/}$/, ',"semanticTokenColors":{},}')}`;
  const result = importCodeTheme(text, 'fixture.jsonc', 'custom-test');
  assert.equal(result.theme.colors.background, '#112233');
  assert.equal(result.theme.colors.gutter, '#112233');
  assert.equal(result.theme.colors.selection, '#556677aa');
  assert.equal(result.theme.tokens.keyword.color, '#1122ee');
  assert.equal(result.theme.tokens.keyword.bold, true);
  assert.equal(result.theme.tokens.keyword.underline, true);
  assert.equal(result.theme.tokens.comment.italic, true);
  assert.equal(result.theme.tokens.property.color, '#aa00bb');
  assert.equal(result.theme.tokens.function.color, defaultCodeTheme('dark').tokens.function.color);
  assert.equal(result.ignoredRules, 1);
  const value = JSON.parse(themeJSON());
  value.tokenColors.push(
    { scope: 'keyword.operator', settings: { foreground: '#abcdef' } },
    { scope: 'keyword', settings: { foreground: '#fedcba', fontStyle: '' } },
    { scope: 'source.ts keyword', settings: { foreground: '#000000' } },
    { scope: 'keyword.control.python', settings: { foreground: '#010203' } },
  );
  const mapped = importCodeTheme(JSON.stringify(value), 'priority.json', 'custom-priority');
  assert.equal(mapped.theme.tokens.operator.color, '#abcdef');
  assert.equal(mapped.theme.tokens.keyword.color, '#010203');
  assert.equal(mapped.theme.tokens.keyword.bold, false);
  assert.equal(mapped.ignoredRules, 1);
});

test('invalid or unclassified imports are rejected before changing preferences', async () => {
  await reset();
  const before = workspace.getState().codeAppearance;
  for (const input of [
    '{broken',
    'null',
    '[]',
    '{}',
    JSON.stringify({ type: 'auto', tokenColors: [] }),
    themeJSON().replace('"dark"', '"hcDark"'),
    JSON.stringify({ ...JSON.parse(themeJSON()), include: './other.json' }),
    JSON.stringify({ ...JSON.parse(themeJSON()), colors: [] }),
    JSON.stringify({ type: 'dark', tokenColors: './tokens.json' }),
    JSON.stringify({
      type: 'dark',
      tokenColors: [{ scope: 'keyword', settings: { foreground: 'url(https://example.invalid)' } }],
    }),
    JSON.stringify({
      type: 'dark',
      tokenColors: [{ scope: 'keyword', settings: { foreground: '#fff', fontStyle: 'blink' } }],
    }),
    JSON.stringify({
      type: 'dark',
      tokenColors: [{ scope: 12, settings: { foreground: '#fff' } }],
    }),
    JSON.stringify({
      type: 'dark',
      tokenColors: [{ scope: 'source.ts keyword', settings: { foreground: '#fff' } }],
    }),
    ' '.repeat(MAX_THEME_BYTES + 1),
  ]) {
    assert.throws(() => workspace.getState().importCodeTheme(input, 'invalid.json'));
    assert.equal(workspace.getState().codeAppearance, before);
  }
});

test('restore rejects mismatched, missing, corrupt and duplicate themes while preserving valid preferences', () => {
  for (const value of [undefined, null, {}])
    assert.deepEqual(readCodeAppearance(value), {
      preferences: DEFAULT_CODE_APPEARANCE,
      notice: null,
    });
  const theme = imported('light');
  for (const customThemes of [
    [theme],
    [{ ...theme, tokens: {} }],
    [{ ...theme, colors: { ...theme.colors, background: 'red' } }],
  ]) {
    const { preferences, notice } = readCodeAppearance({
      ...DEFAULT_CODE_APPEARANCE,
      darkTheme: theme.id,
      lightTheme: 'missing',
      customThemes,
    });
    assert.ok(notice);
    assert.equal(preferences.darkTheme, 'catppuccin-mocha');
    assert.equal(preferences.lightTheme, 'catppuccin-latte');
  }
  const result = readCodeAppearance({
    ...DEFAULT_CODE_APPEARANCE,
    lightTheme: theme.id,
    customThemes: [theme, theme],
    fontSize: Infinity,
    fontFamily: '\u0000bad',
  });
  assert.equal(result.preferences.customThemes.length, 1);
  assert.equal(result.preferences.lightTheme, theme.id);
  assert.equal(result.preferences.fontFamily, 'SFMono-Regular');
  assert.equal(result.preferences.fontSize, 13);
  assert.ok(result.notice);
  const dark = imported('dark');
  assert.deepEqual(
    readCodeAppearance({ ...DEFAULT_CODE_APPEARANCE, darkTheme: dark.id, customThemes: [dark] })
      .preferences.customThemes,
    [dark],
  );
});

test('install/select/restart/uninstall/reset preserves per-mode choices, appearance and unrelated workspace state', async () => {
  await reset({
    appearance: { theme: 'system', reduceMotion: true },
    treeOpen: false,
    connectionOrder: ['b', 'a'],
    layout: { sidebarWidth: 310 },
  });
  const before = workspace.getState();
  workspace.getState().importCodeTheme(themeJSON('light'), 'day.json');
  workspace.getState().importCodeTheme(themeJSON('dark'), 'night.json');
  const [light, dark] = workspace.getState().codeAppearance.customThemes;
  assert.equal(workspace.getState().codeAppearance.darkTheme, 'catppuccin-mocha');
  assert.equal(workspace.getState().selectCodeTheme('dark', light.id), false);
  assert.equal(workspace.getState().selectCodeTheme('light', dark.id), false);
  assert.equal(workspace.getState().selectCodeTheme('light', light.id), true);
  assert.equal(workspace.getState().selectCodeTheme('dark', dark.id), true);
  workspace.getState().updateCodeFont({ fontFamily: 'Unavailable Fixture Font', fontSize: 19 });
  await workspace.persist.rehydrate();
  assert.equal(workspace.getState().codeAppearance.lightTheme, light.id);
  assert.equal(workspace.getState().codeAppearance.darkTheme, dark.id);
  assert.equal(workspace.getState().codeAppearance.fontSize, 19);
  assert.equal(workspace.getState().codeAppearance.fontFamily, 'Unavailable Fixture Font');
  workspace.getState().removeCodeTheme(dark.id);
  assert.equal(workspace.getState().codeAppearance.darkTheme, 'catppuccin-mocha');
  assert.equal(workspace.getState().codeAppearance.lightTheme, light.id);
  assert.match(workspace.getState().codeAppearanceNotice, /卸载/);
  workspace.getState().resetLayout();
  assert.equal(workspace.getState().codeAppearance.lightTheme, light.id);
  workspace.getState().resetCodeAppearance();
  assert.deepEqual(workspace.getState().codeAppearance, {
    ...DEFAULT_CODE_APPEARANCE,
    customThemes: [light],
  });
  for (const key of ['appearance', 'treeOpen', 'connectionOrder'])
    assert.deepEqual(workspace.getState()[key], before[key]);
  assert.ok(!('codeAppearanceNotice' in JSON.parse(saved.get('alune-workspace')).state));
});

test('resolved OS changes restore the right code theme and cannot override explicit appearance', async () => {
  await reset({ codeAppearance: { ...DEFAULT_CODE_APPEARANCE, darkTheme: 'catppuccin-frappe' } });
  const media = new Map();
  globalThis.window = {
    matchMedia: (query) => {
      const result = {
        matches: false,
        listeners: new Set(),
        addEventListener: (_, fn) => result.listeners.add(fn),
        removeEventListener: (_, fn) => result.listeners.delete(fn),
      };
      media.set(query, result);
      return result;
    },
  };
  globalThis.document = { documentElement: { dataset: {} } };
  const { initializeAppearance, useAppearance } = await import('../src/appearance.ts');
  const dispose = initializeAppearance();
  const dark = media.get('(prefers-color-scheme: dark)');
  const active = () =>
    resolveCodeTheme(workspace.getState().codeAppearance, useAppearance.getState().theme).id;
  assert.equal(active(), 'catppuccin-latte');
  dark.matches = true;
  dark.listeners.forEach((fn) => fn());
  assert.equal(active(), 'catppuccin-frappe');
  workspace.getState().updateAppearance({ theme: 'light' });
  dark.listeners.forEach((fn) => fn());
  assert.equal(active(), 'catppuccin-latte');
  workspace.getState().updateAppearance({ theme: 'dark' });
  dark.matches = false;
  dark.listeners.forEach((fn) => fn());
  assert.equal(active(), 'catppuccin-frappe');
  workspace.getState().updateAppearance({ theme: 'system' });
  assert.equal(active(), 'catppuccin-latte');
  dark.matches = true;
  dark.listeners.forEach((fn) => fn());
  assert.equal(active(), 'catppuccin-frappe');
  dispose();
});

test('syntax colors actually reach TypeScript/Python/JSON tokens and keep file content escaped', () => {
  for (const [language, text, expected] of [
    ['typescript', 'const name = "<script>"; const count = 42;', ['keyword', 'string', 'number']],
    ['python', '# comment\nprint("alune", 42)', ['comment', 'string', 'number']],
    ['json', '{ "name": "alune", "count": 42 }', ['property', 'string', 'number']],
  ]) {
    const html = renderToStaticMarkup(createElement('code', null, highlight(text, language)));
    for (const group of expected)
      assert.ok(html.includes(`color:var(--syntax-${group})`), `${language}: ${group}`);
    assert.ok(!html.includes('<script>'));
  }
  const style = codeAppearanceStyle(
    { ...DEFAULT_CODE_APPEARANCE, fontSize: 200, fontFamily: 'Missing "Font"' },
    imported(),
  );
  assert.equal(style['--code-font-size'], '32px');
  assert.match(style['--code-font-family'], /monospace$/);
  assert.match(style['--code-font-family'], /Missing \\\"Font\\\"/);
  assert.equal(style['--syntax-keyword'], '#1122ee');
});
