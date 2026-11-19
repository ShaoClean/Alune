const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const desktop = path.resolve(__dirname, '..');
const read = (name) => fs.readFile(path.join(desktop, name), 'utf8');

test('desktop startup exits if the standalone Agent is unavailable', async () => {
  const isolated = path.resolve('isolated');
  const calls = [], paths = { appData: isolated, userData: path.join(isolated, 'Alune') };
  const app = {
    setName() {}, setPath: (key, value) => { paths[key] = value; },
    getPath: (key) => paths[key], requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), on() {},
    dock: { setIcon() {} }, exit: (code) => calls.push(['exit', code]),
  };
  const failure = new Error('independent runtime unavailable');
  const context = {
    __dirname: desktop, console: { error() {} },
    process: { env: {}, argv: ['electron', 'dist/app'], platform: 'linux', on() {} },
    require(name) {
      if (name === 'electron') return { app, dialog: { showErrorBox() {} } };
      if (name === 'node:crypto' || name === 'node:path') return require(name);
      if (name === 'node:fs') return { mkdirSync() {} };
      if (name === './workspace-preferences.cjs') return {};
      if (name === './external-links.cjs') return {};
      if (name === './log-window.cjs') return { createLogWindow: () => ({ contents() {} }) };
      if (name === './desktop-agent.cjs') return {
        async startDesktopAgent(options) {
          calls.push(['agent', options.dataDir]);
          throw failure;
        },
      };
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  };
  vm.runInNewContext(await read('src/main.cjs'), context);
  await new Promise(setImmediate);
  assert.deepEqual(calls, [['agent', path.join(isolated, 'Alune')], ['exit', 1]]);
});

test('desktop staging refreshes application files and preserves the standalone runtime', async (t) => {
  const { stageDesktop } = await import(pathToFileURL(path.join(desktop, 'scripts/stage.mjs')));
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'alune-stage-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  async function put(name, value) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
  }
  await put('package.json', JSON.stringify({ version: '9.8.7', devDependencies: { electron: '40.0.0' } }));
  await put('apps/desktop/package.json', await read('package.json'));
  await put('apps/web/dist/index.html', '<!doctype html>');
  await put('apps/desktop/assets/icon.png', 'fixture');
  await fs.cp(path.join(desktop, 'src'), path.join(root, 'apps/desktop/src'), { recursive: true });
  for (const name of ['domain', 'protocol', 'agent-client']) {
    await put(`packages/${name}/dist/index.js`, 'module.exports = {};');
    await put(`packages/${name}/package.json`, JSON.stringify({
      name: '@alune/' + name, version: '1.0.0', main: 'dist/index.js',
      scripts: { build: 'never execute' }, devDependencies: { typescript: '*' },
    }));
  }
  const stale = ['web/assets/stale.js', 'node_modules/.package-lock.json', 'package-lock.json'];
  await put('apps/desktop/dist/agent-runtime/manifest.json', 'independent Node ABI');
  for (const candidate of [false, true]) {
    const relative = 'apps/desktop/dist/' + (candidate ? 'candidate-app' : 'app');
    // Repeated staging must also clean an existing stage, not only a fresh checkout.
    for (let run = 0; run < 2; run++) {
      for (const file of stale) await put(relative + '/' + file, 'stale');
      let installed = 0;
      const target = await stageDesktop(root, { candidate, install: async (directory) => {
        assert.equal(directory, path.join(root, relative));
        for (const file of stale) await assert.rejects(fs.access(path.join(directory, file)), { code: 'ENOENT' });
        installed++;
      } });
      assert.equal(installed, 1);
      const manifest = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
      assert.equal(manifest.main, candidate ? 'candidate-main.cjs' : 'main.cjs');
      assert.equal(manifest.version, '9.8.7');
      assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
        '@alune/agent-client', '@alune/domain', '@alune/protocol',
        'builder-util-runtime', 'electron-updater', 'semver', 'undici',
      ]);
      assert.deepEqual((await fs.readdir(path.join(target, 'packages'))).sort(), ['agent-client', 'domain', 'protocol']);
      for (const name of ['agent-import.cjs', 'legacy-agent-secrets.cjs', 'candidate-main.cjs',
        'candidate-smoke.cjs', 'appearance-smoke.cjs', 'code-appearance-smoke.cjs',
        'dialogs-smoke.cjs', 'settings-shell-smoke.cjs', 'smoke-window.cjs', 'smoke-updater.cjs'])
        await fs.access(path.join(target, name));
      for (const name of ['domain', 'protocol', 'agent-client']) {
        const pkg = JSON.parse(await fs.readFile(path.join(target, 'packages', name, 'package.json')));
        assert.equal(pkg.devDependencies, undefined);
        assert.equal(pkg.scripts, undefined);
      }
    }
  }
  assert.equal(await fs.readFile(path.join(root, 'apps/desktop/dist/agent-runtime/manifest.json'), 'utf8'), 'independent Node ABI');
  await assert.rejects(stageDesktop(root, { install: () => { throw Error('install failed'); } }), /install failed/);
});

test('desktop commands build and launch the standalone Agent application', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const name of ['agent', 'agent-client', 'domain', 'protocol'])
    assert.equal(pkg.devDependencies['@alune/' + name], '*');
  assert.match(pkg.scripts.build, /stage\.mjs.*agent:stage/);
  assert.equal(pkg.scripts.prepack, 'npm run build');
  assert.equal(pkg.scripts.predist, 'npm run build');
  assert.equal(pkg.scripts.start, 'electron dist/app');
  const main = await read('src/main.cjs');
  assert.match(main, /'agent', 'workspace\.json'/);
  assert.match(main, /additionalArguments: \['--alune-agent-ui'\]/);
  assert.match(await read('src/log-window.cjs'), /additionalArguments: \['--alune-agent-ui'\]/);
  assert.match(await read('src/candidate-main.cjs'), /require\('\.\/main\.cjs'\)/);
  assert.doesNotMatch(await read('electron-builder.cjs'), /node-pty|\.node|packages\/\*\*/);
});
