import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { hostFingerprint } from '../src/features/connections/fingerprint.ts';
test('standard OpenSSH and hexadecimal host pins resolve to identical bytes, never a truncated or MD5 key', () => {
  const bytes = createHash('sha256').update('a distinct target').digest();
  assert.equal(
    hostFingerprint('SHA256:' + bytes.toString('base64').replace(/=+$/, '')),
    bytes.toString('hex'),
  );
  assert.equal(hostFingerprint(bytes.toString('hex').toUpperCase()), bytes.toString('hex'));
  assert.equal(hostFingerprint('MD5:00:11:22'), undefined);
  assert.equal(hostFingerprint('SHA256:' + bytes.toString('base64').slice(0, 30)), undefined);
});
