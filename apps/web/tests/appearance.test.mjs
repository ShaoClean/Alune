import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  readAppearancePreferences,
  resolveAppearance,
  DEFAULT_APPEARANCE,
} from '../src/stores/appearance.ts';

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
const { useWorkspaceStore: workspace } = await import('../src/stores/workspaceStore.ts');

test('missing/corrupt appearance defaults to system without coercing malformed values', () => {
  for (const value of [null, [], 4, { theme: 'blue', reduceMotion: 'true' }]) {
    assert.deepEqual(readAppearancePreferences(value), DEFAULT_APPEARANCE);
  }
  for (const theme of ['light', 'dark', 'system'])
    for (const dark of [false, true]) {
      for (const systemReduced of [false, true])
        for (const appReduced of [false, true]) {
          assert.deepEqual(
            resolveAppearance({ theme, reduceMotion: appReduced }, dark, systemReduced),
            {
              theme: theme === 'system' ? (dark ? 'dark' : 'light') : theme,
              reduceMotion: systemReduced || appReduced,
            },
          );
        }
    }
});

test('appearance survives reload and layout reset without changing existing workspace preferences', async () => {
  const existing = {
    layout: { sidebarWidth: 310, changesWidth: 420, diffMode: 'split' },
    treeOpen: false,
    connectionOrder: ['b', 'a'],
    collapsedConnectionIds: ['b'],
    repositoryOrderByConnection: { a: ['r2', 'r1'] },
  };
  saved.set('alune-workspace', JSON.stringify({ version: 1, state: existing }));
  await workspace.persist.rehydrate();
  const before = workspace.getState();
  assert.deepEqual(before.appearance, DEFAULT_APPEARANCE);
  workspace.getState().updateAppearance({ theme: 'dark', reduceMotion: true });
  await workspace.persist.rehydrate();
  assert.deepEqual(workspace.getState().appearance, { theme: 'dark', reduceMotion: true });
  for (const key of Object.keys(existing)) assert.deepEqual(workspace.getState()[key], before[key]);
  workspace.getState().resetLayout();
  assert.deepEqual(workspace.getState().appearance, { theme: 'dark', reduceMotion: true });
});

test('browser first-paint bootstrap handles saved, corrupt, unavailable and desktop storage', () => {
  const script = readFileSync(
    new URL('../public/assets/appearance-init.js', import.meta.url),
    'utf8',
  );
  for (const theme of ['light', 'dark']) {
    const dataset = {};
    runInNewContext(script, {
      window: {},
      document: { documentElement: { dataset } },
      localStorage: {
        getItem: () =>
          JSON.stringify({ version: 1, state: { appearance: { theme, reduceMotion: true } } }),
      },
    });
    assert.deepEqual(dataset, { theme, reducedMotion: 'true' });
  }
  for (const getItem of [
    () => '{broken',
    () => {
      throw Error('blocked');
    },
  ]) {
    const dataset = {};
    runInNewContext(script, {
      window: {},
      document: { documentElement: { dataset } },
      localStorage: { getItem },
    });
    assert.deepEqual(dataset, {});
  }
  runInNewContext(script, { window: { aluneWorkspace: {} } });
});

const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
const palette = (block) =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/g)].map((m) => [m[1], m[2]]));
const darkRule = /:root\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/.exec(css);
assert.ok(darkRule, 'dark palette exists');
const light = palette(css.slice(0, darkRule.index));
const dark = { ...light, ...palette(darkRule[1]) };
const luminance = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const [name, colors] of Object.entries({ light, dark }))
  test(`${name} readable text, status and Diff; visible focus and input boundaries`, () => {
    const pairs = [
      ['text', 'content'],
      ['text-muted', 'content'],
      ['text-muted', 'surface'],
      ['primary-on', 'blue'],
      ['primary-on', 'primary-hover'],
      ['green', 'green-soft'],
      ['orange', 'orange-soft'],
      ['red', 'red-soft'],
      ['purple', 'purple-soft'],
      ['text', 'code'],
      ['green', 'diff-add'],
      ['red', 'diff-remove'],
      ['text-muted', 'diff-add'],
      ['text-muted', 'diff-remove'],
      ['blue', 'diff-meta'],
    ];
    for (const [fg, bg] of pairs)
      assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${name} ${fg}/${bg}`);
    for (const bg of ['surface', 'content', 'sidebar-bg']) {
      assert.ok(contrast(colors.blue, colors[bg]) >= 3, `${name} focus/${bg}`);
      assert.ok(contrast(colors['line-strong'], colors[bg]) >= 3, `${name} control/${bg}`);
    }
  });

test('live OS changes update root tokens; app reduce motion cannot override OS; disposal removes listeners', async () => {
  const queries = new Map();
  globalThis.window = {
    matchMedia: (query) => {
      const media = {
        matches: false,
        listeners: new Set(),
        addEventListener: (_, listener) => media.listeners.add(listener),
        removeEventListener: (_, listener) => media.listeners.delete(listener),
      };
      queries.set(query, media);
      return media;
    },
  };
  globalThis.document = { documentElement: { dataset: {} } };
  workspace.getState().updateAppearance({ theme: 'system', reduceMotion: false });
  const { initializeAppearance, useAppearance } = await import('../src/appearance.ts');
  const dispose = initializeAppearance();
  const dark = queries.get('(prefers-color-scheme: dark)');
  const reduced = queries.get('(prefers-reduced-motion: reduce)');
  dark.matches = true;
  dark.listeners.forEach((listener) => listener());
  assert.equal(document.documentElement.dataset.theme, 'dark');
  workspace.getState().updateAppearance({ theme: 'light' });
  dark.listeners.forEach((listener) => listener());
  assert.equal(document.documentElement.dataset.theme, 'light');
  reduced.matches = true;
  reduced.listeners.forEach((listener) => listener());
  workspace.getState().updateAppearance({ reduceMotion: false });
  assert.equal(useAppearance.getState().reduceMotion, true);
  assert.equal(document.documentElement.dataset.reducedMotion, 'true');
  dispose();
  assert.equal(dark.listeners.size + reduced.listeners.size, 0);
  workspace.getState().updateAppearance({ theme: 'dark' });
  assert.equal(document.documentElement.dataset.theme, 'light');
});
