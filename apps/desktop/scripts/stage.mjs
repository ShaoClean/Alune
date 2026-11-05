import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const desktop = path.join(root, 'apps/desktop');
const candidate = process.argv.includes('--candidate');
const target = path.join(desktop, 'dist', candidate ? 'candidate-app' : 'app');
const workspaces = candidate
  ? ['domain', 'protocol', 'agent-client']
  : ['domain', 'protocol', 'agent-client', 'agent', 'shared', 'ssh-client'];
const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));
const rootPackage = await readJSON(path.join(root, 'package.json'));
const server = candidate ? null : await readJSON(path.join(root, 'apps/server/package.json'));
const desktopPackage = await readJSON(path.join(desktop, 'package.json'));
await mkdir(target, { recursive: true });
for (const [source, destination] of [
  ...(!candidate
    ? [
        ['apps/server/dist', 'server'],
        ['packages/agent/bin', 'packages/agent/bin'],
      ]
    : []),
  ['apps/web/dist', 'web'],
  ['apps/desktop/assets', 'assets'],
  ...workspaces.map((name) => ['packages/' + name + '/dist', 'packages/' + name + '/dist']),
]) {
  await rm(path.join(target, destination), { recursive: true, force: true });
  await cp(path.join(root, source), path.join(target, destination), { recursive: true });
}
for (const file of await readdir(target)) {
  if (file.endsWith('.cjs')) await rm(path.join(target, file));
}
for (const file of await readdir(path.join(desktop, 'src'))) {
  if (
    candidate &&
    (['legacy-backend.cjs', 'smoke.cjs'].includes(file) ||
      (file.endsWith('-smoke.cjs') &&
        ![
          'candidate-smoke.cjs',
          'appearance-smoke.cjs',
          'code-appearance-smoke.cjs',
          'settings-shell-smoke.cjs',
          'dialogs-smoke.cjs',
        ].includes(file)))
  )
    continue;
  if (file.endsWith('.cjs')) await cp(path.join(desktop, 'src', file), path.join(target, file));
}
for (const name of workspaces) {
  const manifest = await readJSON(path.join(root, `packages/${name}/package.json`));
  delete manifest.devDependencies;
  delete manifest.scripts;
  await writeFile(
    path.join(target, `packages/${name}/package.json`),
    JSON.stringify(manifest, null, 2),
  );
}
await writeFile(
  path.join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'alune-desktop',
      version: rootPackage.version,
      description: 'Alune 本地与 SSH Git 工作区',
      author: 'Alune',
      private: true,
      main: candidate ? 'candidate-main.cjs' : 'main.cjs',
      dependencies: {
        ...server?.dependencies,
        ...desktopPackage.dependencies,
        ...Object.fromEntries(
          workspaces.map((name) => ['@alune/' + name, 'file:packages/' + name]),
        ),
      },
      devDependencies: { electron: rootPackage.devDependencies.electron },
    },
    null,
    2,
  ),
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: target,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// npm keeps an installed file: dependency whose version is unchanged, so a
// re-stage would leave stale workspace builds; drop them to force a fresh copy.
await rm(path.join(target, 'node_modules/@alune'), { recursive: true, force: true });
// Install and rebuild inside the staged app: the web server's Node ABI stays intact.
run('npm', [
  'install',
  '--omit=dev',
  '--omit=optional',
  '--ignore-scripts',
  '--install-links',
  '--workspaces=false',
  '--no-audit',
  '--no-fund',
]);
if (!candidate)
  run(process.execPath, [
    path.join(root, 'node_modules/@electron/rebuild/lib/cli.js'),
    '--force',
    '--only',
    'better-sqlite3,node-pty',
    '--types',
    'prod',
    '--version',
    rootPackage.devDependencies.electron,
    '--module-dir',
    target,
  ]);
if (!candidate) run(process.execPath, [path.join(root, 'scripts/prepare-pty.mjs'), target]);
