import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../src/stores/workspaceLayout.ts';
import { GRAPH_ROW_HEIGHT, GRAPH_LANE_WIDTH } from '../src/components/commit-graph.ts';
import { FILE_DECORATIONS } from '../src/components/files-git-status.ts';
import { conflictKindLabels, conflictHint, operationNames, shortHash, conflictedFiles } from '../src/components/conflict-model.ts';
import { terminalStateLabel } from '../src/stores/terminalState.ts';
import { connectionStatus, connectionStatusLabel } from '../src/stores/connectionStatus.ts';
import { horizontalPlacement, orderedIds, orderItems, canMoveTreeItem, moveBeforeOrAfter } from '../src/stores/sidebarOrder.ts';

// Explicit P0 oracles; modules differ from frozen P0 only in type-only import owners.
test('layout dimensions and clamp rounding preserve exact boundaries', () => {
  assert.deepEqual([
    layout.SIDEBAR_MIN, layout.SIDEBAR_MAX, layout.CHANGES_MIN, layout.CHANGES_MAX,
    layout.INSPECTOR_MIN, layout.FILES_TREE_MIN, layout.FILES_TREE_MAX,
    layout.FILES_STACKED_WIDTH, layout.RESIZE_WIDTH, layout.COMPACT_WIDTH,
  ], [184, 320, 280, 520, 360, 200, 520, 640, 4, 900]);
  for (const [value, expected] of [[-1, 184], [184, 184], [200.49, 200], [200.5, 201], [320, 320], [999, 320]])
    assert.equal(layout.clampWidth(value, 184, 320), expected);
});

test('commit graph dimensions retain exact pixel constants', () => {
  assert.equal(GRAPH_ROW_HEIGHT, 36);
  assert.equal(GRAPH_LANE_WIDTH, 18);
});

test('file decorations preserve the complete status badge and label vocabulary', () => {
  assert.deepEqual(FILE_DECORATIONS, {
    added: { badge: 'A', label: '新增' }, untracked: { badge: 'U', label: '未跟踪' },
    modified: { badge: 'M', label: '已修改' }, deleted: { badge: 'D', label: '已删除' },
    renamed: { badge: 'R', label: '已重命名' }, copied: { badge: 'C', label: '已复制' },
    conflicted: { badge: '!', label: '存在冲突' }, ignored: { badge: '', label: '已忽略' },
  });
});

test('conflict labels hints short hashes and conflict selection preserve exact values', () => {
  assert.deepEqual(conflictKindLabels, {
    'both-modified': '双方修改', 'both-added': '双方新增', 'both-deleted': '双方删除',
    'added-by-us': '当前新增', 'added-by-them': '传入新增',
    'deleted-by-us': '当前删除', 'deleted-by-them': '传入删除',
  });
  assert.deepEqual(operationNames, { merge: '合并', rebase: '变基', 'cherry-pick': '拣选', revert: '还原' });
  for (const [kind, expected] of [
    [undefined, '此文件有未解决的冲突。处理内容后标记为已解决。'],
    ['both-modified', '双方都修改了此文件。逐块选择要保留的内容后标记为已解决，或整体采用一方。'],
    ['both-added', '双方都新增了同名文件。逐块选择要保留的内容后标记为已解决，或整体采用一方。'],
    ['both-deleted', '双方都删除了此路径，通常是双方把它重命名到了不同位置。确认删除后即可继续。'],
    ['added-by-us', '只有当前一方有此路径，通常来自重命名冲突。请确认保留还是删除。'],
    ['added-by-them', '只有传入的一方有此路径，通常来自重命名冲突。请确认保留还是删除。'],
    ['deleted-by-us', '当前一方删除了此文件，传入的一方修改了它。请选择保留传入的版本或删除。'],
    ['deleted-by-them', '当前一方修改了此文件，传入的一方删除了它。请选择保留当前版本或删除。'],
  ]) assert.equal(conflictHint(kind), expected);
  for (const [input, expected] of [[undefined, ''], ['', ''], ['abc', 'abc'], ['abcdef123456', 'abcdef1']])
    assert.equal(shortHash(input), expected);
  const first = { path: 'a', conflicted: true }, second = { path: 'b', conflicted: false }, third = { path: 'c', conflicted: true };
  const files = [first, second, third];
  assert.deepEqual(conflictedFiles(files), [first, third]);
  assert.equal(conflictedFiles(files)[0], first);
  assert.deepEqual(files, [first, second, third]);
  assert.deepEqual(conflictedFiles([]), []);
});

test('terminal and connection labels distinguish live failed unknown and exited states', () => {
  for (const [state, label] of [['connecting', '连接中'], ['running', '运行中'], ['failed', '启动失败'], ['disconnected', '已断开']])
    assert.equal(terminalStateLabel({ state }), label);
  assert.equal(terminalStateLabel({ state: 'exited', exitCode: 0 }), '已退出 · 0');
  assert.equal(terminalStateLabel({ state: 'exited', exitCode: 127 }), '已退出 · 127');
  assert.equal(terminalStateLabel({ state: 'exited', signal: 'SIGTERM' }), '已退出 · SIGTERM');
  assert.equal(terminalStateLabel({ state: 'exited' }), '已退出 · 信号');
  assert.equal(connectionStatus(), 'unknown');
  assert.equal(connectionStatusLabel(), '未测试');
  for (const [status, label] of [['connected', '在线'], ['connecting', '连接中'], ['disconnected', '已断开'], ['error', '连接失败'], ['unknown', '未测试']]) {
    assert.equal(connectionStatus({ status }), status);
    assert.equal(connectionStatusLabel({ status }), label);
  }
});

test('sidebar placement and ordering preserve host ownership and immutable stable ordering', () => {
  assert.equal(horizontalPlacement(59, 10, 100), 'before');
  assert.equal(horizontalPlacement(60, 10, 100), 'after');
  assert.equal(horizontalPlacement(110, 10, 100), 'after');
  assert.deepEqual(orderedIds(['a', 'b', 'c', 'a'], ['gone', 'b', 'b']), ['b', 'a', 'c']);
  assert.deepEqual(orderedIds([]), []);
  const a = { id: 'a' }, b = { id: 'b' };
  assert.deepEqual(orderItems([a, b], ['b', 'gone']), [b, a]);
  assert.equal(orderItems([a, b], ['b'])[0], b);
  const conn = id => ({ kind: 'connection', id });
  const repo = (id, connectionId) => ({ kind: 'repository', id, connectionId });
  assert.equal(canMoveTreeItem(conn('a'), conn('b')), true);
  assert.equal(canMoveTreeItem(conn('a'), conn('a')), false);
  assert.equal(canMoveTreeItem(repo('a', 'host'), repo('b', 'host')), true);
  assert.equal(canMoveTreeItem(repo('a', 'host'), repo('b', 'other')), false);
  assert.equal(canMoveTreeItem(conn('a'), repo('b', 'host')), false);
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveBeforeOrAfter(ids, 'a', 'c', 'after'), ['b', 'c', 'a']);
  assert.deepEqual(moveBeforeOrAfter(ids, 'c', 'a', 'before'), ['c', 'a', 'b']);
  for (const [from, to, placement] of [['missing', 'a', 'before'], ['a', 'missing', 'after'], ['a', 'a', 'after'], ['a', 'b', 'before']])
    assert.equal(moveBeforeOrAfter(ids, from, to, placement), ids);
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
