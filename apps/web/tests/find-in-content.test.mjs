import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIND_MATCH_LIMIT,
  compileFindPattern,
  findMatches,
  nearestMatchIndex,
} from '../src/components/find-in-content.ts';

const plain = { caseSensitive: false, wholeWord: false, regex: false };
const search = (units, query, options = {}) => {
  const merged = { ...plain, ...options };
  const pattern = compileFindPattern(query, merged);
  assert.ok(pattern && 'regex' in pattern, `pattern ${query} should compile`);
  return findMatches(units, pattern.regex, merged.wholeWord).matches.map(({ unit, start, end }) =>
    units[unit].slice(start, end),
  );
};

test('plain search escapes regex characters and ignores case by default', () => {
  assert.deepEqual(search(['foo.bar(x)', 'FOO.BAR('], 'foo.bar('), ['foo.bar(', 'FOO.BAR(']);
  assert.deepEqual(search(['fooXbar'], 'foo.bar'), []);
  assert.deepEqual(search(['Foo foo'], 'foo', { caseSensitive: true }), ['foo']);
});

test('whole word matching works for plain, regex and non-ASCII words', () => {
  assert.deepEqual(search(['id userId id_x (id)'], 'id', { wholeWord: true }), ['id', 'id']);
  assert.deepEqual(
    search(['useState useEffect reuse'], 'use\\w+', { regex: true, wholeWord: true }),
    ['useState', 'useEffect'],
  );
  assert.deepEqual(search(['中文 中文字'], '中文', { wholeWord: true }), ['中文']);
  // A match that starts or ends on punctuation needs no boundary on that edge.
  assert.deepEqual(search(['a.b x.b'], '.b', { wholeWord: true }), ['.b', '.b']);
});

test('regex mode combines with case matching and supports loose escapes', () => {
  assert.deepEqual(search(['useState UseMemo'], 'use\\w+', { regex: true, caseSensitive: true }), [
    'useState',
  ]);
  assert.deepEqual(search(['a-b c_d'], '[\\w-]+', { regex: true }), ['a-b', 'c_d']);
  assert.deepEqual(search(['line one\nline two'], '^line', { regex: true }), ['line', 'line']);
});

test('invalid regex reports an error instead of throwing', () => {
  const pattern = compileFindPattern('(', { ...plain, regex: true });
  assert.ok(pattern && 'error' in pattern);
  assert.match(pattern.error, /\S/);
  assert.equal(compileFindPattern('', plain), null);
  assert.ok('regex' in compileFindPattern('(', plain));
});

test('empty regex matches are skipped without looping', () => {
  assert.deepEqual(search(['abc'], 'x*', { regex: true }), []);
  assert.deepEqual(search(['😀a😀'], 'a?', { regex: true }), ['a']);
});

test('match count stops at the VSCode limit', () => {
  const pattern = compileFindPattern('a', plain);
  const result = findMatches(['a'.repeat(FIND_MATCH_LIMIT + 5)], pattern.regex, false);
  assert.equal(result.matches.length, FIND_MATCH_LIMIT);
  assert.equal(result.truncated, true);
});

test('refreshed results keep the nearest match after the previous position', () => {
  const matches = [
    { unit: 0, start: 4, end: 6 },
    { unit: 2, start: 0, end: 2 },
    { unit: 2, start: 8, end: 10 },
  ];
  assert.equal(nearestMatchIndex([], null), -1);
  assert.equal(nearestMatchIndex(matches, null), 0);
  assert.equal(nearestMatchIndex(matches, { unit: 1, start: 0 }), 1);
  assert.equal(nearestMatchIndex(matches, { unit: 2, start: 3 }), 2);
  assert.equal(nearestMatchIndex(matches, { unit: 5, start: 0 }), 2);
});
