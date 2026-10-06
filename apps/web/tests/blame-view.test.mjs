import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blameGroups, blameRelativeDate } from '../src/components/BlameView.tsx';

test('only consecutive lines from the same commit are visually merged', () => {
  const lines = ['a', 'a', 'b', 'a', '0', '0'].map((hash, index) => ({ line: index + 1, hash }));
  assert.deepEqual(
    blameGroups(lines).map((group) => group.map((line) => line.line)),
    [[1, 2], [3], [4], [5, 6]],
  );
});

test('old blame dates remain relative while hover retains the exact date', () => {
  const now = Date.UTC(2026, 9, 5);
  assert.equal(blameRelativeDate(new Date(now - 60_000).toISOString(), now), '1分钟前');
  assert.equal(blameRelativeDate(new Date(now - 400 * 86400_000).toISOString(), now), '1年前');
  assert.equal(blameRelativeDate('invalid', now), '—');
});
