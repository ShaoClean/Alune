import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, Input, Radio } from 'antd';
import { gitApi } from '../src/api/index.ts';
import { useRepositoryStore } from '../src/stores/repositoryStore.ts';
import { useBranchSwitch } from '../src/hooks/useBranchSwitch.tsx';

function setup(t, run, confirm = () => {}) {
  const events = [];
  t.mock.method(gitApi, 'switchBranch', run);
  t.mock.method(App, 'useApp', () => ({
    modal: { confirm },
    message: { success: (value) => events.push(value), error: (value) => events.push(value) },
  }));
  t.mock.method(useRepositoryStore, 'getState', () => ({
    fetchBranches: async (id) => events.push(`branches:${id}`),
    fetchLog: async (id) => events.push(`log:${id}`),
  }));
  let hook;
  function Probe() {
    hook = useBranchSwitch('repo', () => events.push('refresh'));
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  return { hook, events };
}
const conflict = {
  response: { data: { code: 'LOCAL_BRANCH_EXISTS', localName: 'demo', message: '名称冲突' } },
};
function find(element, type) {
  if (element?.type === type) return element;
  for (const child of React.Children.toArray(element?.props?.children)) {
    if (typeof child !== 'object') continue;
    const result = find(child, type);
    if (result) return result;
  }
}

test('remote success reports actual local name, refreshes data, and ignores duplicate clicks', async (t) => {
  let complete;
  let calls = 0;
  const { hook, events } = setup(t, () => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const operation = hook.switchBranch('remotes/origin/demo');
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
        if (choice === 'cancel') return options.onCancel();
        if (choice === 'create') {
          find(options.content, Radio.Group).props.onChange({ target: { value: 'create' } });
          find(options.content, Input).props.onChange({ target: { value: 'new/demo' } });
        }
        options.onOk();
      },
    );
    await hook.switchBranch('remotes/origin/demo');
    assert.deepEqual(
      calls,
      choice === 'cancel'
        ? [['repo', 'remotes/origin/demo', undefined]]
        : [
            ['repo', 'remotes/origin/demo', undefined],
            [
              'repo',
              choice === 'existing' ? 'demo' : 'remotes/origin/demo',
              choice === 'existing' ? undefined : 'new/demo',
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
  await hook.switchBranch('remotes/origin/demo');
  await hook.switchBranch('main');
  assert.deepEqual(events, ['SSH unavailable', 'SSH unavailable']);
});
