import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AluneUIProvider, Button, FileIcon, FolderIcon, AluneModal } from '@alune/ui';
const root = new URL('../src/', import.meta.url).pathname;
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
test('shared runtime has no reverse application or desktop dependency', () => {
  for (const file of sources(root)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:from\s*|import\s*\()['"][^'"]*(?:apps\/|electron|react-router|\/api\/|workspaceStore|repositoryStore)/,
      file,
    );
    assert.doesNotMatch(source, /\blocalStorage\b/, file);
  }
});
test('public entry and Provider can render without browser globals', () => {
  assert.equal(typeof document, 'undefined');
  for (const theme of ['light', 'dark']) {
    const html = renderToStaticMarkup(
      React.createElement(
        AluneUIProvider,
        { theme },
        React.createElement(Button, { type: 'primary' }, '保存'),
        React.createElement(FileIcon, { path: 'unknown.ext' }),
        React.createElement(FolderIcon, { variant: 'repository' }),
        React.createElement(AluneModal, { open: false, title: '确认' }),
      ),
    );
    assert.match(html, /保\s*存/);
    assert.match(html, /file\.svg/);
    assert.match(html, /folder-git\.svg/);
  }
});
