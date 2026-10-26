import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackContext } from '../src/components/feedback-context.ts';
import { createFeedbackStore } from '../src/stores/feedbackStore.ts';
import { gitApi } from '../src/api/index.ts';
import { useRepositoryStore } from '../src/stores/repositoryStore.ts';
import { useBranchSwitch } from '../src/hooks/useBranchSwitch.tsx';
import { AluneConfirmContext } from '../src/components/AluneModal.tsx';

function setup(t, run, confirm = () => false) {
  const events = [];
  t.mock.method(gitApi, 'switchBranch', run);
  const feedback = createFeedbackStore();
  const publish = feedback.getState().publish;
  t.mock.method(feedback.getState(), 'publish', (event) => {
    events.push(event.title);
    return publish(event);
  });
  t.mock.method(useRepositoryStore, 'getState', () => ({
    fetchBranches: async (id) => events.push(`branches:${id}`),
    fetchLog: async (id) => events.push(`log:${id}`),
  }));
  let hook;
  function Probe() {
    hook = useBranchSwitch('repo', () => events.push('refresh'));
    return null;
  }
  renderToStaticMarkup(
    React.createElement(
      AluneConfirmContext.Provider,
      { value: { confirm } },
      React.createElement(
        FeedbackContext.Provider,
        { value: feedback },
        React.createElement(Probe),
      ),
    ),
  );
  return { hook, events };
}
const conflict = {
  response: { data: { code: 'LOCAL_BRANCH_EXISTS', localName: 'demo', message: '名称冲突' } },
};

test('远程分支切换静默刷新数据，并忽略重复点击', async (t) => {
  let complete;
  let calls = 0;
  const { hook, events } = setup(t, (...args) => {
    assert.deepEqual(args, ['repo', 'remotes/origin/demo', undefined, true]);
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const operation = hook.switchBranch('remotes/origin/demo', true);
  await hook.switchBranch('remotes/other/demo');
  assert.equal(calls, 1);
  complete({ branch: 'tracking-name' });
  await operation;
  assert.deepEqual(events, ['branches:repo', 'log:repo', 'refresh']);
});

for (const [upstream, notice] of [
  [undefined, '已切换到现有本地分支“demo”，它未跟踪 origin/demo。'],
  [
    'refs/remotes/upstream/demo',
    '已切换到现有本地分支“demo”，它未跟踪 origin/demo（当前跟踪 upstream/demo）。',
  ],
]) {
  test(`名称冲突时直接切换到现有本地分支并提示（上游：${upstream ?? '无'}）`, async (t) => {
    const calls = [];
    const { hook, events } = setup(
      t,
      async (...args) => {
        calls.push(args);
        if (calls.length === 1)
          throw { response: { data: { ...conflict.response.data, upstream } } };
        return { branch: 'demo' };
      },
      () => assert.fail('不应弹出确认框'),
    );
    await hook.switchBranch('remotes/origin/demo', true);
    assert.deepEqual(calls, [
      ['repo', 'remotes/origin/demo', undefined, true],
      ['repo', 'demo', undefined, false],
    ]);
    assert.deepEqual(events, ['branches:repo', 'log:repo', 'refresh', notice]);
  });
}

test('Git or connection errors are shown and release the pending guard', async (t) => {
  const { hook, events } = setup(t, async () => {
    throw new Error('SSH unavailable');
  });
  await hook.switchBranch('remotes/origin/demo', true);
  await hook.switchBranch('main');
  assert.deepEqual(events, ['SSH unavailable', 'SSH unavailable']);
});
