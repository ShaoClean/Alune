import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const [workspace, ...extra] = process.argv.slice(2);
if (!['agent', 'web'].includes(workspace) || extra.length)
  throw Error('Usage: test-workspace.mjs agent|web');
const directory = path.join(root, workspace === 'agent' ? 'packages/agent' : 'apps/web');
const extension = workspace === 'agent' ? '.test.cjs' : '.test.mjs';
const files = fs.readdirSync(path.join(directory, 'tests'))
  .filter(file => file.endsWith(extension))
  .sort().map(file => path.join('tests', file));
if (!files.length) throw Error('No workspace tests found');
const args = workspace === 'web' ? ['--import', './tests/resolve-ts.mjs', '--test'] : ['--test', '--test-concurrency=2', '--test-timeout=300000'];
const child = spawn(process.execPath, [...args, ...files], { cwd: directory, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) { console.error('Workspace tests ended with ' + signal); process.exitCode = 1; }
  else process.exitCode = code ?? 1;
});
