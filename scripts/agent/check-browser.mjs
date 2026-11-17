import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { builtinModules } from 'node:module';

const root = fileURLToPath(new URL('../..', import.meta.url));
const entry = path.join(root, 'packages/agent-client/dist/browser.js');
const builtins = new Set([...builtinModules, 'electron', 'ssh2', 'better-sqlite3', 'node-pty']);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-client-browser-'));
try {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'error',
    plugins: [
      {
        name: 'reject-node-boundary',
        enforce: 'pre',
        resolveId(id) {
          if (id.startsWith('node:') || builtins.has(id))
            throw new Error(`Node module entered browser client: ${id}`);
        },
      },
    ],
    build: {
      write: false,
      emptyOutDir: true,
      outDir: temp,
      lib: { entry, formats: ['es'], name: 'AluneClient' },
      minify: false,
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const code = outputs
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n');
  assert(code.includes('AgentClient'));
  assert(!code.includes('__vite-browser-external'));
  assert(!/require\(["'](?:node:|electron|ssh2|better-sqlite3|node-pty)/.test(code));
  process.stdout.write(
    `Browser client bundled without Node/native dependencies (${Buffer.byteLength(code)} bytes).\n`,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
