import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileIcon } from '../src/components/ui.tsx';

const render = (path) => renderToStaticMarkup(createElement(FileIcon, { path }));

test('common file types use distinct Material Icon Theme assets', () => {
  const examples = {
    'src/App.ts': 'typescript',
    'src/App.tsx': 'react_ts',
    'src/App.js': 'javascript',
    'src/App.jsx': 'react',
    'src/data.json': 'json',
    'src/app.css': 'css',
    'src/app.scss': 'sass',
    'README.md': 'markdown',
    'config.yml': 'yaml',
    'tool.py': 'python',
    'main.go': 'go',
    'main.rs': 'rust',
    'App.vue': 'vue',
  };
  for (const [path, icon] of Object.entries(examples)) {
    const html = render(path);
    assert.match(html, new RegExp(`src="[^"]*/${icon}\\.svg"`), path);
    assert.match(html, /alt="" aria-hidden="true"/);
  }
  assert.match(render('src\\APP.TSX'), /react_ts\.svg/);
  assert.match(render('.env.local'), /settings\.svg/);
  assert.match(render('package.json'), /npm\.svg/);
  assert.match(render('tsconfig.json'), /tsconfig\.svg/);
  assert.match(render('.gitignore'), /git\.svg/);
});

test('unknown file types use a generic file icon', () => {
  assert.match(render('NOTICE.custom'), /file\.svg/);
});
