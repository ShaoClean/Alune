import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const workspaces = ['domain', 'protocol', 'agent-client'];
const readJSON = async (file) => JSON.parse(await readFile(file, 'utf8'));

function installDependencies(target) {
  const result = spawnSync('npm', [
    'install', '--omit=dev', '--omit=optional', '--ignore-scripts',
    '--install-links', '--workspaces=false', '--no-audit', '--no-fund',
  ], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Desktop dependency installation failed: ' + result.status);
}

// The candidate artifact is only a compatibility name, never a different executor.
export async function stageDesktop(sourceRoot = root, {
  candidate = false,
  install = installDependencies,
} = {}) {
  const desktop = path.join(sourceRoot, 'apps/desktop');
  const target = path.join(desktop, 'dist', candidate ? 'candidate-app' : 'app');
  const rootPackage = await readJSON(path.join(sourceRoot, 'package.json'));
  const desktopPackage = await readJSON(path.join(desktop, 'package.json'));
  // A fresh generated tree removes old server/packages, native modules and locks.
  // Keep the sibling agent-runtime intact: it uses ordinary Node, not Electron ABI.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const [source, destination] of [
    ['apps/web/dist', 'web'],
    ['apps/desktop/assets', 'assets'],
    ...workspaces.map((name) => ['packages/' + name + '/dist', 'packages/' + name + '/dist']),
  ]) {
    await cp(path.join(sourceRoot, source), path.join(target, destination), { recursive: true });
  }
  for (const file of await readdir(path.join(desktop, 'src'))) {
    if (file.endsWith('-smoke.cjs') && ![
      'candidate-smoke.cjs', 'appearance-smoke.cjs', 'code-appearance-smoke.cjs',
      'settings-shell-smoke.cjs', 'dialogs-smoke.cjs',
    ].includes(file)) continue;
    if (file.endsWith('.cjs')) await cp(path.join(desktop, 'src', file), path.join(target, file));
  }
  for (const name of workspaces) {
    const manifest = await readJSON(path.join(sourceRoot, `packages/${name}/package.json`));
    delete manifest.devDependencies;
    delete manifest.scripts;
    await writeFile(path.join(target, `packages/${name}/package.json`), JSON.stringify(manifest, null, 2));
  }
  await writeFile(path.join(target, 'package.json'), JSON.stringify({
    name: 'alune-desktop',
    version: rootPackage.version,
    description: 'Alune 本地与 SSH Git 工作区',
    author: 'Alune',
    private: true,
    main: candidate ? 'candidate-main.cjs' : 'main.cjs',
    dependencies: {
      ...desktopPackage.dependencies,
      ...Object.fromEntries(workspaces.map((name) => ['@alune/' + name, 'file:packages/' + name])),
    },
    devDependencies: { electron: rootPackage.devDependencies.electron },
  }, null, 2));
  // No server dependencies or Electron native rebuilds belong in this tree.
  await install(target);
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--candidate'))
    throw new Error('Usage: stage.mjs [--candidate]');
  await stageDesktop(root, { candidate: process.argv.includes('--candidate') });
}
