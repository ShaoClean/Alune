import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareContracts, compareRuntime, modelRuns } from './check-p0-models.mjs';

function fixture(t, old, next, extra, selectedNames) {
  const directory = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'p0-contract-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, text) => { const file = path.join(directory, name); fs.writeFileSync(file, text); return file; };
  const previous = write('old.ts', old), current = write('new.ts', next);
  const targets = [['domain', current]];
  if (extra) targets.push(['protocol', write('duplicate.ts', extra)]);
  return compareContracts(previous, targets, directory, directory, selectedNames);
}

test('equivalent type, generic and value signatures pass in both directions', (t) => {
  const rows = fixture(t, 'export interface Item { id: string }; export type Box<T> = { value: T }; export const value = 1;',
    'export interface Item { id: string }; export type Box<U> = { value: U }; export const value = 1;');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.compatible));
  assert.equal(rows.find((row) => row.name === 'Box').checks[0].check, 'generic type signature, both directions');
  assert.equal(rows.find((row) => row.name === 'value').valueExport, true);
});

test('missing, ambiguous, narrowed and incompatible signatures are not credited', (t) => {
  const rows = fixture(t, 'export interface Missing { id: string }; export interface Narrow { mode: string }; export const version = 1;',
    'export interface Narrow { mode: "fixed" }; export const version = 2;');
  assert.ok(rows.every((row) => !row.compatible));
  const ambiguous = fixture(t, 'export type Item = string;', 'export type Item = string;', 'export type Item = string;');
  assert.equal(ambiguous[0].compatible, false);
});

const runtimeRow = () => ({ name: 'transform', owner: 'domain', valueExport: true, compatible: true });
test('runtime parity compares results and error constructor/message, with independent inputs', () => {
  const row = runtimeRow();
  const fn = (input) => { input.push('changed'); if (input[0] === 'bad') throw new TypeError('bad input'); return input; };
  compareRuntime([row], { transform: fn }, { domain: { transform: fn } }, { transform: [[['ok']], [['bad']]] });
  assert.equal(row.runtimeSamples, 2);
  assert.throws(() => compareRuntime([runtimeRow()], { transform: () => 1 }, { domain: { transform: () => 2 } }, { transform: [[]] }));
  assert.throws(() => compareRuntime([runtimeRow()], { transform: () => { throw new TypeError('x'); } },
    { domain: { transform: () => { throw new Error('x'); } } }, { transform: [[]] }));
  assert.throws(() => compareRuntime([runtimeRow()], { transform: fn }, { domain: { transform: fn } }, {}), /needs runtime/);
});

test('every frozen export gets its own result and pure types never invent runtime samples', () => {
  const ledger = { entries: [
    { id: 'type-id', kind: 'export', file: 'packages/shared/src/types.ts', name: 'Type' },
    { id: 'missing-id', kind: 'export', file: 'packages/shared/src/types.ts', name: 'Missing' },
  ] };
  const rows = [
    { name: 'Type', file: 'packages/shared/src/types.ts', compatible: true, valueExport: false,
      checks: [{ check: 'type, both directions', ok: true }] },
    { name: 'Missing', file: 'packages/shared/src/types.ts', compatible: false, valueExport: false, checks: [] },
  ];
  const runs = modelRuns(ledger, rows, 'a'.repeat(40), 'darwin-arm64', {});
  assert.equal(runs[0].result, 'passed');
  assert.match(runs[0].assertion, /compile-time declaration only/);
  assert.equal(runs[1].result, 'failed');
  assert.deepEqual(runs[1].entries, ['missing-id']);
  assert.throws(() => modelRuns(ledger, rows.slice(1), '', '', {}), /every frozen/);
  assert.throws(() => modelRuns(ledger, [rows[0], rows[0]], '', '', {}), /every frozen/);
  assert.throws(() => modelRuns(ledger, [{ ...rows[0], valueExport: true }, rows[1]], '', '', {}), /Unverified/);
});

test('generic defaults cannot change or disappear for callers omitting type arguments', (t) => {
  const old = 'export type Reply<T = undefined> = { result: T };';
  for (const next of [
    'export type Reply<T = string> = { result: T };',
    'export type Reply<T> = { result: T };',
    'export type Reply<T = any> = { result: T };',
  ]) assert.equal(fixture(t, old, next)[0].compatible, false);
  assert.equal(fixture(t, old, old)[0].compatible, true);
});

test('new any fields, nested arrays and function results cannot erase a type constraint', (t) => {
  for (const [old, next] of [
    ['export interface Item { id: string }', 'export interface Item { id: any }'],
    ['export type Item = { nested: { ids: string[] } }', 'export type Item = { nested: { ids: any[] } }'],
    ['export function item(): string { return "ok" }', 'export function item(): any { return "ok" }'],
  ]) assert.equal(fixture(t, old, next)[0].compatible, false);
  const unchanged = 'export interface Item { metadata: any; id: string }';
  assert.equal(fixture(t, unchanged, unchanged)[0].compatible, true);
});

test('selected type contracts never certify runtime exports or silently omit missing frozen names', (t) => {
  const old = 'export interface Shape { id: string }; export const value = 1;';
  const next = 'export interface Shape { id: string }; export const value = 2;';
  const rows = fixture(t, old, next, undefined, ['Shape']);
  assert.deepEqual(rows.map((row) => row.name), ['Shape']);
  assert.equal(rows[0].compatible, true);
  assert.equal(rows[0].valueExport, false);
  assert.throws(() => fixture(t, old, next, undefined, ['Missing']), /Missing selected/);
  for (const names of [[], ['Shape', 'Shape'], 'Shape'])
    assert.throws(() => fixture(t, old, next, undefined, names), /Invalid selected/);
});

test('explicit ambient asset declarations participate in selected and generic type checks without weakening diagnostics', t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'p0-contract-assets-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source='import icon from "fixture.svg?url"; export type Image<T = string> = { icon: typeof icon; value: T };';
  const previous=path.join(directory,'old.ts'),current=path.join(directory,'new.ts'),ambient=path.join(directory,'assets.d.ts');
  fs.writeFileSync(previous,source);fs.writeFileSync(current,source);
  fs.writeFileSync(ambient,'declare module "*.svg?url" { const url: string; export default url; }');
  assert.throws(()=>compareContracts(previous,[['domain',current]],directory,directory,['Image']),/Cannot find module/);
  assert.equal(compareContracts(previous,[['domain',current]],directory,directory,['Image'],[ambient])[0].compatible,true);
  fs.writeFileSync(current,source.replace('T = string','T = any'));
  assert.equal(compareContracts(previous,[['domain',current]],directory,directory,['Image'],[ambient])[0].compatible,false);
});
