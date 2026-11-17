// Complete retired type-only module review. Current events intentionally use a
// different wire contract; type rejection is evidence, not a compatibility pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { isCommandOutput, isCommandExit } from '@alune/protocol';
import { subscribeWorkspaceEvents, workspaceEventSuccessors } from '../src/api/workspace-events.ts';
import { workspaceTopics } from '../src/api/ui-agent.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const file = 'packages/shared/src/types/events.ts';
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const hash = (v) => createHash('sha256').update(v).digest('hex');
const record = (name, value) => {
  if (process.env.P0_EVENT_CONTRACT_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_EVENT_CONTRACT_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
};
function legacyText() {
  const text = process.env.P0_EVENT_CONTRACT_FROZEN
    ? fs.readFileSync(path.join(process.env.P0_EVENT_CONTRACT_FROZEN, file), 'utf8')
    : execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' });
  assert.equal(
    text,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  return text;
}
const shapes = {
  CommandOutputEvent: {
    connectionId: ['string', false],
    repositoryId: ['string', true],
    command: ['string', false],
    data: ['string', false],
    type: ["'stdout' | 'stderr'", false],
  },
  CommandExitEvent: {
    connectionId: ['string', false],
    repositoryId: ['string', true],
    command: ['string', false],
    exitCode: ['number', false],
  },
  ConnectionStatusEvent: {
    connectionId: ['string', false],
    status: ["'connected' | 'disconnected' | 'connecting' | 'error'", false],
    error: ['string', true],
    updatedAt: ['number', true],
  },
  RepositoryStatusEvent: {
    repositoryId: ['string', false],
    connectionId: ['string', false],
    isDirty: ['boolean', false],
    currentBranch: ['string', false],
    ahead: ['number', false],
    behind: ['number', false],
  },
  ServerEvents: {
    'connection:status': ['ConnectionStatusEvent', false],
    'repo:status': ['RepositoryStatusEvent', false],
    'command:output': ['CommandOutputEvent', false],
    'command:exit': ['CommandExitEvent', false],
  },
};
const samples = {
  CommandOutputEvent: {
    connectionId: 'legacy-host',
    repositoryId: 'repo',
    command: 'git 中文',
    data: '中\r\n\0',
    type: 'stdout',
  },
  CommandExitEvent: {
    connectionId: 'legacy-host',
    repositoryId: 'repo',
    command: 'git 中文',
    exitCode: 7,
  },
  ConnectionStatusEvent: {
    connectionId: 'legacy-host',
    status: 'error',
    error: 'safe fixture',
    updatedAt: 123,
  },
  RepositoryStatusEvent: {
    repositoryId: 'repo',
    connectionId: 'legacy-host',
    isDirty: true,
    currentBranch: 'feature/中文',
    ahead: 2,
    behind: 3,
  },
};
samples.ServerEvents = Object.fromEntries(
  Object.entries(shapes.ServerEvents).map(([key, [type]]) => [key, samples[type]]),
);

// One program includes all positives and all unannotated negative assignments.
// Every negative line must produce a diagnostic, every positive line must not.
function compileCases(directory, imports, cases) {
  const fixture = path.join(directory, 'cases.ts');
  const lines = [...imports];
  const negative = new Map();
  for (const [i, row] of cases.entries()) {
    lines.push(`const case${i}: ${row.type} = ${row.expression ?? JSON.stringify(row.value)};`);
    if (row.reject) negative.set(lines.length, row.label);
  }
  const source = lines.join('\n') + '\n';
  fs.writeFileSync(fixture, source);
  const options = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ignoreDeprecations: '6.0',
    types: [],
    skipLibCheck: true,
  };
  const program = ts.createProgram([fixture], options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ({
    file: d.file?.fileName,
    line:
      d.file && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
        : null,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  }));
  for (const d of diagnostics) {
    assert.equal(
      d.file,
      fixture,
      'No infrastructure or imported-source errors: ' + JSON.stringify(d),
    );
    assert(negative.has(d.line), 'Unexpected positive-line error: ' + JSON.stringify(d));
  }
  assert.deepEqual(
    [...new Set(diagnostics.map((d) => d.line))].sort((a, b) => a - b),
    [...negative.keys()],
  );
  return {
    program,
    source,
    diagnostics,
    cases,
    positiveCases: cases.filter((c) => !c.reject).length,
    negativeCases: negative.size,
    options: {
      strict: true,
      exactOptionalPropertyTypes: false,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node10',
    },
  };
}

test('P0 event contract entire frozen module has exactly five type declarations and every field is checked by positive and negative compiler cases', () => {
  const text = legacyText(),
    ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  assert.equal(ast.statements.length, 5);
  const inventory = ast.statements.map((s) => {
    assert(ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s));
    assert(s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    assert(!s.heritageClauses?.length);
    const members = ts.isInterfaceDeclaration(s) ? s.members : s.type.members;
    const fields = Object.fromEntries(
      members.map((m) => {
        assert(ts.isPropertySignature(m));
        return [m.name.text, [m.type.getText(ast), !!m.questionToken]];
      }),
    );
    assert.deepEqual(fields, shapes[s.name.text], 'Complete field/type/optionality review');
    return { name: s.name.text, kind: ts.SyntaxKind[s.kind], fields };
  });
  assert.deepEqual(
    inventory.map((r) => r.name),
    Object.keys(shapes),
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports },
  );
  assert.deepEqual(Object.keys(exports), []); // no hidden runtime/import/effect responsibility
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-event-types-'));
  try {
    fs.writeFileSync(path.join(dir, 'events.ts'), text);
    const cases = [];
    for (const [type, fields] of Object.entries(shapes)) {
      cases.push({ type, value: samples[type], label: type + ' full' });
      for (const [key, [fieldType, optional]] of Object.entries(fields)) {
        const omitted = { ...samples[type] };
        delete omitted[key];
        cases.push({ type, value: omitted, reject: !optional, label: `${type}.${key} omitted` });
        cases.push({
          type,
          value: {
            ...samples[type],
            [key]: fieldType === 'number' || fieldType === 'boolean' ? 'wrong' : 99,
          },
          reject: true,
          label: `${type}.${key} wrong type`,
        });
      }
      cases.push({
        type,
        value: { ...samples[type], unexpected: true },
        reject: true,
        label: type + ' excess property',
      });
    }
    for (const stream of ['stdout', 'stderr'])
      cases.push({
        type: 'CommandOutputEvent',
        value: { ...samples.CommandOutputEvent, type: stream },
        label: stream,
      });
    cases.push({
      type: 'CommandOutputEvent',
      value: { ...samples.CommandOutputEvent, type: 'progress' },
      reject: true,
      label: 'no progress stream',
    });
    for (const status of ['connected', 'disconnected', 'connecting', 'error'])
      cases.push({
        type: 'ConnectionStatusEvent',
        value: { ...samples.ConnectionStatusEvent, status },
        label: status,
      });
    cases.push({
      type: 'ConnectionStatusEvent',
      value: { ...samples.ConnectionStatusEvent, status: 'unknown' },
      reject: true,
      label: 'no unknown state',
    });
    cases.push({
      type: 'CommandExitEvent',
      value: { ...samples.CommandExitEvent, exitCode: null },
      reject: true,
      label: 'legacy number only',
    });
    // TS interfaces do not validate finite values, monotonic time or safe integers.
    cases.push({
      type: 'CommandExitEvent',
      expression: '{ connectionId: "", command: "", exitCode: NaN }',
      label: 'legacy NaN type-assignable',
    });
    cases.push({
      type: 'ConnectionStatusEvent',
      expression: '{ connectionId: "", status: "connected", updatedAt: Infinity }',
      label: 'legacy infinity type-assignable',
    });
    const result = compileCases(
      dir,
      [`import type { ${Object.keys(shapes).join(', ')} } from './events';`],
      cases,
    );
    record('event-contract-frozen-types', {
      file,
      baseline,
      sha256: hash(text),
      inventory,
      runtimeExports: Object.keys(exports),
      ...Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'program')),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0 event contract successor compiler proves scoped binary nullable exit envelopes and explicitly rejects legacy wire assignability', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-event-successors-'));
  try {
    fs.writeFileSync(path.join(dir, 'events.ts'), legacyText());
    const identity = {
      commandId: 'c',
      operationId: 'op',
      command: 'git 中文',
      executable: 'git',
      args: ['status'],
      cwd: '/fixture',
    };
    const output = { ...identity, stream: 'stdout', base64: '5Lit' },
      exit = { ...identity, exitCode: 7, signal: null };
    const envelope = {
      agentId: 'owner',
      sessionId: 'session',
      sequence: 1,
      type: 'commands.output',
      resource: { agentId: 'owner', resourceId: 'repo' },
      payload: output,
    };
    const cases = [
      { type: 'CommandOutput', value: output, label: 'current output' },
      { type: 'CommandExit', value: exit, label: 'current numeric exit' },
      {
        type: 'CommandExit',
        value: { ...exit, exitCode: null, signal: 'SIGTERM' },
        label: 'current interrupted exit',
      },
      { type: 'AgentEvent', value: envelope, label: 'scoped envelope' },
      {
        type: 'CommandOutput',
        expression: 'oldOutput',
        reject: true,
        label: 'legacy output cannot be wire output',
      },
      {
        type: 'CommandOutputEvent',
        expression: 'newOutput',
        reject: true,
        label: 'wire output cannot be UI text callback',
      },
      {
        type: 'CommandExit',
        expression: 'oldExit',
        reject: true,
        label: 'legacy exit cannot be wire exit',
      },
      {
        type: 'CommandExitEvent',
        expression: 'newExit',
        reject: true,
        label: 'nullable scoped exit cannot be legacy numeric exit',
      },
      {
        type: 'AgentEvent',
        expression: 'oldRepository',
        reject: true,
        label: 'snapshot cannot be invalidation envelope',
      },
      {
        type: 'RepositoryStatusEvent',
        expression: 'envelope',
        reject: true,
        label: 'invalidation cannot be status snapshot',
      },
      {
        type: 'ConnectionStatusEvent',
        expression: 'envelope',
        reject: true,
        label: 'Agent identity is not a host profile ID',
      },
      {
        type: 'ServerEvents',
        expression: 'envelope',
        reject: true,
        label: 'wire event is not legacy category dictionary',
      },
    ];
    for (const [type, full] of [
      ['CommandOutput', output],
      ['CommandExit', exit],
      ['AgentEvent', envelope],
    ]) {
      for (const key of Object.keys(full)) {
        const value = { ...full };
        delete value[key];
        cases.push({ type, value, reject: key !== 'resource', label: `${type}.${key} omitted` });
      }
    }
    const result = compileCases(
      dir,
      [
        `import type { ${Object.keys(shapes).join(', ')} } from './events';`,
        `import type { CommandOutput, CommandExit, AgentEvent } from ${JSON.stringify(path.join(root, 'packages/protocol/src/index'))};`,
        'declare const oldOutput: CommandOutputEvent, oldExit: CommandExitEvent, oldRepository: RepositoryStatusEvent;',
        'declare const newOutput: CommandOutput, newExit: CommandExit, envelope: AgentEvent;',
      ],
      cases,
    );
    const checker = result.program.getTypeChecker();
    const protocol = result.program.getSourceFile(
      path.join(root, 'packages/protocol/src/index.ts'),
    );
    const exported = checker
      .getExportsOfModule(checker.getSymbolAtLocation(protocol))
      .map((s) => s.name);
    assert(
      Object.keys(shapes).every((name) => !exported.includes(name)),
      'Retired names remain absent',
    );
    record('event-contract-successor-types', {
      retiredExportsRestored: false,
      ...Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'program')),
      limitations:
        'Compile-time shape checking only; runtime validators and real Agent/stdio/native Git behavior are separate tests in the same replay. Numeric and string types alone do not prove protocol validity.',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P0 event contract all legacy fields map explicitly to current callbacks with strict payload validation and snapshot invalidation boundary', () => {
  assert.deepEqual(workspaceEventSuccessors, {
    'connection:status': 'hosts.changed',
    'repo:status': 'repositories.changed',
    'command:output': 'commands.output',
    'command:exit': 'commands.exit',
  });
  assert(Object.values(workspaceEventSuccessors).every((topic) => workspaceTopics.includes(topic)));
  const listeners = new Set(),
    closed = new Set();
  const client = {
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onClose(fn) {
      closed.add(fn);
      return () => closed.delete(fn);
    },
  };
  const trace = { outputs: [], exits: [], hosts: [], repositories: [], snapshots: [] };
  const off = subscribeWorkspaceEvents(client, {
    'command:output': (p) => trace.outputs.push(p),
    'command:exit': (p) => trace.exits.push(p),
    'connection:status': (p) => trace.hosts.push(p),
    'repository:changed': (id) => trace.repositories.push(id),
    'repo:status': (p) => trace.snapshots.push(p),
  });
  let sequence = 0;
  const resource = { agentId: 'agent-owner', resourceId: 'repo-owner' };
  const emit = (type, payload, scope = resource) => {
    for (const fn of listeners)
      fn({
        agentId: 'agent-owner',
        sessionId: 'session-owner',
        sequence: ++sequence,
        resource: scope,
        type,
        payload,
      });
  };
  const identity = {
    commandId: 'command',
    operationId: 'op',
    command: 'git 中文',
    executable: 'git',
    args: ['status'],
    cwd: '/fixture',
  };
  for (const stream of ['stdout', 'stderr']) {
    const p = { ...identity, stream, base64: Buffer.from('中文\r\n\0').toString('base64') };
    assert(isCommandOutput(p));
    emit('commands.output', p);
    const got = trace.outputs.at(-1);
    assert.deepEqual(
      Object.fromEntries(Object.keys(shapes.CommandOutputEvent).map((key) => [key, got[key]])),
      {
        connectionId: 'agent-owner',
        repositoryId: 'repo-owner',
        command: 'git 中文',
        data: '中文\r\n\0',
        type: stream,
      },
    );
    assert.equal(got.agentId, 'agent-owner');
    assert.equal(got.sessionId, 'session-owner');
    assert.equal(got.sequence, sequence);
  }
  const rejected = [];
  for (const key of Object.keys(identity)) {
    const p = { ...identity, stream: 'stdout', base64: 'QQ==' };
    delete p[key];
    assert.equal(isCommandOutput(p), false);
    emit('commands.output', p);
    rejected.push(key);
  }
  for (const p of [
    { ...identity, args: [1], stream: 'stdout', base64: 'QQ==' },
    { ...identity, stream: 'progress', base64: 'QQ==' },
    { ...identity, stream: 'stdout', base64: '?' },
    { ...identity, stream: 'stdout', base64: 'A'.repeat(21852) },
  ]) {
    assert.equal(isCommandOutput(p), false);
    emit('commands.output', p);
  }
  emit(
    'commands.output',
    { ...identity, stream: 'stdout', base64: 'QQ==' },
    { agentId: 'foreign', resourceId: 'repo-owner' },
  );
  assert.equal(trace.outputs.length, 2);
  for (const exitCode of [0, 1, 7, 128]) {
    const p = { ...identity, exitCode, signal: null };
    assert(isCommandExit(p));
    emit('commands.exit', p);
    const got = trace.exits.at(-1);
    assert.deepEqual(
      Object.fromEntries(Object.keys(shapes.CommandExitEvent).map((key) => [key, got[key]])),
      { connectionId: 'agent-owner', repositoryId: 'repo-owner', command: 'git 中文', exitCode },
    );
  }
  const interrupted = { ...identity, exitCode: null, signal: 'SIGTERM' };
  assert(isCommandExit(interrupted));
  emit('commands.exit', interrupted);
  for (const p of [
    { ...identity, exitCode: NaN, signal: null },
    { ...identity, exitCode: 0, signal: 'SIGTERM' },
    { ...identity, exitCode: 0.5, signal: null },
  ]) {
    assert.equal(isCommandExit(p), false);
    emit('commands.exit', p);
  }
  assert.equal(trace.exits.length, 4);
  for (const status of ['connected', 'disconnected', 'connecting', 'error']) {
    const p = {
      hostId: 'saved-host-profile',
      status,
      error: 'safe fixture',
      updatedAt: sequence + 1,
    };
    emit('hosts.changed', p);
    assert.deepEqual(trace.hosts.at(-1), { ...p, connectionId: 'saved-host-profile' });
    assert.notEqual(trace.hosts.at(-1).connectionId, resource.agentId);
  }
  emit('hosts.changed', { hostId: 'saved-host-profile', status: 'connected', updatedAt: 200 });
  assert.equal(Object.hasOwn(trace.hosts.at(-1), 'error'), false);
  const host = { hostId: 'saved-host-profile', status: 'connected', updatedAt: 300 };
  for (const p of [
    { ...host, hostId: '' },
    { ...host, status: 'unknown' },
    { ...host, updatedAt: NaN },
    { ...host, updatedAt: Infinity },
    { ...host, updatedAt: undefined },
    { ...host, error: 123 },
  ])
    emit('hosts.changed', p);
  assert.equal(trace.hosts.length, 5);
  emit('repositories.changed', { generation: 1, ...samples.RepositoryStatusEvent });
  assert.deepEqual(trace.repositories, ['repo-owner']);
  assert.deepEqual(trace.snapshots, []); // dirty/branch/ahead/behind require actual re-read companions
  off();
  assert.equal(listeners.size, 0);
  assert.equal(closed.size, 0);
  const after = JSON.stringify(trace);
  emit('commands.exit', { ...identity, exitCode: 0, signal: null });
  assert.equal(JSON.stringify(trace), after);
  record('event-contract-field-projection', {
    trace,
    malformedMissingIdentityFields: rejected,
    allLegacyFields: shapes,
    owner: resource,
    limitations:
      'Controlled event source and production projection/validators; this test does not establish envelope transport validation or perform repository status reads. Same-run AgentSession/SDK and real stdio/native Git tests assert those independently. Legacy data strings/IDs and snapshots are intentionally not current wire types.',
  });
});
