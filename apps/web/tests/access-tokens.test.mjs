import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessTokenApi } from '../src/api/index.ts';
import { useAccessTokensStore } from '../src/stores/accessTokensStore.ts';

test('saving a token retires older metadata reads so they cannot restore a deleted credential', async () => {
  const list = accessTokenApi.list;
  const old = { revision: 'old', tokens: [{ id: 'deleted', name: 'Old' }] };
  const latest = { revision: 'latest', tokens: [] };
  let resolve;
  accessTokenApi.list = () =>
    new Promise((done) => {
      resolve = done;
    });
  try {
    const pending = useAccessTokensStore.getState().load();
    useAccessTokensStore.getState().accept(latest);
    resolve(old);
    await pending;
    assert.equal(useAccessTokensStore.getState().settings, latest);
    assert.equal(useAccessTokensStore.getState().loading, false);
  } finally {
    accessTokenApi.list = list;
  }
});

test('a late failure cannot hide metadata refreshed by a newer socket event', async () => {
  const list = accessTokenApi.list;
  let reject;
  const latest = { revision: 'refreshed', tokens: [{ id: 'stable-id', name: 'Renamed' }] };
  accessTokenApi.list = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  try {
    const older = useAccessTokensStore.getState().load();
    accessTokenApi.list = async () => latest;
    await useAccessTokensStore.getState().load();
    reject(new Error('stale failure'));
    await older;
    assert.equal(useAccessTokensStore.getState().settings, latest);
    assert.equal(useAccessTokensStore.getState().error, '');
  } finally {
    accessTokenApi.list = list;
  }
});
