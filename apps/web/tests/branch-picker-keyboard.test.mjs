import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveActiveIndex } from '../src/components/branch-picker-navigation.ts';

test('分支下拉框方向键在首尾循环，空列表没有高亮项', () => {
  assert.equal(moveActiveIndex(0, 1, 3), 1);
  assert.equal(moveActiveIndex(2, 1, 3), 0);
  assert.equal(moveActiveIndex(0, -1, 3), 2);
  assert.equal(moveActiveIndex(-1, 1, 3), 0);
  assert.equal(moveActiveIndex(-1, -1, 3), 2);
  assert.equal(moveActiveIndex(5, 1, 3), 0);
  assert.equal(moveActiveIndex(0, 1, 0), -1);
});

test('分支下拉框采用 combobox + listbox，焦点留在筛选框', () => {
  const source = readFileSync(
    new URL('../src/components/BranchPicker.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-selected=/);
  assert.match(source, /afterOpenChange=[\s\S]*?search\.current\?\.focus\(\)/);
  // Enter shares the click path, which skips the current branch and in-flight switches.
  assert.match(source, /choose\(options\[active\]\)/);
  assert.match(source, /onClick=\{\(\) => choose\(item\)\}/);
  assert.match(source, /const choose = [\s\S]*?item\.isCurrent \|\| switching !== null\) return;/);
  assert.match(source, /scrollIntoView\(\{ block: 'nearest' \}\)/);
});
