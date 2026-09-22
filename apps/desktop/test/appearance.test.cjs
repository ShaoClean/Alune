const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workspaceBackground } = require('../src/workspace-preferences.cjs');
test('native first frame follows explicit appearance or system fallback', () => {
  for (const systemDark of [false, true]) {
    for (const theme of ['light', 'dark', 'system', 'invalid']) {
      const value = JSON.stringify({ state: { appearance: { theme } } });
      const dark = theme === 'dark' || (theme !== 'light' && systemDark);
      assert.equal(workspaceBackground(value, systemDark), dark ? '#151e30' : '#f5f7fb');
    }
    for (const value of [null, '{broken', '{}']) {
      assert.equal(workspaceBackground(value, systemDark), systemDark ? '#151e30' : '#f5f7fb');
    }
  }
});
