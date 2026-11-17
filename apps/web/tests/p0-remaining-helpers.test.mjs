import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as themes from '../src/code-themes.ts';
import * as font from '../src/stores/codeAppearance.ts';
import { useSyncStatusStore, syncDetail, syncLabel } from '../src/stores/syncStatusStore.ts';
import { LOCAL_GROUP_ID, repositoryGroupId, repositorySourceLabel } from '../src/stores/repositorySource.ts';
import { removeSessionRepositories } from '../src/stores/repositorySession.ts';
import { isExpandable } from '../src/components/files-tree.ts';
import { formatBytes } from '../src/components/ImageDiffView.tsx';
import { displayText } from '../src/components/FilesView.tsx';
import { discardResultMessage } from '../src/components/DiscardChangesDialog.tsx';
import { commitDisabled } from '../src/components/ChangesView.tsx';
import { remainingConflictBlocks } from '../src/components/ConflictResolver.tsx';
import { repositoryApi } from '../src/api/index.ts';
import { EMPTY_DRAFT } from '../src/stores/commitDraftStore.ts';

test('P0 code theme vocabulary, limits, CSS token projection and color validation retain exact boundaries', () => {
  assert.deepEqual(themes.TOKEN_GROUPS, ['comment','keyword','string','number','constant','function','type','tag','property','regex','variable','punctuation','operator','inserted','deleted']);
  assert.deepEqual(themes.DIFF_COLOR_KEYS, {
    'diffEditor.insertedLineBackground': 'added', 'diffEditor.removedLineBackground': 'removed',
    'diffEditor.insertedTextBackground': 'wordAdded', 'diffEditor.removedTextBackground': 'wordRemoved',
  });
  assert.deepEqual(themes.DEFAULT_CODE_THEME_IDS, { light: 'catppuccin-latte', dark: 'catppuccin-mocha' });
  assert.equal(themes.MAX_THEME_BYTES, 1048576);
  assert.equal(themes.MAX_CUSTOM_THEMES, 32);
  for (const value of ['#abc', '#aBcD', '#ABCDEF', '#11223344']) assert.equal(themes.isThemeColor(value), true);
  for (const value of [null, 1, '#ab', '#12345', '#1234567', '#ggg', 'red', 'url(x)', '#fff\n']) assert.equal(themes.isThemeColor(value), false);
  assert.deepEqual(themes.prismTokenStyle('unknown', ['keyword']), {
    color: 'var(--syntax-keyword)', fontStyle: 'var(--syntax-keyword-style)',
    fontWeight: 'var(--syntax-keyword-weight)', textDecoration: 'var(--syntax-keyword-decoration)',
  });
  assert.equal(themes.prismTokenStyle('unknown', ['unknown']), undefined);
  assert.equal(themes.prismTokenStyle('comment', ['keyword']).color, 'var(--syntax-comment)');
});

test('P0 font defaults and malformed, control, length, rounding and clamped inputs are exact', () => {
  assert.deepEqual([font.DEFAULT_CODE_FONT, font.DEFAULT_CODE_FONT_SIZE, font.MIN_CODE_FONT_SIZE, font.MAX_CODE_FONT_SIZE], ['SFMono-Regular',13,10,32]);
  assert.deepEqual(font.DEFAULT_CODE_APPEARANCE, { lightTheme:'catppuccin-latte',darkTheme:'catppuccin-mocha',fontFamily:'SFMono-Regular',fontSize:13,customThemes:[] });
  for (const value of [null, '', '  ', 'x'.repeat(101), 'bad\u0000font', 'bad\nfont']) assert.equal(font.readCodeFontFamily(value), 'SFMono-Regular');
  assert.equal(font.readCodeFontFamily('  Family Name  '), 'Family Name');
  assert.equal(font.readCodeFontFamily('x'.repeat(100)), 'x'.repeat(100));
  for (const [value, expected] of [[null,13],['14',13],[NaN,13],[Infinity,13],[-1,10],[9.9,10],[10,10],[13.5,14],[32,32],[33,32]]) assert.equal(font.readCodeFontSize(value), expected);
  assert.deepEqual(EMPTY_DRAFT, { message: '', description: '' });
});

test('P0 sync progress and completion cannot cross repository ownership', () => {
  assert.deepEqual(['fetch','pull','push'].map(syncLabel), ['获取','拉取','推送']);
  assert.deepEqual(['fetch','pull','push'].map(op => syncDetail(op)), ['正在从 origin 获取更新…','正在从 origin 拉取…','正在推送到 origin…']);
  assert.equal(syncDetail('push', true), '正在强制推送到 origin…');
  const store = useSyncStatusStore;
  store.getState().startSync('a', 'push', { force: true });
  store.getState().setProgress('other', 'unrelated');
  assert.equal(store.getState().progress, null);
  store.getState().setProgress('a', '42%');
  const active = store.getState();
  store.getState().finishSync('other');
  assert.equal(store.getState(), active);
  assert.equal(store.getState().progress, '42%');
  assert.equal(store.getState().force, true);
  store.getState().finishSync('a');
  for (const key of ['repoId','operation','detail','progress']) assert.equal(store.getState()[key], null);
  assert.equal(store.getState().force, false);
  store.getState().setProgress('a', 'late');
  assert.equal(store.getState().progress, null);
});

test('P0 repository grouping, session removal and directory expandability preserve exact ownership', () => {
  assert.equal(LOCAL_GROUP_ID, '@local');
  assert.equal(repositoryGroupId({ source: 'local', connectionId: 'wrong' }), '@local');
  assert.equal(repositoryGroupId({ source: 'ssh', connectionId: 'remote' }), 'remote');
  assert.equal(repositorySourceLabel({ source: 'local' }), '本机');
  assert.equal(repositorySourceLabel({ source: 'ssh' }), 'SSH');
  const session = { ids: ['a','b','c'], activeId: 'b' };
  assert.deepEqual(removeSessionRepositories(session, ['b']), { ids:['a','c'], activeId:'c' });
  assert.deepEqual(removeSessionRepositories(session, ['b','c']), { ids:['a'], activeId:'a' });
  assert.deepEqual(removeSessionRepositories(session, ['a','b','c']), { ids:[], activeId:null });
  assert.deepEqual(removeSessionRepositories(session, ['b'], 'a'), { ids:['a','c'], activeId:'a' });
  assert.deepEqual(session, { ids:['a','b','c'], activeId:'b' });
  for (const kind of ['directory','file','symlink','submodule','other']) assert.equal(isExpandable({kind}), kind === 'directory');
});

test('P0 image sizes, display newlines, commit eligibility and discard outcomes preserve unknown results', () => {
  for (const [size, expected] of [[0,'0 B'],[1023,'1023 B'],[1024,'1.0 KB'],[1048575,'1024.0 KB'],[1048576,'1.00 MB'],[1572864,'1.50 MB']]) assert.equal(formatBytes(size),expected);
  for (const [input, expected] of [['',{text:'',lines:1,crlf:false}],['a\r\nb\r\n',{text:'a\nb',lines:2,crlf:true}],['a\rb\n\n',{text:'a\nb\n',lines:3,crlf:false}]]) assert.deepEqual(displayText(input),expected);
  for (const busy of [false,true]) for (const staged of [0,1]) for (const message of ['','  ','x']) assert.equal(commitDisabled(busy,staged,message), busy || staged === 0 || message.trim() === '');
  assert.equal(discardResultMessage({restored:2,deleted:1,remaining:0,unknown:0}), '已恢复 2 个文件，已删除 1 个未跟踪文件');
  assert.equal(discardResultMessage({restored:0,deleted:0,remaining:2,unknown:1}), '已恢复 0 个文件，已删除 0 个未跟踪文件；2 个文件未完成；1 个文件的结果无法确认');
});

test('P0 remaining conflict blocks counts actual markers and safely handles deleted or unreadable previews', async () => {
  const original = repositoryApi.file;
  const calls = [];
  try {
    repositoryApi.file = async (...args) => { calls.push(args); return {kind:'text',content:'<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n'}; };
    assert.equal(await remainingConflictBlocks('repo','src/a.txt'), 1);
    assert.deepEqual(calls, [['repo','src/a.txt']]);
    repositoryApi.file = async () => ({kind:'text',content:'resolved\n'});
    assert.equal(await remainingConflictBlocks('repo','a'), 0);
    repositoryApi.file = async () => ({kind:'binary'});
    assert.equal(await remainingConflictBlocks('repo','a'), 0);
    repositoryApi.file = async () => { throw Error('deleted side'); };
    assert.equal(await remainingConflictBlocks('repo','a'), 0);
  } finally { repositoryApi.file = original; }
});
