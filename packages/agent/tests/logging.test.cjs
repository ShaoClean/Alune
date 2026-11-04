const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LogStore, redactText, redactContext } = require('../dist/adapters/logging');

test('diagnostics never expose ciphertext or master material and keep valid JSON values', () => {
  const ciphertext = 'aes-gcm:' + Buffer.alloc(48, 7).toString('base64');
  const safe = 'safe-storage:' + Buffer.alloc(48, 8).toString('base64');
  assert(!redactText(`failed ${ciphertext} and ${safe}`).includes(ciphertext));
  assert(!redactText(safe).includes(safe));
  const error = Object.assign(new Error(ciphertext), { name: ciphertext, code: ciphertext });
  assert(!JSON.stringify(redactContext({ error })).includes(ciphertext));
  const context = redactContext({
    ciphertext,
    encryptedKey: 'unknown-format',
    encryptedCredentials: 'secret',
    masterKey: 'private',
    duration: Infinity,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context)), {
    ciphertext: '[REDACTED]',
    encryptedKey: '[REDACTED]',
    encryptedCredentials: '[REDACTED]',
    masterKey: '[REDACTED]',
    duration: null,
  });
  const inherited = redactContext(JSON.parse('{"__proto__":{"token":"secret"},"safe":true}'));
  assert.equal(Object.getPrototypeOf(inherited), null);
  assert.equal(inherited.safe, true);
  assert.equal(inherited.__proto__.token, '[REDACTED]');
});

test('the real disk log and live listener receive only redacted entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-log-'));
  const store = new LogStore(root);
  const entries = [];
  try {
    store.subscribe((entry) => entries.push(entry));
    const cipher = 'aes-gcm:' + Buffer.alloc(64, 9).toString('base64');
    store.write('ERROR', 'fixture', `migration failed: ${cipher}`, { encryptedKey: cipher });
    store.write('ERROR', cipher, 'source must also be redacted');
    store.flush();
    const disk = fs
      .readdirSync(path.join(root, 'logs'))
      .filter((n) => n.endsWith('.log'))
      .map((n) => fs.readFileSync(path.join(root, 'logs', n), 'utf8'))
      .join('');
    assert(!disk.includes(cipher));
    assert(!JSON.stringify(entries).includes(cipher));
    assert(disk.includes('[REDACTED]'));
    assert.equal(store.recent().at(-1).source, '[REDACTED]');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('older on-disk entries are redacted again before being returned to a client', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-old-log-'));
  let store = new LogStore(root);
  try {
    store.write('ERROR', 'fixture', 'create file');
    store.close();
    const file = fs.readdirSync(path.join(root, 'logs')).find((n) => n.endsWith('.log'));
    const ciphertext = 'safe-storage:' + Buffer.alloc(48, 2).toString('base64');
    fs.appendFileSync(
      path.join(root, 'logs', file),
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'ERROR',
        source: ciphertext,
        message: ciphertext,
        context: { encryptedKey: ciphertext },
        extraCiphertext: ciphertext,
      }) + '\n',
    );
    store = new LogStore(root);
    const rows = store.recent();
    assert.equal(rows.at(-1).source, '[REDACTED]');
    assert(!JSON.stringify(rows).includes(ciphertext));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
