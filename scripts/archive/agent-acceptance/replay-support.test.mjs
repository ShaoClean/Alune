import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  createCommandRecorder,
  createReplayContext,
  hash,
  json,
  runtimeToolInventory,
} from './replay-support.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-replay-tools-'));
  fs.mkdirSync(path.join(root, 'logs'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('replay command records retain exit status, environment, combined log and verified hash', (t) => {
  const root = fixture(t),
    commands = [];
  const command = createCommandRecorder({ root, output: root, commands });
  command(
    'output',
    ['-e', "process.stdout.write(process.env.REPLAY_FIXTURE);process.stderr.write(' stderr')"],
    { env: { REPLAY_FIXTURE: 'synthetic' } },
  );
  assert.equal(fs.readFileSync(path.join(root, 'logs/output.log'), 'utf8'), 'synthetic stderr');
  assert.equal(commands[0].exitCode, 0);
  assert.equal(commands[0].expectedExit, 0);
  assert.deepEqual(commands[0].environmentOverrides, { REPLAY_FIXTURE: 'synthetic' });
  assert.equal(commands[0].log.sha256, hash(Buffer.from('synthetic stderr')));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'commands.json'))),
    JSON.parse(json(commands)),
  );
});

test('failed commands are archived before rejection and independent failures never become passes', (t) => {
  const root = fixture(t),
    commands = [];
  const command = createCommandRecorder({ root, output: root, commands });
  assert.throws(
    () => command('failed', ['-e', 'process.exit(7)']),
    /Unexpected command result: failed/,
  );
  command('expected', ['-e', 'process.exit(7)'], { expectedExit: 7 });
  command('independent', ['-e', 'process.exit(8)'], { independent: true });
  assert.deepEqual(
    commands.map((item) => item.exitCode),
    [7, 7, 8],
  );
  assert.deepEqual(
    commands.map((item) => item.expectedExit),
    [0, 7, 0],
  );
  assert.equal(commands[2].independent, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'commands.json'))).length, 3);
  assert.throws(() => command('failed', ['-e', 'process.exit(0)']), { code: 'EEXIST' });
});

test('legacy replay command schema and boolean independence are preserved', (t) => {
  const root = fixture(t),
    commands = [];
  const command = createCommandRecorder({ root, output: root, commands, legacy: true });
  command('ordinary', ['-e', 'process.exit(0)']);
  command('independent', ['-e', 'process.exit(3)'], true);
  assert.equal(commands[0].independent, false);
  assert.equal(commands[1].independent, true);
  assert.equal(commands[1].exitCode, 3);
  for (const item of commands) {
    assert.equal(Object.hasOwn(item, 'expectedExit'), false);
    assert.equal(Object.hasOwn(item, 'environmentOverrides'), false);
  }
});

test('shared replay context hashes each distinct input and retains JSON error diagnostics', (t) => {
  const root = fixture(t);
  execFileSync('git', ['init', '-q', root]);
  fs.writeFileSync(path.join(root, 'input.json'), '{"fixture":true}');
  const context = createReplayContext(root);
  assert.deepEqual(context.read('input.json'), { fixture: true });
  assert(context.walk('.').some((file) => file.endsWith('input.json')));
  assert.deepEqual(context.digest(['input.json', 'input.json']), {
    'input.json': hash(Buffer.from('{"fixture":true}')),
  });
  assert.equal(context.git('rev-parse', '--is-inside-work-tree').trim(), 'true');
  const error = new AggregateError([new Error('inner')], 'outer');
  const record = JSON.parse(json(error));
  assert.equal(record.message, 'outer');
  assert.equal(record.errors[0].message, 'inner');
});

test('runtime inventory fingerprints executable bytes and does not execute shell/env without version flags', () => {
  const tools = runtimeToolInventory();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['git', 'ssh', 'python3', 'sh', 'grep', 'env'],
  );
  for (const tool of tools) {
    assert.equal(tool.sha256, hash(fs.readFileSync(tool.realpath)));
    if (['sh', 'grep', 'env'].includes(tool.name)) assert.equal(tool.version, null);
  }
});
