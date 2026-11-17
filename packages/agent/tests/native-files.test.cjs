const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nativeFiles } = require('../dist/adapters/files/native');
test(
  'native file port bounds reads and closes cancelled reads before returning',
  { timeout: 30000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-native-files-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const small = path.join(root, 'small');
    fs.writeFileSync(small, 'fixture 中🦊');
    assert.equal((await nativeFiles.read(small, { maxBytes: 1024 })).toString(), 'fixture 中🦊');
    await assert.rejects(
      nativeFiles.read(small, { maxBytes: 1 }),
      (e) => e.kind === 'invalid-input',
    );
    const large = path.join(root, 'large');
    const fd = fs.openSync(large, 'w');
    fs.ftruncateSync(fd, 64 * 1024 * 1024);
    fs.closeSync(fd);
    await assert.rejects(
      nativeFiles.read(large, { maxBytes: 64 * 1024 * 1024, signal: AbortSignal.timeout(1) }),
      (e) => e.name === 'TimeoutError',
    );
    fs.rmSync(large);
    await assert.rejects(
      nativeFiles.read(small, { maxBytes: 1024, signal: AbortSignal.abort() }),
      (e) => e.name === 'AbortError',
    );
    assert.equal(fs.readFileSync(small, 'utf8'), 'fixture 中🦊');
  },
);
