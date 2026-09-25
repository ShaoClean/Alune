import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROOT,
  errorMessage,
  errorStatus,
  parentOf,
  treeRows,
  visibleDirectories,
} from '../src/components/files-tree.ts';
import { fileLanguage } from '../src/components/file-language.ts';
import { highlight } from '../src/components/syntax-highlight.ts';
import {
  CodeView,
  FilePreviewPane,
  FilesView,
  HIGHLIGHT_MAX_CHARS,
  displayText,
} from '../src/components/FilesView.tsx';
import { FolderIcon } from '../src/components/ui.tsx';
import { ImageDiffView, ImagePreview } from '../src/components/ImageDiffView.tsx';
import { readLayoutPreferences } from '../src/stores/workspaceLayout.ts';
import {
  DIFF_IMAGE_MAX_BYTES,
  REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
} from '../../../packages/shared/src/index.ts';

const entry = (path, kind = 'file', extra = {}) => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind,
  ...extra,
});
const listing = (path, entries, extra = {}) => ({
  path,
  entries,
  total: entries.length,
  truncated: false,
  ...extra,
});
const ready = (path, entries, extra) => ({
  phase: 'ready',
  listing: listing(path, entries, extra),
});
const describeRows = (rows) =>
  rows.map((row) =>
    row.type === 'entry'
      ? `${'  '.repeat(row.level - 1)}${row.entry.name}${row.expanded === undefined ? '' : row.expanded ? '/-' : '/+'}`
      : `${'  '.repeat(row.level - 1)}[${row.notice}]`,
  );

const renderPreview = (props) =>
  renderToStaticMarkup(createElement(FilePreviewPane, { onRetry() {}, ...props }));
const readyFile = (path, preview) => ({ phase: 'ready', path, preview });

test('只展开的目录会被读取，未加载的子目录显示读取中并交给视图加载', () => {
  const directories = {
    [ROOT]: ready(ROOT, [
      entry('apps', 'directory'),
      entry('docs', 'directory'),
      entry('README.md'),
    ]),
    apps: ready('apps', [entry('apps/web', 'directory'), entry('apps/server', 'directory')]),
  };
  const { rows, pending } = treeRows(directories, new Set(['apps', 'apps/web']));
  assert.deepEqual(describeRows(rows), [
    'apps/-',
    '  web/-',
    '    [loading]',
    '  server/+',
    'docs/+',
    'README.md',
  ]);
  // Only the expanded folder without a listing is requested; collapsed ones are not.
  assert.deepEqual(pending, ['apps/web']);
  const web = rows.find((row) => row.type === 'entry' && row.entry.path === 'apps/web');
  assert.deepEqual(
    { level: web.level, position: web.position, setSize: web.setSize, parent: web.parent },
    { level: 2, position: 1, setSize: 2, parent: 'apps' },
  );
});

test('根目录的读取中和失败不生成树行，由视图整体显示', () => {
  assert.deepEqual(treeRows({}, new Set()), { rows: [], pending: [ROOT] });
  assert.deepEqual(treeRows({ [ROOT]: { phase: 'loading' } }, new Set()).rows, []);
  assert.deepEqual(treeRows({ [ROOT]: { phase: 'error', message: 'denied' } }, new Set()).rows, []);
});

test('单个目录失败、为空或被截断时只在该目录下提示，不影响兄弟节点', () => {
  const directories = {
    [ROOT]: ready(ROOT, [
      entry('locked', 'directory'),
      entry('empty', 'directory'),
      entry('huge', 'directory'),
      entry('ok.txt'),
    ]),
    locked: { phase: 'error', message: 'Permission denied', status: 403 },
    empty: ready('empty', []),
    huge: ready('huge', [entry('huge/a.txt')], { total: 7200, truncated: true }),
  };
  const { rows, pending } = treeRows(directories, new Set(['locked', 'empty', 'huge']));
  assert.deepEqual(describeRows(rows), [
    'locked/-',
    '  [error]',
    'empty/-',
    '  [empty]',
    'huge/-',
    '  a.txt',
    '  [truncated]',
    'ok.txt',
  ]);
  assert.deepEqual(pending, []);
});

test('刷新时保留旧列表，刷新失败也继续显示旧内容', () => {
  const stale = listing('src', [entry('src/main.ts')]);
  const base = { [ROOT]: ready(ROOT, [entry('src', 'directory')]) };
  const loading = treeRows(
    { ...base, src: { phase: 'loading', listing: stale } },
    new Set(['src']),
  );
  assert.deepEqual(describeRows(loading.rows), ['src/-', '  main.ts']);
  const failed = treeRows(
    { ...base, src: { phase: 'error', message: 'timeout', listing: stale } },
    new Set(['src']),
  );
  assert.deepEqual(describeRows(failed.rows), ['src/-', '  [error]', '  main.ts']);
});

test('符号链接、子模块和特殊文件不可展开，即使同名路径被标记为展开', () => {
  const directories = {
    [ROOT]: ready(ROOT, [
      entry('latest', 'symlink', { target: 'apps/web' }),
      entry('vendor', 'submodule'),
      entry('fifo', 'other'),
    ]),
  };
  const { rows, pending } = treeRows(directories, new Set(['latest', 'vendor', 'fifo']));
  assert.deepEqual(describeRows(rows), ['latest', 'vendor', 'fifo']);
  assert.deepEqual(pending, []);
});

test('可见目录只包含根和展开且其父级也可见的目录', () => {
  const directories = {
    [ROOT]: ready(ROOT, [entry('a', 'directory'), entry('b', 'directory')]),
    a: ready('a', [entry('a/inner', 'directory')]),
    b: ready('b', [entry('b/deep', 'directory')]),
  };
  // `b/deep` is marked open but its parent is collapsed, so it is not on screen.
  assert.deepEqual(visibleDirectories(directories, new Set(['a', 'a/inner', 'b/deep'])), [
    ROOT,
    'a',
    'a/inner',
  ]);
  assert.equal(parentOf('a/inner/file.ts'), 'a/inner');
  assert.equal(parentOf('README.md'), ROOT);
});

test('错误信息优先使用服务端返回的说明和状态码', () => {
  const response = { response: { status: 403, data: { message: '没有权限读取 locked' } } };
  assert.equal(errorStatus(response), 403);
  assert.equal(errorMessage(response, 'fallback'), '没有权限读取 locked');
  assert.equal(errorMessage(new Error('Network Error'), 'fallback'), 'Network Error');
  assert.equal(errorMessage(undefined, 'fallback'), 'fallback');
  assert.equal(errorStatus(new Error('x')), undefined);
});

test('按文件名和扩展名识别语言，未知类型按纯文本处理', () => {
  const cases = {
    'src/App.tsx': 'tsx',
    'vite.config.MTS': 'typescript',
    'scripts/build.cjs': 'javascript',
    'package.json': 'json',
    'docs/README.md': 'markdown',
    '.github/workflows/ci.yml': 'yaml',
    Dockerfile: 'docker',
    'docker/Dockerfile.dev': 'docker',
    Makefile: 'makefile',
    '.env.local': 'bash',
    'src/main.rs': 'rust',
    'logo.svg': 'markup',
  };
  for (const [path, id] of Object.entries(cases)) assert.equal(fileLanguage(path)?.id, id, path);
  for (const path of ['LICENSE', 'notes.txt', '.gitignore', 'archive.tar.gz', 'dir.ts/README'])
    assert.equal(fileLanguage(path), null, path);
});

test('语法高亮生成 React 元素而不是 HTML 字符串，未知语法返回 null', () => {
  const tokens = highlight('const answer = 42; // <b>not html</b>', 'typescript');
  assert.ok(Array.isArray(tokens));
  const markup = renderToStaticMarkup(createElement('code', null, tokens));
  assert.match(markup, /<span class="token keyword">const<\/span>/);
  assert.match(markup, /<span class="token number">42<\/span>/);
  // Content inside a comment is escaped text, never parsed markup.
  assert.match(markup, /<span class="token comment">\/\/ &lt;b&gt;not html&lt;\/b&gt;<\/span>/);
  assert.ok(tokens.some((token) => isValidElement(token)));
  assert.equal(highlight('anything', 'brainfuck'), null);
});

test('每种已识别语言都有对应的 Prism 语法', () => {
  const samples = [
    'a.ts',
    'a.tsx',
    'a.js',
    'a.jsx',
    'a.json',
    'a.css',
    'a.scss',
    'a.less',
    'a.html',
    'a.md',
    'a.yml',
    'a.sh',
    'a.py',
    'a.go',
    'a.rs',
    'a.java',
    'a.kt',
    'a.c',
    'a.cpp',
    'a.cs',
    'a.rb',
    'a.sql',
    'a.toml',
    'a.ini',
    'Dockerfile',
    'a.diff',
    'a.graphql',
    'a.swift',
    'a.lua',
    'Makefile',
    'a.properties',
  ];
  for (const path of samples) assert.ok(highlight('x', fileLanguage(path).id), path);
});

test('显示文本时统一换行符，末尾换行不额外占一行', () => {
  assert.deepEqual(displayText('a\r\nb\r\n'), { text: 'a\nb', lines: 2, crlf: true });
  assert.deepEqual(displayText('a\nb'), { text: 'a\nb', lines: 2, crlf: false });
  assert.deepEqual(displayText('one'), { text: 'one', lines: 1, crlf: false });
  assert.deepEqual(displayText('a\n\n'), { text: 'a\n', lines: 2, crlf: false });
  assert.deepEqual(displayText('\n'), { text: '', lines: 1, crlf: false });
});

test('文件夹图标区分展开、嵌套仓库和链接', () => {
  const src = (props) =>
    renderToStaticMarkup(createElement(FolderIcon, props)).match(/src="([^"]+)"/)[1];
  assert.match(src({}), /\/folder\.svg$/);
  assert.match(src({ open: true }), /\/folder-open\.svg$/);
  assert.match(src({ variant: 'repository' }), /\/folder-git\.svg$/);
  assert.match(src({ variant: 'link' }), /\/folder-link\.svg$/);
});

test('未选择文件时提示选择，且说明浏览只读', () => {
  const html = renderPreview({ entry: null, file: null });
  assert.match(html, /选择文件以预览/);
  assert.match(html, /只读/);
});

test('文本预览显示路径、行号、语言、编码和大小，不依赖 language- 类名', () => {
  const html = renderPreview({
    entry: entry('apps/web/src/Workspace.tsx'),
    file: readyFile('apps/web/src/Workspace.tsx', {
      kind: 'text',
      size: 2048,
      encoding: 'utf-8',
      content: 'export const a = 1;\r\nexport const b = 2;\r\n',
    }),
  });
  assert.match(html, /<span class="files-preview__dir">apps\/web\/src\/<\/span>/);
  assert.match(html, /<span class="files-preview__name">Workspace\.tsx<\/span>/);
  for (const meta of ['TSX', 'UTF-8', 'CRLF', '2 行', '2.0 KB'])
    assert.ok(html.includes(`<span>${meta}</span>`), meta);
  assert.match(html, /<pre class="files-code__gutter" aria-hidden="true">1\n2<\/pre>/);
  assert.match(html, /data-language="tsx"/);
  assert.doesNotMatch(html, /language-/);
  assert.match(html, /aria-label="复制文件路径"/);
});

test('无法识别语言的文本按纯文本显示，UTF-16 标出编码，空文件单独说明', () => {
  const plain = renderPreview({
    entry: entry('LICENSE'),
    file: readyFile('LICENSE', { kind: 'text', size: 12, encoding: 'utf-16le', content: 'MIT\n' }),
  });
  assert.ok(plain.includes('<span>纯文本</span>'));
  assert.ok(plain.includes('<span>UTF-16 LE</span>'));
  assert.doesNotMatch(plain, /data-language/);
  const empty = renderPreview({
    entry: entry('.keep'),
    file: readyFile('.keep', { kind: 'text', size: 0, encoding: 'utf-8', content: '' }),
  });
  assert.match(empty, /空文件/);
  assert.doesNotMatch(empty, /files-code/);
});

test('图片沿用差异视图的预览组件，但只显示工作区一侧', () => {
  const html = renderPreview({
    entry: entry('assets/logo.png'),
    file: readyFile('assets/logo.png', {
      kind: 'image',
      size: 68,
      mediaType: 'image/png',
      content: 'iVBORw0KGgo=',
    }),
  });
  assert.match(html, /files-preview__image/);
  assert.match(html, /image-diff-pane/);
  assert.match(html, /工作区版本/);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.doesNotMatch(html, /变更前|变更后/);
});

test('抽出共享图片预览后，图片差异仍按变更前后分栏显示', () => {
  const modified = renderToStaticMarkup(
    createElement(ImageDiffView, {
      repoId: 'fixture',
      path: 'ui/logo.png',
      kind: 'modified',
      request: { staged: false },
    }),
  );
  assert.match(modified, /image-diff__panes--modified/);
  assert.match(modified, /image-diff-pane__label image-diff-pane__label--before"><span>变更前/);
  assert.match(modified, /image-diff-pane__label image-diff-pane__label--after"><span>变更后/);
  assert.equal(modified.match(/正在读取图片/g).length, 2);
  const added = renderToStaticMarkup(
    createElement(ImageDiffView, {
      repoId: 'fixture',
      path: 'ui/logo.png',
      kind: 'added',
      request: { staged: false },
    }),
  );
  assert.doesNotMatch(added, /变更前/);
  // Without a side the preview carries no before/after colouring.
  const plain = renderToStaticMarkup(
    createElement(ImagePreview, { label: '工作区版本', state: { phase: 'loading' }, alt: '' }),
  );
  assert.match(plain, /class="image-diff-pane__label"><span>工作区版本/);
});

test('二进制、过大和不支持的编码都有明确说明', () => {
  const binary = renderPreview({
    entry: entry('build.bin'),
    file: readyFile('build.bin', { kind: 'binary', size: 4096 }),
  });
  assert.match(binary, /二进制文件/);
  assert.match(binary, /4\.0 KB/);

  const hugeText = renderPreview({
    entry: entry('huge.log'),
    file: readyFile('huge.log', {
      kind: 'too-large',
      size: 3 * 1024 * 1024,
      limit: REPOSITORY_TEXT_PREVIEW_MAX_BYTES,
    }),
  });
  assert.match(hugeText, /文件过大/);
  assert.match(hugeText, /文本预览上限/);
  assert.match(hugeText, /3\.00 MB/);
  assert.match(hugeText, /files-notice--warning/);

  const hugeImage = renderPreview({
    entry: entry('photo.jpg'),
    file: readyFile('photo.jpg', {
      kind: 'too-large',
      size: 9 * 1024 * 1024,
      limit: DIFF_IMAGE_MAX_BYTES,
    }),
  });
  assert.match(hugeImage, /图片预览上限/);

  const gbk = renderPreview({
    entry: entry('gbk.txt'),
    file: readyFile('gbk.txt', { kind: 'unsupported-encoding', size: 20 }),
  });
  assert.match(gbk, /不支持的文本编码/);
  assert.match(gbk, /GBK/);
});

test('符号链接、子模块和特殊文件不读取内容，只说明原因', () => {
  const link = renderPreview({
    entry: entry('latest', 'symlink', { target: 'apps/web' }),
    file: null,
  });
  assert.match(link, /符号链接/);
  assert.match(link, /<code>apps\/web<\/code>/);
  assert.match(link, /不会跟随链接/);

  // A file that turned into a link on the server is reported the same way.
  const changed = renderPreview({
    entry: entry('config.json'),
    file: readyFile('config.json', { kind: 'symlink', target: '../shared/config.json' }),
  });
  assert.match(changed, /<code>\.\.\/shared\/config\.json<\/code>/);

  assert.match(
    renderPreview({ entry: entry('vendor', 'submodule'), file: null }),
    /嵌套仓库或子模块/,
  );
  assert.match(renderPreview({ entry: entry('fifo', 'other'), file: null }), /特殊文件/);
});

test('读取失败按状态码区分，且都可以重试', () => {
  const failed = (status, message) =>
    renderPreview({
      entry: entry('a.txt'),
      file: { phase: 'error', path: 'a.txt', status, message },
    });
  const missing = failed(404, 'Path not found');
  assert.match(missing, /文件不存在/);
  assert.match(missing, /Path not found/);
  assert.match(missing, /role="alert"/);
  assert.match(missing, />重试</);
  assert.match(failed(403, 'EACCES'), /没有读取权限/);
  assert.match(failed(undefined, 'socket hang up'), /无法读取文件/);
});

test('首次读取显示加载状态，刷新时保留旧内容并标记忙碌', () => {
  const loading = renderPreview({ entry: entry('a.ts'), file: { phase: 'loading', path: 'a.ts' } });
  assert.match(loading, /正在读取文件/);
  assert.match(loading, /aria-busy="true"/);
  const refreshing = renderPreview({
    entry: entry('a.ts'),
    file: {
      phase: 'loading',
      path: 'a.ts',
      stale: { kind: 'text', size: 3, encoding: 'utf-8', content: 'old' },
    },
  });
  assert.doesNotMatch(refreshing, /正在读取文件/);
  assert.match(refreshing, /<code>old<\/code>/);
  assert.match(refreshing, /aria-busy="true"/);
});

test('超大文本关闭语法高亮并提示原因', () => {
  const text = 'x'.repeat(HIGHLIGHT_MAX_CHARS + 1);
  const html = renderToStaticMarkup(
    createElement(CodeView, { path: 'big.ts', text, lines: 1, language: fileLanguage('big.ts') }),
  );
  assert.match(html, /已关闭语法高亮/);
  assert.match(html, /256\.0 KB/);
  const small = renderToStaticMarkup(
    createElement(CodeView, {
      path: 'small.ts',
      text: 'x',
      lines: 1,
      language: fileLanguage('small.ts'),
    }),
  );
  assert.doesNotMatch(small, /已关闭语法高亮/);
  const plain = renderToStaticMarkup(
    createElement(CodeView, { path: 'big.txt', text, lines: 1, language: null }),
  );
  assert.doesNotMatch(plain, /已关闭语法高亮/);
});

test('文件视图首屏显示只读标识、目录加载状态和可调整的树宽度', () => {
  const html = renderToStaticMarkup(createElement(FilesView, { repoId: 'fixture' }));
  assert.match(html, /aria-label="仓库文件"/);
  assert.match(html, /工作区文件/);
  assert.match(html, /只读/);
  assert.match(html, /正在读取目录/);
  assert.match(html, /aria-label="调整文件树宽度"/);
  assert.match(html, /style="width:280px"/);
  assert.match(html, /选择文件以预览/);
});

test('文件树宽度在布局偏好中持久化并限制范围', () => {
  assert.equal(readLayoutPreferences({}).filesTreeWidth, 280);
  assert.equal(readLayoutPreferences({ filesTreeWidth: 360 }).filesTreeWidth, 360);
  assert.equal(readLayoutPreferences({ filesTreeWidth: 20 }).filesTreeWidth, 200);
  assert.equal(readLayoutPreferences({ filesTreeWidth: 4000 }).filesTreeWidth, 520);
});

test('文件视图只读：只调用读取接口，不写入 HTML，也不用 display: none 隐藏内容', () => {
  const view = readFileSync(new URL('../src/components/FilesView.tsx', import.meta.url), 'utf8');
  const calls = [...view.matchAll(/repositoryApi\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['file', 'tree']);
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  for (const source of [
    view,
    readFileSync(new URL('../src/components/syntax-highlight.ts', import.meta.url), 'utf8'),
  ])
    assert.doesNotMatch(code(source), /dangerouslySetInnerHTML|innerHTML/);

  const css = readFileSync(new URL('../src/files.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /display:\s*none/);
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /import '\.\/files\.css';/);
});
