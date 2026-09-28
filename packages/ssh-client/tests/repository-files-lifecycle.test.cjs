const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { SSHConnection } = require('../dist/connection-manager');
const { RepositoryFiles, RepositoryFileError } = require('../dist/repository-files');
const { REPOSITORY_TEXT_PREVIEW_MAX_BYTES } = require('../../shared/dist');
const { startSSHServer } = require('./helpers/ssh-server.cjs');

const text = '文件预览\n'.repeat(20000);
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function fixture(t, onSftp) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-preview-lifecycle-'));
  fs.writeFileSync(path.join(root, 'text.txt'), text);
  fs.writeFileSync(path.join(root, 'empty.txt'), '');
  fs.writeFileSync(path.join(root, 'pixel.png'), pixel);
  const remote = await startSSHServer({ onSftp });
  const connection = new SSHConnection(remote.options);
  connection.on('error', () => {});
  t.after(async () => {
    connection.disconnect();
    await remote.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await connection.connect();
  return { root, connection, files: new RepositoryFiles(connection) };
}

// Pause one real protocol request, keeping every other request on the normal server path.
function pauseRequest(sftp, request) {
  const handlers = sftp.listeners(request);
  sftp.removeAllListeners(request);
  return new Promise((resolve) => {
    sftp.once(request, (...args) => {
      for (const handler of handlers) sftp.on(request, handler);
      resolve(() => {
        for (const handler of handlers) handler(...args);
      });
    });
  });
}

test(
  'previews wait for the file handle CLOSE reply before ending the SFTP channel',
  { timeout: 15000 },
  async (t) => {
    let closeRequested;
    const f = await fixture(t, (sftp) => {
      pauseRequest(sftp, 'CLOSE').then(closeRequested);
    });
    for (const file of ['text.txt', 'empty.txt', 'pixel.png']) {
      const closed = new Promise((resolve) => {
        closeRequested = resolve;
      });
      let settled = false;
      const pending = f.files.read(f.root, file).finally(() => {
        settled = true;
      });
      // The server has received CLOSE but has deliberately not acknowledged it.
      const acknowledge = await closed;
      await nextTurn();
      assert.equal(settled, false, 'preview must not finish while its handle is still closing');
      acknowledge();
      const preview = await pending;
      if (file === 'pixel.png') {
        assert.equal(preview.kind, 'image');
        assert.deepEqual(Buffer.from(preview.content, 'base64'), pixel);
      } else {
        assert.equal(preview.kind, 'text');
        assert.equal(preview.content, file === 'empty.txt' ? '' : text);
      }
    }
  },
);

test(
  'a file growing past the preview limit still closes its handle before returning',
  { timeout: 15000 },
  async (t) => {
    let closeRequested;
    const closed = new Promise((resolve) => {
      closeRequested = resolve;
    });
    const f = await fixture(t, (sftp) => {
      sftp.removeAllListeners('LSTAT');
      sftp.on('LSTAT', (id) => sftp.attrs(id, { mode: 0o100644, size: 1 }));
      pauseRequest(sftp, 'CLOSE').then(closeRequested);
    });
    fs.writeFileSync(
      path.join(f.root, 'growing.txt'),
      Buffer.alloc(REPOSITORY_TEXT_PREVIEW_MAX_BYTES + 1, 0x61),
    );
    let settled = false;
    const pending = f.files.read(f.root, 'growing.txt').finally(() => {
      settled = true;
    });
    const acknowledge = await closed;
    await nextTurn();
    assert.equal(settled, false);
    acknowledge();
    assert.equal((await pending).kind, 'too-large');
  },
);

for (const request of ['OPEN', 'READ', 'CLOSE']) {
  test(
    `channel closure during ${request} is an application error and another preview can succeed`,
    { timeout: 15000 },
    async (t) => {
      let fail = true;
      const f = await fixture(t, (sftp) => {
        if (!fail) return;
        fail = false;
        sftp.removeAllListeners(request);
        sftp.once(request, () => sftp.end());
      });
      await assert.rejects(f.files.read(f.root, 'text.txt'), (error) => {
        assert.ok(error instanceof RepositoryFileError);
        assert.match(error.message, /无法读取文件：远端文件连接已中断/);
        return true;
      });
      assert.equal(f.connection.connected, true);
      assert.equal((await f.files.read(f.root, 'text.txt')).content, text);
      assert.equal((await f.files.read(f.root, 'pixel.png')).kind, 'image');
    },
  );
}

test(
  'switching between overlapping text and image previews drains all SFTP channels',
  { timeout: 15000 },
  async (t) => {
    let active = 0;
    let closed = 0;
    let allClosed;
    const channelsClosed = new Promise((resolve) => {
      allClosed = resolve;
    });
    const f = await fixture(t, (sftp) => {
      active++;
      sftp.once('close', () => {
        active--;
        if (++closed === 12) allClosed();
      });
    });
    const previews = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        f.files.read(f.root, index % 2 ? 'pixel.png' : 'text.txt'),
      ),
    );
    for (const [index, preview] of previews.entries()) {
      if (index % 2) assert.deepEqual(Buffer.from(preview.content, 'base64'), pixel);
      else assert.equal(preview.content, text);
    }
    await channelsClosed;
    assert.equal(active, 0);
    assert.equal(f.connection.connected, true);
  },
);

test(
  'disconnecting during a preview rejects it and reconnecting restores browsing',
  { timeout: 15000 },
  async (t) => {
    let fail = true;
    const f = await fixture(t, (sftp, client) => {
      if (!fail) return;
      fail = false;
      sftp.removeAllListeners('READ');
      sftp.once('READ', () => client.end());
    });
    const disconnected = once(f.connection.client, 'close');
    await assert.rejects(f.files.read(f.root, 'text.txt'), RepositoryFileError);
    await disconnected;
    assert.equal(f.connection.connected, false);
    await f.connection.connect();
    assert.equal((await f.files.read(f.root, 'text.txt')).content, text);
  },
);

test(
  'a stalled read times out without a late exception and retry opens a usable channel',
  { timeout: 25000 },
  async (t) => {
    let fail = true;
    const f = await fixture(t, (sftp) => {
      if (!fail) return;
      fail = false;
      sftp.removeAllListeners('READ');
      sftp.on('READ', () => {});
    });
    await assert.rejects(f.files.read(f.root, 'text.txt'), (error) => {
      assert.ok(error instanceof RepositoryFileError);
      assert.match(error.message, /远端文件操作超时/);
      return true;
    });
    assert.equal((await f.files.read(f.root, 'text.txt')).content, text);
  },
);
