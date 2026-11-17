const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { viewer } = require('./log-viewer-actions-fixture.cjs');
function record(name, value) {
  if (process.env.P0_LOG_VIEWER_ACTIONS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_LOG_VIEWER_ACTIONS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
const rows = [
  {
    time: '2026-11-16T00:00:00.000Z',
    level: 'INFO',
    source: 'alpha',
    message: '消息 第一行\n第二行',
    context: {
      marker: 'Needle',
      token: '[REDACTED]',
      error: { message: 'fixture error', stack: 'not copied' },
    },
  },
  { time: '2026-11-16T00:00:01.000Z', level: 'WARN', source: 'beta', message: 'warning' },
  { time: '2026-11-16T00:00:02.000Z', level: 'ERROR', source: 'alpha', message: 'failure' },
];
const lines = [
  '2026-11-16T00:00:00.000Z INFO  [alpha] 消息 第一行\n第二行  marker=Needle token=[REDACTED] fixture error',
  '2026-11-16T00:00:01.000Z WARN  [beta] warning',
  '2026-11-16T00:00:02.000Z ERROR [alpha] failure',
];

test('P0 log viewer copy button executes frozen and current selection filtered fallback and failure notices', async (t) => {
  const results = [];
  for (const legacy of [true, false]) {
    const page = viewer(legacy);
    t.after(() => page.close());
    await page.start(rows);
    const observations = [];
    async function copy(expected, notice) {
      const before = page.controls.writes.length;
      await page.click('复制');
      assert.equal(page.controls.writes.length, before + 1);
      assert.equal(page.controls.writes.at(-1), expected);
      assert.deepEqual(page.notices(), [notice]);
      assert.equal(page.controls.timers.at(-1).ms, 2400);
      observations.push({ text: expected, notice });
    }
    await copy(lines.join('\n'), '已复制 3 条日志');
    page.change('按来源筛选', 'alpha');
    await copy([lines[0], lines[2]].join('\n'), '已复制 2 条日志');
    page.toggleLevel('ERROR');
    await copy(lines[0], '已复制 1 条日志');
    page.change('关键字搜索', { target: { value: ' missing ' } });
    assert.equal(page.entries().length, 0);
    await copy('', '已复制 0 条日志');
    page.controls.selection = '  选中文本\nUnicode 🐈\t ';
    await copy(page.controls.selection, '已复制所选内容');
    page.controls.selection = '';
    page.change('关键字搜索', { target: { value: ' needle ' } });
    await copy(lines[0], '已复制 1 条日志');
    page.controls.clipboardError = new Error('permission denied');
    const failure = '复制失败，请选中文本后使用系统快捷键复制';
    await copy(lines[0], failure);
    // An older success timer must not erase a newer, different failure notice.
    page.fireTimer(0);
    assert.deepEqual(page.notices(), [failure]);
    page.fireTimer(page.controls.timers.length - 1);
    assert.deepEqual(page.notices(), []);
    const count = page.controls.writes.length;
    page.removeClipboard();
    await page.click('复制');
    assert.equal(page.controls.writes.length, count);
    assert.deepEqual(page.notices(), [failure]);
    page.controls.clipboardError = null;
    assert.deepEqual(page.controls.bridgeCalls, []);
    assert.deepEqual(page.controls.forbiddenCalls, []);
    assert.equal(
      page.controls.recentCalls.length,
      1,
      'copy does not request history or mutate settings',
    );
    assert.equal(page.controls.recentCalls[0], 1000);
    results.push({
      legacy,
      observations,
      absentClipboardNotice: failure,
      noTransportOrDesktopEffects: true,
    });
  }
  assert.deepEqual(results[0].observations, results[1].observations);
  record('viewer-copy-contract', {
    results,
    scope:
      'Actual onClick callbacks in complete TSX modules; selection, clipboard and hook runtime are explicit test doubles. No browser permission or native clipboard claim.',
  });
});

test('P0 log viewer directory button gates bridge availability forwards no renderer path and handles failures', async (t) => {
  const results = [];
  for (const legacy of [true, false]) {
    const page = viewer(legacy);
    t.after(() => page.close());
    await page.start(rows);
    assert.equal(page.hasButton('打开日志目录'), false);
    page.setBridge(true);
    assert.equal(page.hasButton('打开日志目录'), true);
    await page.click('打开日志目录');
    assert.deepEqual(page.controls.bridgeCalls, [[]], 'no renderer path or owner supplied');
    assert.deepEqual(page.notices(), []);
    page.controls.bridgeError = new Error('fixture 拒绝打开目录');
    await page.click('打开日志目录');
    assert.deepEqual(page.notices(), ['fixture 拒绝打开目录']);
    page.controls.bridgeError = 'opaque failure';
    await page.click('打开日志目录');
    assert.deepEqual(page.notices(), ['无法打开日志目录']);
    assert.equal(page.controls.timers.at(-1).ms, 2400);
    page.fireTimer(0);
    assert.deepEqual(page.notices(), ['无法打开日志目录']);
    page.fireTimer(1);
    assert.deepEqual(page.notices(), []);
    page.setBridge(false);
    assert.equal(page.hasButton('打开日志目录'), false);
    // A retained callback after bridge removal must not invoke the old bridge.
    page.setBridge(true);
    const stale = page.button('打开日志目录').props.onClick;
    page.setBridge(false);
    stale();
    await new Promise(setImmediate);
    assert.deepEqual(page.controls.bridgeCalls, [[], [], []]);
    assert.deepEqual(page.controls.writes, []);
    assert.deepEqual(page.controls.forbiddenCalls, []);
    assert.equal(page.controls.recentCalls.length, 1);
    results.push({
      legacy,
      invocations: page.controls.bridgeCalls,
      buttonHiddenWithoutBridge: true,
      errors: ['fixture 拒绝打开目录', '无法打开日志目录'],
      noLogMutationOrClipboardEffect: true,
    });
  }
  assert.deepEqual(results[0].invocations, results[1].invocations);
  record('viewer-directory-contract', {
    results,
    scope:
      'Actual component callback and full current/frozen logging API bridge accessor. Desktop bridge is an explicit double. Native preload, main process, OS directory opening and SSH are not certified here.',
  });
});

test('P0 log viewer frozen log subscription joins on connect reconnect and cleans up pending history', async (t) => {
  const page = viewer(true);
  t.after(() => page.close());
  const pending = page.deferRecent();
  page.startPending([]);
  assert.deepEqual(page.controls.registered.sort(), [
    'connect',
    'connect_error',
    'disconnect',
    'log:entries',
  ]);
  page.event('connect');
  page.render();
  assert.equal(page.status(), '实时');
  assert.deepEqual(page.controls.socketEmits, [['logs:subscribe']]);
  page.event('log:entries', [rows[0], rows[1]]);
  pending.resolve([rows[0]]);
  await page.settle();
  assert.deepEqual(
    page.entries().map((e) => e.message),
    [rows[0].message, rows[1].message],
  );
  page.event('disconnect');
  page.render();
  assert.equal(page.status(), '已断开，正在重连…');
  page.event('connect');
  page.render();
  assert.deepEqual(page.controls.socketEmits, [['logs:subscribe'], ['logs:subscribe']]);
  page.event('log:entries', [rows[2]]);
  await page.settle();
  assert.deepEqual(
    page.entries().map((e) => e.message),
    rows.map((e) => e.message),
  );
  page.close();
  assert.equal(page.listenerCount(), 0);
  const stale = viewer(true);
  t.after(() => stale.close());
  const late = stale.deferRecent();
  stale.startPending([]);
  stale.close();
  late.resolve(rows);
  await stale.settle();
  assert.equal(stale.entries().length, 0, 'late history does not update disposed component');
  record('viewer-frozen-subscription-contract', {
    connectAndReconnect: page.controls.socketEmits,
    historyStreamMerge: rows.map((e) => e.message),
    listenersAfterCleanup: page.listenerCount(),
    disposedHistoryIgnored: true,
    scope:
      'Complete frozen component with explicit socket, API and hook stand-ins; no real Socket.IO server claim.',
  });
});

test('P0 log viewer current invalidations refresh bounded owner history coalesce and discard disposed reads', async (t) => {
  const page = viewer(false, 'fixture-owner-one');
  t.after(() => page.close());
  await page.start([rows[0]]);
  assert.equal(page.status(), '实时');
  const initialRequests = page.controls.recentCalls.length;
  page.agentEvent('repositories.changed');
  await page.settle();
  assert.equal(page.controls.recentCalls.length, initialRequests);
  const delayed = page.deferRecent();
  page.agentEvent('diagnostics.logs.changed', {
    entries: [{ message: 'UNTRUSTED_EVENT_PAYLOAD' }],
  });
  page.agentEvent('diagnostics.logs.changed');
  page.agentEvent('events.resync-required');
  assert.equal(page.controls.recentCalls.length, initialRequests + 1, 'one in-flight read');
  page.setHistory(rows);
  delayed.resolve([rows[0], rows[1]]);
  await page.settle();
  assert.equal(page.controls.recentCalls.length, initialRequests + 2, 'one coalesced refresh');
  assert.deepEqual(
    page.entries().map((e) => e.message),
    rows.map((e) => e.message),
  );
  page.agentEvent('events.resync-required');
  await page.settle();
  assert.equal(page.entries().length, 3, 'identical replay snapshot cannot duplicate rows');
  assert.equal(new Set(page.entries().map((e) => e.id)).size, 3);
  page.closeEvent();
  assert.equal(page.status(), '已断开，正在重连…');
  const late = page.deferRecent();
  page.agentEvent('diagnostics.logs.changed');
  page.close();
  assert.equal(page.listenerCount(), 0);
  late.resolve([...rows, { ...rows[2], time: '2026-11-16T00:00:03.000Z', message: 'late' }]);
  await page.settle();
  assert.equal(page.entries().length, 3);
  assert.equal(page.controls.agentOff, 1);
  assert.equal(page.controls.closeOff, 1);
  const other = viewer(false, 'fixture-owner-two');
  t.after(() => other.close());
  await other.start([{ ...rows[0], message: 'second-owner-only' }]);
  assert.deepEqual(
    other.entries().map((e) => e.message),
    ['second-owner-only'],
  );
  assert(page.controls.recentCalls.every((limit) => limit === 1000));
  assert.deepEqual(page.controls.socketEmits, []);
  assert.deepEqual(page.controls.forbiddenCalls, []);
  record('viewer-current-subscription-contract', {
    requests: page.controls.recentCalls,
    acceptedMessages: page.entries().map((e) => e.message),
    ignoresEventPayload: true,
    coalescedReads: 2,
    disposedReadIgnored: true,
    sameSnapshotDeduplicated: true,
    agentOff: page.controls.agentOff,
    closeOff: page.controls.closeOff,
    otherOwnerMessages: other.entries().map((e) => e.message),
    scope:
      'Complete current component with explicit Agent event/history/hook stand-ins; separate fixture owners. Real SQLite ownership and real stdio/durable ambiguity are separate companion assertions; no SSH/network/browser subscription claim.',
  });
});
