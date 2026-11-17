const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateHealth,
  validateVersion,
  validateCapabilities,
  validateSubscription,
  validateTaskQuery,
  validateTaskResult,
} = require('../dist');

test('core result schemas reject structurally valid JSON with incorrect protocol meanings', () => {
  assert.equal(
    validateHealth({ status: 'ok', agentId: 'host', sessionId: 'session', lifecycle: 'session' })
      .status,
    'ok',
  );
  assert.throws(() =>
    validateHealth({ status: 'ok', agentId: '/repo', sessionId: 'session', lifecycle: 'session' }),
  );
  assert.throws(() => validateVersion({ version: '1', protocol: { major: 2, minor: 0 } }));
  assert.throws(() => validateCapabilities({ capabilities: [''] }));
  assert.throws(() => validateCapabilities({ capabilities: [42] }));
  assert.deepEqual(validateSubscription({ subscribed: [], sessionId: 'session' }).subscribed, []);
  assert.throws(() => validateSubscription({ subscribed: ['*'] }));
});
test('task queries are unambiguous and task results preserve explicit unknown outcomes', () => {
  assert.deepEqual(validateTaskQuery({ requestId: 'r1' }), { requestId: 'r1' });
  for (const query of [
    {},
    { requestId: 'r1', taskId: 't1' },
    { requestId: 0, taskId: 't1' },
    { taskId: '' },
  ])
    assert.throws(() => validateTaskQuery(query));
  assert.deepEqual(validateTaskResult({ scope: 'session', task: null }), {
    scope: 'session',
    task: null,
  });
  const task = {
    taskId: 't1',
    requestId: 'r1',
    method: 'git.commit',
    effect: 'mutation',
    state: 'unknown',
    outcome: 'unknown',
    startedAt: 1,
  };
  assert.equal(validateTaskResult({ scope: 'session', task }).task.outcome, 'unknown');
  assert.throws(() => validateTaskResult({ scope: 'persistent', task }));
  assert.throws(() =>
    validateTaskResult({ scope: 'session', task: { ...task, state: 'successfully-retried' } }),
  );
});
