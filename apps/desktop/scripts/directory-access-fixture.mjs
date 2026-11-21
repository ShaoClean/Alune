import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fixtures from '../../../packages/agent/tests/helpers/proxy-fixture.cjs';

export async function directoryAccessFixture(directory) {
  const desktop = fileURLToPath(new URL('..', import.meta.url));
  const notes = path.join(directory, 'explicit notes'),
    login = path.join(directory, 'directory SSH');
  fs.mkdirSync(notes);
  fs.mkdirSync(login);
  fs.writeFileSync(path.join(notes, 'note.txt'), 'keep outside bytes\n');
  const peer = await fixtures.forwardingSSH({
    cwd: login,
    environment: {
      HOME: login,
      USERPROFILE: login,
      ALUNE_AGENT_DATA_DIR: path.join(directory, 'directory remote agent'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(directory, 'empty.gitconfig'),
    },
  });
  const runtime = path.join(desktop, 'dist/agent-runtime');
  const target = process.platform + '-' + process.arch;
  const bundle = path.join(directory, 'agent', 'ssh-bundles', target);
  let downloads = 0;
  const mirror = createServer((request, response) => {
    const { version } = JSON.parse(fs.readFileSync(path.join(bundle, 'release.json'), 'utf8'));
    if (request.url !== `/alune-agent-${version}-${target}.tar.gz`) {
      response.writeHead(404).end();
      return;
    }
    downloads++;
    const archive = path.join(bundle, 'agent.tar.gz');
    response.setHeader('Content-Length', fs.statSync(archive).size);
    fs.createReadStream(archive).pipe(response);
  });
  try {
    execFileSync(
      process.execPath,
      [
        path.resolve(desktop, '../../scripts/agent/ssh-bundle.mjs'),
        runtime,
        path.join(directory, 'agent'),
      ],
      { stdio: 'pipe' },
    );
    mirror.listen(0, '127.0.0.1');
    await once(mirror, 'listening');
  } catch (e) {
    peer.close();
    throw e;
  }
  return {
    env: {
      ALUNE_AGENT_RELEASE_MIRROR: `http://127.0.0.1:${mirror.address().port}/`,
      ALUNE_TEST_DIRECTORY_ACCESS: JSON.stringify({
        port: peer.port,
        hostKey: createHash('sha256').update(Buffer.from(peer.publicKey, 'base64')).digest('hex'),
        notes: fs.realpathSync.native(notes),
      }),
    },
    verify() {
      assert.equal(downloads, 1, 'The remote fixture installs once and reconnects from cache');
      assert.equal(fs.readFileSync(path.join(notes, 'note.txt'), 'utf8'), 'keep outside bytes\n');
    },
    close() {
      mirror.close();
      peer.close();
      // Release the installed executable and database before deleting the fixture on Windows.
      if (fs.existsSync(path.join(login, '.alune-ssh/daemon/server-runtime.json'))) {
        const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8'));
        execFileSync(path.join(runtime, manifest.node.executable), [
          path.join(runtime, 'node_modules/@alune/agent/bin/alune-agent.cjs'), 'daemon', 'stop',
        ], { env: { ...process.env, HOME: login, USERPROFILE: login }, timeout: 15000 });
      }
    },
  };
}
