const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLfsPointer } = require('../dist');
const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 123\n`;
test('LFS model recognizes complete pointers without accepting fragments or unsafe sizes', () => {
  assert.deepEqual(parseLfsPointer(pointer), { oid: 'a'.repeat(64), size: 123 });
  assert.deepEqual(parseLfsPointer(pointer.replaceAll('\n', '\r\n')), parseLfsPointer(pointer));
  for (const text of [
    pointer + 'size 123\n',
    'prefix\n' + pointer,
    pointer.replace('123', '9007199254740992'),
    pointer.replace('123', '-1'),
    pointer.replace('123', '0123'),
    pointer + 'unknown extension\n',
    'x'.repeat(1025),
  ])
    assert.equal(parseLfsPointer(text), null);
});
