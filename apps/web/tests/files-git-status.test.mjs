import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  fileDecoration,
  fileStatusIndex,
  filesStatusRevision,
} from '../src/components/files-git-status.ts';
import { TreeItem } from '../src/components/FilesView.tsx';
import { parseStatus } from '../../../packages/ssh-client/src/git-status.ts';

const change = (path, status, extra = {}) => ({ path, status, staged: false, ...extra });
const entry = (path, kind = 'file') => ({ path, name: path.split('/').at(-1), kind });
const decoration = (files, path, kind) => fileDecoration(fileStatusIndex(files), entry(path, kind));

test('all changed states have distinct text badges; clean and ignored files stay undecorated', () => {
  for (const [status, badge] of Object.entries({
    added: 'A',
    untracked: 'U',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
  })) {
    assert.equal(decoration([change('file.txt', status)], 'file.txt').badge, badge);
  }
  assert.equal(
    decoration([change('file.txt', 'modified', { conflicted: true })], 'file.txt').badge,
    '!',
  );
  assert.equal(decoration([change('ignored.txt', 'ignored')], 'ignored.txt'), undefined);
  assert.equal(decoration([change('other.txt', 'modified')], 'clean.txt'), undefined);
});

test('mixed index/worktree records use deterministic priorities, preserving staged additions', () => {
  for (const [statuses, expected] of [
    [['modified', 'added'], 'added'],
    [['renamed', 'modified'], 'renamed'],
    [['copied', 'modified'], 'copied'],
    [['deleted', 'added'], 'deleted'],
  ]) {
    const files = statuses.map((status, i) => change('file.txt', status, { staged: i === 0 }));
    assert.equal(decoration(files, 'file.txt').status, expected);
    assert.equal(decoration([...files].reverse(), 'file.txt').status, expected);
    files.push(change('file.txt', 'modified', { conflicted: true }));
    assert.equal(decoration(files, 'file.txt').status, 'conflicted');
  }
});

test('directories summarize descendants without coloring clean siblings or rename sources', () => {
  const files = [
    change('src/nested/new.txt', 'untracked'),
    change('src/conflict.txt', 'modified', { conflicted: true }),
    change('dst/renamed.txt', 'renamed', { oldPath: 'src/original.txt' }),
  ];
  assert.equal(decoration(files, 'src', 'directory').status, 'conflicted');
  assert.equal(decoration(files, 'src/nested', 'directory').summary, true);
  assert.equal(decoration(files, 'src/nested', 'directory').badge, '•');
  assert.equal(decoration(files, 'src/clean.txt'), undefined);
  assert.equal(decoration(files, 'src-copy', 'directory'), undefined);
  assert.equal(decoration(files, 'src/original.txt'), undefined);
  assert.equal(
    decoration(files, 'src'),
    undefined,
    'a file with the same prefix is not a directory',
  );
});

test('literal paths and directory records do not leak decorations across path boundaries', () => {
  const paths = [
    '中文/with space.txt',
    'literal\\name.txt',
    'line\nbreak.txt',
    '__proto__',
    'constructor',
  ];
  const files = paths.map((path) => change(path, 'modified'));
  for (const path of paths) assert.equal(decoration(files, path).status, 'modified');
  assert.equal(decoration(files, 'literal/name.txt'), undefined);
  assert.equal(
    decoration([change('nested/', 'untracked', { kind: 'directory' })], 'nested', 'submodule')
      .status,
    'untracked',
  );
});

test('new snapshots remove stale colors and identical/reordered polls have stable revisions', () => {
  const files = [change('a', 'added'), change('b', 'modified')];
  assert.equal(filesStatusRevision(files), filesStatusRevision([...files].reverse()));
  assert.notEqual(filesStatusRevision(files), filesStatusRevision([change('a', 'deleted')]));
  assert.equal(fileStatusIndex([]).direct.size, 0);
  assert.equal(decoration([], 'a'), undefined);
  assert.equal(fileStatusIndex([]).descendants.size, 0);
});

test('rendered tree rows expose status text while preserving navigation, selection and special hints', () => {
  const rowEntry = { ...entry('new.txt', 'symlink'), target: 'target.txt' };
  const html = renderToStaticMarkup(
    createElement(TreeItem, {
      row: { type: 'entry', entry: rowEntry, level: 2, position: 1, setSize: 3, parent: 'src' },
      decoration: decoration([change('new.txt', 'untracked')], 'new.txt'),
      selected: true,
      focusable: true,
      loading: false,
      failed: false,
      itemRef() {},
      onOpen() {},
    }),
  );
  for (const text of [
    'files-tree__item--git-untracked',
    'files-tree__item--selected',
    'aria-selected="true"',
    'tabindex="0"',
    'aria-level="2"',
    '符号链接 → target.txt，未跟踪',
    'files-tree__git-status',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /aria-hidden="true">U<\/span>/);
});

test('real Git status preserves decorations through staging, renaming, deletion and a clean commit', () => {
  const repo = mkdtempSync(join(tmpdir(), 'alune-file-colors-'));
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
  const status = () =>
    parseStatus(git('status', '--porcelain=v2', '-z', '--untracked-files=all')).files;
  try {
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    for (const path of ['clean.txt', 'modified.txt', 'old.txt', 'deleted.txt'])
      writeFileSync(join(repo, path), `Original ${path}\n`);
    git('add', '.');
    git('commit', '-qm', 'Baseline');
    writeFileSync(join(repo, 'modified.txt'), 'Changed\n');
    writeFileSync(join(repo, 'added.txt'), 'Added\n');
    git('add', 'added.txt');
    writeFileSync(join(repo, 'added.txt'), 'Edited after staging\n');
    mkdirSync(join(repo, 'new folder'));
    writeFileSync(join(repo, 'new folder/中文.txt'), 'New\n');
    git('mv', 'old.txt', 'renamed.txt');
    rmSync(join(repo, 'deleted.txt'));
    const files = status();
    for (const [path, expected] of Object.entries({
      'modified.txt': 'modified',
      'added.txt': 'added',
      'new folder/中文.txt': 'untracked',
      'renamed.txt': 'renamed',
      'deleted.txt': 'deleted',
    }))
      assert.equal(decoration(files, path).status, expected);
    assert.equal(decoration(files, 'clean.txt'), undefined);
    git('add', '.');
    git('commit', '-qm', 'Save all');
    assert.equal(fileStatusIndex(status()).direct.size, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
