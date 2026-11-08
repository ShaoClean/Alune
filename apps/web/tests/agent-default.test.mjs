import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as publicApi from '../src/api/index.ts';
import { aiApi } from '../src/api/ai.ts';
import { loggingApi } from '../src/api/logging.ts';
import { proxyApi } from '../src/api/proxy.ts';
import { connectUiAgent } from '../src/api/ui-agent.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every uninstalled public API method rejects instead of succeeding or calling HTTP', async () => {
  let checked = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = () => assert.fail('HTTP fallback attempted');
  try {
    for (const api of [...Object.values(publicApi), aiApi, loggingApi, proxyApi]) {
      for (const [name, invoke] of Object.entries(api)) {
        assert.equal(typeof invoke, 'function', name);
        await assert.rejects(invoke(), /Agent 尚未连接/, name);
        checked++;
      }
    }
    assert.ok(checked > 100, 'all public facade groups were checked');
  } finally {
    globalThis.fetch = previous;
  }
});

test('ordinary browser startup without an Agent invitation fails before installation', async () => {
  const globals = {
    window: {},
    location: { hash: '', pathname: '/', search: '', href: 'http://127.0.0.1:5173/' },
    sessionStorage: { getItem: () => null },
    WebSocket: class {
      constructor() {
        assert.fail('unauthenticated socket opened');
      }
    },
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  try {
    await assert.rejects(
      connectUiAgent(async () => assert.fail('mounted without Agent')),
      /完整工作区链接/,
    );
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('normal Vite configuration and production sources contain only the Agent transport', () => {
  const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert.match(config, /import\('\.\/agent-dev'\)\)\.agentDev\(\)/);
  assert.doesNotMatch(config, /mode\s*===\s*['"]agent|proxy\s*:/);
  assert.match(config, /host: '127\.0\.0\.1'/);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dependency of ['axios', 'socket.io-client'])
    assert.equal(manifest.dependencies[dependency], undefined);
  function check(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) check(path);
      else if (/\.[jt]sx?$/.test(path)) {
        const source = readFileSync(path, 'utf8');
        assert.doesNotMatch(
          source,
          /\baxios\b|socket\.io-client|terminalExecutor|baseURL\s*:/,
          path,
        );
        assert.doesNotMatch(source, /import\.meta\.env\.MODE\s*!==\s*['"]agent/, path);
      }
    }
  }
  check(join(root, 'src'));
});
