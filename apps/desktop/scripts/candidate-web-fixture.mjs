import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
export async function candidateWebFixture(directory) {
  const root = fileURLToPath(new URL('../../web/', import.meta.url));
  const keys = ['ALUNE_AGENT_DATA_DIR', 'ALUNE_AGENT_LEGACY_DIR', 'ALUNE_UI_AUDIT'];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ALUNE_AGENT_DATA_DIR = path.join(directory, 'web-agent');
  process.env.ALUNE_AGENT_LEGACY_DIR = path.join(directory, 'absent-web-legacy');
  process.env.ALUNE_UI_AUDIT = '1';
  let invite = '',
    server;
  const capture = (message) => {
    const match = String(message).match(/#alune-session=([a-f0-9]{64})/);
    if (match) invite = match[1];
  };
  const restore = () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
  try {
    server = await createServer({
      root,
      mode: 'agent',
      server: { host: '127.0.0.1', port: 0 },
      customLogger: {
        info: capture,
        warn: capture,
        warnOnce: capture,
        error: capture,
        clearScreen() {},
        hasWarned: false,
        hasErrorLogged() {
          return false;
        },
      },
    });
    await server.listen();
    assert.equal(invite.length, 64);
    const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
    return {
      env: { ALUNE_TEST_WEB_URL: origin + '/#alune-session=' + invite },
      async close() {
        try {
          await server.close();
        } finally {
          restore();
        }
      },
    };
  } catch (error) {
    try {
      await server?.close();
    } finally {
      restore();
    }
    throw error;
  }
}
