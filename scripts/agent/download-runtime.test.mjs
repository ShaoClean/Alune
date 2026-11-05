import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadRuntime } from './download-runtime.mjs';
test('an official runtime GET can recover from connect timeout and a gateway error before any archive is installed', async () => {
  let calls = 0;
  const waits = [];
  const bytes = await downloadRuntime('https://nodejs.org/test', 5, {
    backoff: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      if (++calls === 1)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
        });
      return calls === 2 ? new Response('', { status: 504 }) : new Response('hello');
    },
  });
  assert.equal(bytes.toString(), 'hello');
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(calls, 3);
});
test('permanent errors and oversized or cancelled downloads do not retry', async () => {
  for (const [response, pattern] of [
    [new Response('', { status: 404 }), /404/],
    [new Response('oversize'), /size limit/],
  ]) {
    let calls = 0;
    await assert.rejects(
      downloadRuntime('https://nodejs.org/test', 3, {
        fetchImpl: async () => {
          calls++;
          return response;
        },
        backoff: assert.fail,
      }),
      pattern,
    );
    assert.equal(calls, 1);
  }
  const c = new AbortController();
  let calls = 0;
  await assert.rejects(
    downloadRuntime('https://nodejs.org/test', 8, {
      signal: c.signal,
      fetchImpl: async () => {
        calls++;
        c.abort();
        return new Response('', { status: 503 });
      },
      backoff: assert.fail,
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    downloadRuntime('https://nodejs.org/test', 3, {
      fetchImpl: async () => {
        calls++;
        return new Response('', { status: 502 });
      },
      backoff: async () => {},
    }),
    /502/,
  );
  assert.equal(calls, 3);
});

test('a reset during the response discards partial archive bytes', async () => {
  let requests = 0;
  const bytes = await downloadRuntime('https://nodejs.org/test', 10, {
    backoff: async () => {},
    fetchImpl: async () => {
      if (++requests !== 1) return new Response('complete');
      return {
        ok: true,
        body: (async function* () {
          yield Buffer.from('old');
          throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        })(),
      };
    },
  });
  assert.equal(requests, 2);
  assert.equal(bytes.toString(), 'complete');
});
