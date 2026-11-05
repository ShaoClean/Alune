// Package with ordinary Node ABI, outside Electron's rebuilt dependency tree.
import path from 'node:path';
import { mkdtemp, cp, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const parent = path.join(root, 'apps/desktop/dist');
const temporary = await mkdtemp(path.join(tmpdir(), 'alune-desktop-node-'));
await mkdir(parent, { recursive: true });
const stage = await mkdtemp(path.join(parent, '.agent-'));
try {
  const bundle = path.join(temporary, 'bundle');
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts/agent/package.mjs'), '--output', bundle],
    { stdio: 'inherit' },
  );
  await cp(bundle, stage, { recursive: true });
  const destination = path.join(parent, 'agent-runtime');
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(stage, { recursive: true, force: true });
}
