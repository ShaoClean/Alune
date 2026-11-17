import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
      ALUNE_AGENT_DATA_DIR: path.join(directory, 'directory remote agent'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(directory, 'empty.gitconfig'),
    },
  });
  try {
    execFileSync(
      process.execPath,
      [
        path.resolve(desktop, '../../scripts/agent/ssh-bundle.mjs'),
        path.join(desktop, 'dist/agent-runtime'),
        path.join(directory, 'agent'),
      ],
      { stdio: 'pipe' },
    );
  } catch (e) {
    peer.close();
    throw e;
  }
  return {
    env: {
      ALUNE_TEST_DIRECTORY_ACCESS: JSON.stringify({
        port: peer.port,
        hostKey: createHash('sha256').update(Buffer.from(peer.publicKey, 'base64')).digest('hex'),
        notes: fs.realpathSync.native(notes),
      }),
    },
    verify() {
      assert.equal(fs.readFileSync(path.join(notes, 'note.txt'), 'utf8'), 'keep outside bytes\n');
    },
    close() {
      peer.close();
    },
  };
}
