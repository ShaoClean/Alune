import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = path.join(root, 'apps/desktop');
const target = path.join(desktop, 'dist/app');
const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
const rootPackage = await readJSON(path.join(root, 'package.json'));
const server = await readJSON(path.join(root, 'apps/server/package.json'));
const desktopPackage = await readJSON(path.join(desktop, 'package.json'));
await mkdir(target, { recursive: true });
for (const [source, destination] of [
  ['apps/server/dist', 'server'],
  ['apps/web/dist', 'web'],
  ['packages/shared/dist', 'packages/shared/dist'],
  ['packages/ssh-client/dist', 'packages/ssh-client/dist'],
]) {
  await rm(path.join(target, destination), { recursive: true, force: true });
  await cp(path.join(root, source), path.join(target, destination), { recursive: true });
}
for (const file of await readdir(target)) {
  if (file.endsWith('.cjs')) await rm(path.join(target, file));
}
for (const file of await readdir(path.join(desktop, 'src'))) {
  if (file.endsWith('.cjs')) await cp(path.join(desktop, 'src', file), path.join(target, file));
}
for (const name of ['shared', 'ssh-client']) {
  const manifest = await readJSON(path.join(root, `packages/${name}/package.json`));
  delete manifest.devDependencies;
  delete manifest.scripts;
  await writeFile(path.join(target, `packages/${name}/package.json`), JSON.stringify(manifest, null, 2));
}
await writeFile(path.join(target, 'package.json'), JSON.stringify({
  name: 'remote-git-desktop',
  version: rootPackage.version,
  description: 'RemoteGit 桌面远程 Git 工作区',
  author: 'RemoteGit',
  private: true,
  main: 'main.cjs',
  dependencies: {
    ...server.dependencies,
    ...desktopPackage.dependencies,
    '@remote-git/shared': 'file:packages/shared',
    '@remote-git/ssh-client': 'file:packages/ssh-client',
  },
  devDependencies: { electron: rootPackage.devDependencies.electron },
}, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Install and rebuild inside the staged app: the web server's Node ABI stays intact.
run('npm', ['install', '--omit=dev', '--omit=optional', '--ignore-scripts', '--install-links', '--workspaces=false', '--no-audit', '--no-fund']);
run(process.execPath, [
  path.join(root, 'node_modules/@electron/rebuild/lib/cli.js'),
  '--force',
  '--only', 'better-sqlite3',
  '--types', 'prod',
  '--version', rootPackage.devDependencies.electron,
  '--module-dir', target,
]);
