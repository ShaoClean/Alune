// Run the existing encrypted SSH scenario with two *packaged* Agents and
// the packaged SDK. The temporary harness contains no legacy workspace or
// development node_modules. Missing test-support dependencies must fail here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const checkout = fileURLToPath(new URL('../..', import.meta.url));
if (process.argv.length !== 3)
  throw Error('Usage: node scripts/agent/test-ssh-isolated.mjs PACKAGED_AGENT');
const pkg = await realpath(process.argv[2]),
  tmp = await mkdtemp(path.join(os.tmpdir(), 'alune-isolated-ssh-'));
try {
  const bundle = path.join(tmp, 'bundle'),
    root = path.join(tmp, 'test');
  await cp(pkg, bundle, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const { target } = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  assert.equal(target, process.platform + '-' + process.arch);
  const list = [
    'scripts/agent/test-ssh-packaged.mjs',
    'scripts/agent/ssh-bundle.mjs',
    'packages/agent/tests/settings-fixture.cjs',
    'packages/agent/tests/collaboration-provider.cjs',
    'packages/agent/tests/terminal-scenario.cjs',
    'packages/agent/tests/helpers/proxy-fixture.cjs',
    'packages/agent/tests/fixtures/proxy-test-cert.pem',
    'packages/agent/tests/fixtures/proxy-test-key.pem',
  ];
  for (const file of list) {
    const to = path.join(root, file);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(path.join(checkout, file), to);
  }
  const link = async (from, to) => {
    await mkdir(path.dirname(to), { recursive: true });
    await symlink(from, to, process.platform === 'win32' ? 'junction' : 'dir');
  };
  await link(path.join(bundle, 'node_modules'), path.join(root, 'node_modules'));
  for (const pkg of ['agent', 'agent-client'])
    await link(
      path.join(bundle, 'node_modules', '@alune', pkg, 'dist'),
      path.join(root, 'packages', pkg, 'dist'),
    );
  const node = path.join(
    bundle,
    process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node',
  );
  const env = { ...process.env };
  for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  // Check the actual child loader as well as the files the parent supplied.
  execFileSync(
    node,
    [
      '-e',
      `const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    for(const name of ['@alune/shared','@alune/ssh-client','server','electron','node-gyp'])assert.throws(()=>require.resolve(name),{code:'MODULE_NOT_FOUND'});
    const root=fs.realpathSync(process.argv[1])+path.sep;
    for(const name of ['@alune/agent','@alune/agent-client/node','@alune/protocol','ssh2','better-sqlite3','node-pty'])
      assert.ok(fs.realpathSync(require.resolve(name)).startsWith(root),name+' escaped the bundle');
  `,
      bundle,
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  execFileSync(node, [path.join(root, 'scripts/agent/test-ssh-packaged.mjs'), bundle], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  console.log(
    'Isolated SSH acceptance passed with the bundled Node, SDK and native modules; no server, shared or legacy SSH workspace.',
  );
} finally {
  await rm(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
