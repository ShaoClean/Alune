import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
const uiRoot = new URL('../../../packages/ui/src/', import.meta.url).pathname;
const files = [...sources(root), ...sources(uiRoot)].map((path) => ({
  name: path.startsWith(uiRoot) ? 'ui/' + relative(uiRoot, path) : relative(root, path),
  text: readFileSync(path, 'utf8'),
}));
const antdImports = (text) =>
  [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)].flatMap((match) =>
    match[1].split(',').map((name) => name.trim().replace(/^type\s+/, '')),
  );

// Every dialog goes through the Moonlight shell so levels, focus and motion stay consistent.
test('antd Modal is only used inside AluneModal', () => {
  const offenders = files
    .filter((file) => file.name !== 'ui/components/AluneModal.tsx')
    .filter((file) => antdImports(file.text).includes('Modal'))
    .map((file) => file.name);
  assert.deepEqual(offenders, []);
});

test('antd Popconfirm is only used inside AlunePopconfirm', () => {
  const offenders = files
    .filter((file) => file.name !== 'ui/components/AlunePopconfirm.tsx')
    .filter((file) => antdImports(file.text).includes('Popconfirm'))
    .map((file) => file.name);
  assert.deepEqual(offenders, []);
});

test('imperative antd dialogs are replaced by useAluneConfirm', () => {
  const offenders = files
    .filter((file) => /\bmodal\.(confirm|info|success|warning|error)\(/.test(file.text))
    .map((file) => file.name);
  assert.deepEqual(offenders, []);
});

// AluneModal submits on ↵ for L0/L1; a field-level handler would submit twice.
// Exception: the path field runs the pre-check while OK is still locked, and
// hands ↵ back to the dialog once the inspection unlocks it.
const ENTER_PRECHECK = new Set(['components/OpenLocalRepository.tsx']);
test('fields inside AluneModal do not add their own Enter submit', () => {
  const offenders = files
    .filter((file) => !ENTER_PRECHECK.has(file.name))
    .filter((file) => file.text.includes('<AluneModal') && file.text.includes('onPressEnter'))
    .map((file) => file.name);
  assert.deepEqual(offenders, []);
});
