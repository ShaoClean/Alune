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

test('remote success reports actual local name, refreshes data, and ignores duplicate clicks', async (t) => {
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
  assert.deepEqual(events, ['已切换到“tracking-name”', 'branches:repo', 'log:repo', 'refresh']);
});

for (const choice of ['existing', 'create', 'cancel']) {
  test(`conflict choice: ${choice}`, async (t) => {
    const calls = [];
    const { hook, events } = setup(
      t,
      async (...args) => {
        calls.push(args);
        if (calls.length === 1) throw conflict;
        return { branch: choice === 'existing' ? 'demo' : 'new/demo' };
      },
      (options) => {
        if (choice === 'cancel') return false;
        if (choice === 'create')
          options.content.props.onChange({ existing: false, name: 'new/demo' });
        options.onOk();
        return true;
      },
    );
    await hook.switchBranch('remotes/origin/demo', true);
    assert.deepEqual(
      calls,
      choice === 'cancel'
        ? [['repo', 'remotes/origin/demo', undefined, true]]
        : [
            ['repo', 'remotes/origin/demo', undefined, true],
            [
              'repo',
              choice === 'existing' ? 'demo' : 'remotes/origin/demo',
              choice === 'existing' ? undefined : 'new/demo',
              choice === 'existing' ? false : true,
            ],
          ],
    );
    assert.equal(events.includes('refresh'), choice !== 'cancel');
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
