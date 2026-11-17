import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { compareContracts } from './check-p0-models.mjs';
import { modules, unresolved } from './p0-shared-foundations-plan.mjs';

const root = process.cwd();
const frozen = process.env.P0_SHARED_FROZEN;
assert.ok(frozen, 'Use the replay driver to build an isolated frozen fixture');
const req = createRequire(import.meta.url);
const domain = req('@alune/domain'),
  protocol = req('@alune/protocol');
const old = req(path.join(frozen, 'dist/index.js'));
const owners = { domain, protocol };
const ledger = JSON.parse(fs.readFileSync('docs/acceptance/issue-257-258/8f30e6b/ledger.json'));
const contracts = compareContracts(
  path.join(frozen, 'packages/shared/src/index.ts'),
  ['domain', 'protocol'].map((name) => [name, path.join(root, 'packages', name, 'src/index.ts')]),
  frozen,
  frozen,
);
const audit = [];
const hash = (b) => createHash('sha256').update(b).digest('hex');
function save(name, value) {
  if (process.env.P0_SHARED_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_SHARED_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function body(file, options = {}) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function shape(n) {
    const children = [];
    ts.forEachChild(n, (child) => {
      if (
        options.center &&
        ts.isInterfaceDeclaration(n) &&
        n.name.text === 'PullRequestSource' &&
        ['resource', 'availability', 'observedAt'].includes(child.name?.text)
      )
        return;
      children.push(shape(child));
    });
    return [ts.SyntaxKind[n.kind], ...(typeof n.text === 'string' ? [n.text] : []), ...children];
  }
  return source.statements
    .filter(
      (n) =>
        !ts.isImportDeclaration(n) &&
        !(ts.isExportDeclaration(n) && n.moduleSpecifier) &&
        !(options.skipFunctions && ts.isFunctionDeclaration(n)) &&
        !(options.skipNames ?? []).includes(n.name?.text) &&
        (!options.onlyNames || options.onlyNames.includes(n.name?.text)),
    )
    .map(shape);
}

test('P0 shared moved PR declarations and host-scoped source extensions remain explicit', () => {
  const options = { onlyNames: ['PullRequestProvider', 'PullRequestRemote'] };
  assert.deepEqual(
    body('packages/protocol/src/legacy/access-tokens.ts', options),
    body(path.join(frozen, 'packages/shared/src/types/pull-requests.ts'), options),
  );
  const fixture = path.join(frozen, 'source-extensions.ts');
  fs.writeFileSync(
    fixture,
    `import type { PullRequestSource } from '${root}/packages/protocol/src/pull-request-center';
let x: Pick<PullRequestSource, 'resource'|'availability'|'observedAt'> = {
resource:{agentId:'agent-a',resourceId:'resource-a'}, availability:'stale', observedAt:'2026-11-13'};
// @ts-expect-error paths are not resource identities
x.resource = '/repo';
// @ts-expect-error Agent identity is required
x.resource = {resourceId:'r'};
// @ts-expect-error undeclared availability is rejected
x.availability = 'connected';
// @ts-expect-error timestamps retain the declared string format
x.observedAt = 7;
`,
  );
  const program = ts.createProgram([fixture], {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    paths: { '@alune/domain': [path.join(root, 'packages/domain/src/index.ts')] },
  });
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    [],
  );
});

for (const module of modules) {
  test('P0 whole shared module ' + module.scenarioId, () => {
    const expected = ledger.entries
      .filter((e) => e.file === module.frozen && e.kind === 'export')
      .map((e) => e.name)
      .sort();
    const rows = contracts.filter((r) => r.file === module.frozen);
    assert.ok(expected.length > 0);
    assert.deepEqual(
      rows.map((r) => r.name).sort(),
      expected,
      'every frozen export must be accounted for',
    );
    for (const r of rows) {
      assert.equal(r.compatible, true, r.name);
      assert.ok(r.checks.length && r.checks.every((c) => c.ok), r.name);
    }
    const options = {
      skipFunctions: module.runtime === 'ranges',
      center: module.scenarioId === 'P0-PROTOCOL-2320',
      skipNames:
        module.runtime === 'terminal'
          ? ['sshTerminalEnvironment']
          : ['P0-PROTOCOL-2267', 'P0-PROTOCOL-2327'].includes(module.scenarioId)
            ? ['PullRequestProvider', 'PullRequestRemote']
            : [],
    };
    assert.deepEqual(
      body(path.join(root, module.implementation), options),
      body(path.join(frozen, module.frozen), options),
      'all non-import syntax, private helpers and initializers must match; only reviewed PR function fix is excepted',
    );
    audit.push({
      ...module,
      exports: rows,
      sourceSha256: hash(fs.readFileSync(module.implementation)),
      frozenSha256: hash(fs.readFileSync(path.join(frozen, module.frozen))),
      reviewedSyntaxDifferences: options,
      runtimeExportNames: rows.filter((r) => r.valueExport).map((r) => r.name),
    });
  });
}

test('P0 shared actions preserve the literal file and directory action matrix', () => {
  const cases = [
    [
      { path: '中文.txt', status: 'modified', staged: false },
      [true, true, false, true, false, false, false],
      '',
    ],
    [
      { path: 'a', status: 'added', staged: false },
      [true, true, false, false, true, false, false],
      '',
    ],
    [
      { path: 'a', status: 'untracked', staged: false },
      [true, true, false, false, true, false, false],
      '',
    ],
    [
      { path: 'a', status: 'deleted', staged: true },
      [true, false, true, false, false, false, false],
      '',
    ],
    [
      { path: 'a', status: 'modified', staged: false, conflicted: true },
      [true, true, false, false, false, false, false],
      '',
    ],
    [
      { path: 'dir/', status: 'untracked', staged: false },
      [false, false, false, false, false, false, true],
      '目录',
    ],
    [
      { path: 'dir/\n', kind: 'directory', status: 'untracked', staged: false },
      [false, false, false, false, false, false, false],
      '目录',
    ],
    [
      { path: 'sub', kind: 'submodule', status: 'modified', staged: false },
      [true, false, false, false, false, false, false],
      '子模块',
    ],
    [
      {
        path: 'sub',
        kind: 'submodule',
        status: 'modified',
        staged: false,
        submodule: { commitChanged: true },
      },
      [true, true, false, false, false, false, false],
      '子模块',
    ],
    [
      { path: 'sub', kind: 'submodule', status: 'deleted', staged: false },
      [true, true, false, false, false, false, false],
      '子模块',
    ],
    [
      { path: 'sub', kind: 'submodule', status: 'modified', staged: true },
      [true, false, true, false, false, false, false],
      '子模块',
    ],
    [
      {
        path: 'w',
        kind: 'worktree',
        status: 'untracked',
        staged: false,
        repositoryPath: '/display',
      },
      [false, false, false, false, false, true, true],
      'Worktree',
    ],
    [
      { path: 'r', kind: 'repository', status: 'untracked', staged: false },
      [false, false, false, false, false, false, true],
      '嵌套仓库',
    ],
  ];
  for (const [input, flags, label] of cases) {
    const copy = structuredClone(input);
    const expected = Object.fromEntries(
      ['diff', 'stage', 'unstage', 'discard', 'delete', 'open', 'ignore'].map((k, i) => [
        k,
        flags[i],
      ]),
    );
    assert.deepEqual(domain.changeActions(input), expected);
    assert.deepEqual(domain.changeActions(input), old.changeActions(input));
    assert.equal(domain.changeKindLabel(input), label);
    assert.equal(old.changeKindLabel(input), label);
    assert.deepEqual(input, copy);
  }
});

test('P0 shared LFS recognizes complete bounded pointers and rejects malformed documents', () => {
  const oid = 'abcde01234'.repeat(6) + 'abcd';
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 123\n`;
  const valid = [pointer, pointer.replaceAll('\n', '\r\n'), pointer + 'ext-0-name value\n'];
  const invalid = [
    '',
    'prefix\n' + pointer,
    pointer + 'size 123\n',
    pointer + 'oid sha256:' + oid + '\n',
    pointer.replace('size 123', 'size 0123'),
    pointer.replace('size 123', 'size -1'),
    pointer.replace('size 123', 'size 9007199254740992'),
    pointer.replace(oid, oid.toUpperCase()),
    pointer + 'unknown extension\n',
    'x'.repeat(1025),
    pointer.replace('size 123', 'size 1.5'),
  ];
  for (const input of valid) {
    assert.deepEqual(domain.parseLfsPointer(input), { oid, size: 123 });
    assert.deepEqual(domain.parseLfsPointer(input), old.parseLfsPointer(input));
  }
  for (const input of invalid) {
    assert.equal(domain.parseLfsPointer(input), null);
    assert.equal(old.parseLfsPointer(input), null);
  }
  const zero = pointer.replace('size 123', 'size 0');
  assert.deepEqual(domain.parseLfsPointer(zero), { oid, size: 0 });
  assert.equal(domain.LFS_STATUS_TIMEOUT_MS, 25000);
});

test('P0 shared conflicts preserve bytes and reject stale block selections', () => {
  for (const newline of ['\n', '\r\n'])
    for (const width of [7, 9]) {
      const marker =
        '<'.repeat(width) +
        ' HEAD' +
        newline +
        '我🙂' +
        newline +
        '|'.repeat(width) +
        ' base' +
        newline +
        '基' +
        newline +
        '='.repeat(width) +
        newline +
        '来' +
        newline +
        '>'.repeat(width) +
        ' topic' +
        newline;
      const input = 'before\0' + newline + marker + 'after';
      const expected = {
        index: 0,
        raw: marker,
        current: '我🙂' + newline,
        incoming: '来' + newline,
        base: '基' + newline,
        currentLabel: 'HEAD',
        incomingLabel: 'topic',
        baseLabel: 'base',
      };
      assert.deepEqual(domain.conflictBlocks(input), [expected]);
      assert.deepEqual(domain.parseConflictMarkers(input), [
        { kind: 'text', text: 'before\0' + newline },
        { kind: 'conflict', block: expected },
        { kind: 'text', text: 'after' },
      ]);
      assert.deepEqual(domain.parseConflictMarkers(input), old.parseConflictMarkers(input));
      for (const [choice, text] of [
        ['current', expected.current],
        ['incoming', expected.incoming],
        ['both', expected.current + expected.incoming],
      ]) {
        assert.equal(
          domain.resolveConflictBlock(input, 0, choice, marker),
          'before\0' + newline + text + 'after',
        );
        assert.equal(
          domain.resolveConflictBlock(input, 0, choice, marker),
          old.resolveConflictBlock(input, 0, choice, marker),
        );
      }
      for (const [index, raw] of [
        [1, marker],
        [0, 'stale'],
      ])
        assert.throws(() => domain.resolveConflictBlock(input, index, 'current', raw), {
          name: 'Error',
          message: '文件内容已变化，请刷新后重新选择。',
        });
      assert.equal(domain.conflictBlocks(input + input).length, 2);
    }
  for (const input of ['', 'ordinary\n<<<<<<< HEAD\nincomplete', '<<<<<<< HEAD\nx\n=======\ny']) {
    assert.deepEqual(domain.conflictBlocks(input), []);
    assert.deepEqual(domain.parseConflictMarkers(input), old.parseConflictMarkers(input));
  }
  assert.ok(new domain.ConflictMarkerError('example') instanceof Error);
  assert.equal(
    new domain.ConflictMarkerError('example').message,
    new old.ConflictMarkerError('example').message,
  );
});

test('P0 shared partial patches preserve snapshot row IDs and reject incomplete hunks', () => {
  const patch =
    'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+新🙂\n\\ No newline at end of file\n';
  const expected = [
    {
      index: 0,
      headerIndex: 3,
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 2,
      rows: [
        { index: 4, kind: 'context', content: 'keep\n' },
        { index: 5, kind: 'remove', content: 'old\n' },
        { index: 6, kind: 'add', content: '新🙂' },
      ],
    },
  ];
  assert.deepEqual(domain.parsePatchHunks(patch), expected);
  assert.deepEqual(old.parsePatchHunks(patch), expected);
  for (const input of ['', 'Binary files a/x and b/x differ', '@@ malformed @@\n+bad'])
    assert.deepEqual(domain.parsePatchHunks(input), []);
  for (const input of [
    '@@ -1,2 +1,2 @@\n one\n',
    '@@ -1 +1 @@\n-old\n',
    '@@ -0,0 +1 @@\n+one\n+extra',
  ]) {
    assert.throws(() => domain.parsePatchHunks(input), { message: '差异不完整，请刷新后重试。' });
    assert.throws(() => old.parsePatchHunks(input), { message: '差异不完整，请刷新后重试。' });
  }
  const crlf = '@@ -1 +1 @@\r\n-old\r\n+新\r\n';
  assert.deepEqual(domain.parsePatchHunks(crlf), old.parsePatchHunks(crlf));
  assert.equal(domain.parsePatchHunks(crlf)[0].rows[1].content, '新\r\n');
});

test('P0 shared PR ranges reject truncated and cross-file hunks while preserving complete locations', () => {
  const patch = '@@ -1,2 +1,2 @@\n keep\n-old\n+新\n';
  assert.deepEqual(protocol.pullRequestDiffLines(patch), old.pullRequestDiffLines(patch));
  for (const side of ['LEFT', 'RIGHT']) {
    const range = { side, startLine: 1, endLine: 1 };
    assert.deepEqual(protocol.pullRequestRange(patch, range), old.pullRequestRange(patch, range));
    assert.equal(protocol.pullRequestRange(patch, range)[0].text, ' keep');
    const longer = protocol.pullRequestRange(patch, { ...range, endLine: 2 });
    if (side === 'LEFT')
      assert.deepEqual(
        longer.map((r) => r.text),
        [' keep', '-old'],
      );
    else assert.equal(longer, null, 'right range cannot straddle a removal');
  }
  for (const complete of [
    '',
    'Binary files a/x and b/x differ',
    patch.replaceAll('\n', '\r\n'),
    '@@ -0,0 +1 @@\n+新🙂\n',
    '@@ -1 +0,0 @@\n-old\n',
    '@@ -1 +1 @@\n same\n@@ -9 +11 @@\n-旧\n+新',
    '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n',
  ])
    assert.deepEqual(protocol.pullRequestDiffLines(complete), old.pullRequestDiffLines(complete));
  const short = '@@ -1,3 +1,3 @@\n keep\n';
  const range = { side: 'RIGHT', startLine: 1, endLine: 1 };
  assert.equal(old.pullRequestRange(short, range).length, 1, 'frozen regression witness');
  assert.equal(protocol.pullRequestRange(short, range), null);
  assert.equal(
    protocol.pullRequestDiffLines(short).some((r) => r.oldLine || r.newLine),
    false,
  );
  const nextFile = short + 'diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -9 +9 @@\n ok\n';
  assert.equal(protocol.pullRequestRange(nextFile, range), null);
  assert.equal(
    protocol.pullRequestRange(nextFile, { side: 'RIGHT', startLine: 9, endLine: 9 })[0].text,
    ' ok',
  );
  for (const input of ['@@ -9007199254740992 +1 @@\n one\n', short + '@@ malformed @@\n one\n'])
    assert.equal(protocol.pullRequestRange(input, range), null);
  for (const input of [
    { side: 'BAD', startLine: 1, endLine: 1 },
    { side: 'LEFT', startLine: 0, endLine: 1 },
    { side: 'RIGHT', startLine: 2, endLine: 1 },
    { side: 'RIGHT', startLine: 1.5, endLine: 2 },
  ])
    assert.equal(protocol.pullRequestRange(patch, input), null);
  const { codeCommentPayload } = req(
    '../../packages/agent/dist/modules/reviews/pull-request-actions.js',
  );
  const detail = {
    head: { sha: 'head' },
    diff_refs: { base_sha: 'base', start_sha: 'start', head_sha: 'head' },
  };
  for (const provider of ['github', 'gitlab'])
    assert.throws(
      () =>
        codeCommentPayload({ provider, position: range, body: 'comment' }, detail, {
          path: 'a.txt',
          patch: short,
        }),
      (e) => e.getStatus() === 409 && /此选区不支持评论/.test(e.message),
    );
  assert.deepEqual(
    codeCommentPayload({ provider: 'github', position: range, body: 'comment' }, detail, {
      path: 'a.txt',
      patch,
    }),
    { body: 'comment', commit_id: 'head', path: 'a.txt', side: 'RIGHT', line: 1 },
  );
  assert.deepEqual(
    codeCommentPayload({ provider: 'gitlab', position: range, body: 'comment' }, detail, {
      path: 'a.txt',
      patch,
    }),
    {
      body: 'comment',
      position: {
        position_type: 'text',
        base_sha: 'base',
        start_sha: 'start',
        head_sha: 'head',
        old_path: 'a.txt',
        new_path: 'a.txt',
        old_line: 1,
        new_line: 1,
      },
    },
  );
  save('pr-truncation-regression', {
    short,
    range,
    frozen: old.pullRequestRange(short, range),
    candidate: protocol.pullRequestRange(short, range),
    nextFile,
  });
});

test('P0 shared constants retain exact budgets without implying enforcement', () => {
  const expected = {
    BLAME_MAX_BYTES: 262144,
    BLAME_MAX_LINES: 5000,
    BLAME_TIMEOUT_MS: 15000,
    ANALYTICS_DAY_MS: 86400000,
    ANALYTICS_CACHE_MS: 300000,
    ANALYTICS_BATCH_SIZE: 20,
    LOG_LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    LOGGING_LIMITS: {
      retentionDays: { min: 1, max: 365, default: 14 },
      maxTotalMB: { min: 20, max: 10240, default: 200 },
      fileMB: 20,
      history: 1000,
    },
  };
  for (const [name, value] of Object.entries(expected)) {
    const next = name.startsWith('LOG') ? protocol : domain;
    assert.deepEqual(next[name], value);
    assert.deepEqual(old[name], value);
  }
});

test('P0 shared rebase validates complete plans and exact grouping without mutating input', () => {
  const commits = ['a', 'b', 'c', 'd'].map((hash) => ({
    hash,
    message: hash,
    author: 'dev',
    published: false,
  }));
  const entries = [
    { hash: 'b', action: 'reword', message: '中文🙂' },
    { hash: 'a', action: 'squash', message: 'combined' },
    { hash: 'c', action: 'fixup' },
    { hash: 'd', action: 'drop' },
  ];
  const copy = structuredClone(entries);
  assert.deepEqual(domain.previewRebasePlan(commits, entries), [
    { hashes: ['b', 'a', 'c'], message: 'combined' },
  ]);
  assert.deepEqual(
    domain.previewRebasePlan(commits, entries),
    old.previewRebasePlan(commits, entries),
  );
  assert.deepEqual(entries, copy);
  const plain = commits.map(({ hash }) => ({ hash, action: 'pick' }));
  const bad = [
    [],
    [...plain.slice(0, 3), plain[0]],
    [{ ...plain[0], hash: 'unknown' }, ...plain.slice(1)],
    [{ ...plain[0], action: 'fixup' }, ...plain.slice(1)],
    [{ ...plain[0], action: 'BAD' }, ...plain.slice(1)],
    ...['', 'bad\0', '中'.repeat(10923)].map((message) => [
      { ...plain[0], action: 'reword', message },
      ...plain.slice(1),
    ]),
    [{ ...plain[0], message: 'x'.repeat(922000) }, ...plain.slice(1)],
  ];
  for (const plan of bad) {
    let expected;
    try {
      old.previewRebasePlan(commits, plan);
    } catch (e) {
      expected = e.message;
    }
    assert.ok(expected);
    assert.throws(() => domain.previewRebasePlan(commits, plan), { message: expected });
  }
});

test('P0 shared image types preserve case normalization and unsupported extensions', () => {
  const media = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  assert.deepEqual(domain.DIFF_IMAGE_MEDIA_TYPES, media);
  assert.deepEqual(old.DIFF_IMAGE_MEDIA_TYPES, media);
  assert.equal(domain.DIFF_IMAGE_MAX_BYTES, 5242880);
  assert.equal(old.DIFF_IMAGE_MAX_BYTES, 5242880);
  const budgets = {
    REPOSITORY_STATUS_TIMEOUT_MS: 10000,
    REPOSITORY_FOREGROUND_STATUS_TIMEOUT_MS: 120000,
    REPOSITORY_STATUS_REQUEST_TIMEOUT_MS: 12000,
    REPOSITORY_STATUS_CACHE_MS: 60000,
    REPOSITORY_TREE_MAX_ENTRIES: 5000,
    REPOSITORY_TEXT_PREVIEW_MAX_BYTES: 1048576,
  };
  for (const [name, expected] of Object.entries(budgets)) {
    assert.equal(domain[name], expected);
    assert.equal(old[name], expected);
  }
  for (const [input, expected] of [
    ['x.PNG', 'image/png'],
    ['x.jpg', 'image/jpeg'],
    ['x.jpeg', 'image/jpeg'],
    ['x.gif', 'image/gif'],
    ['x.webp', 'image/webp'],
    ['x.svg', null],
    ['中文', null],
    ['.gif', null],
  ]) {
    assert.equal(domain.diffImageMediaType(input), expected);
    assert.equal(old.diffImageMediaType(input), expected);
  }
});

test('P0 shared terminal models retain confirmations and public SSH labels', () => {
  assert.deepEqual(domain.TERMINAL_LIMITS, {
    sessions: 8,
    historyLines: 10000,
    historyBytes: 2097152,
    packetBytes: 16384,
    inputBytes: 16384,
    pendingBytes: 262144,
    windowBytes: 65536,
  });
  assert.deepEqual(domain.TERMINAL_LIMITS, old.TERMINAL_LIMITS);
  for (const [state, expected] of [
    ['connecting', true],
    ['running', true],
    ['failed', false],
    ['exited', false],
    ['disconnected', false],
  ]) {
    assert.equal(domain.terminalNeedsConfirmation({ state }), expected);
    assert.equal(old.terminalNeedsConfirmation({ state }), expected);
  }
  const profile = { name: '主机🙂', username: 'alice', host: 'fixture.invalid' };
  assert.equal(domain.sshTerminalEnvironment(profile), 'SSH · 主机🙂 · alice@fixture.invalid');
  // sshTerminalEnvironment was added after the frozen declaration set.
});

test('P0 shared public entrypoints load without host globals or external I/O modules', () => {
  const cache = new Map(),
    loaded = [];
  function load(file) {
    file = path.resolve(file);
    assert.ok(
      ['domain', 'protocol'].some((p) =>
        file.startsWith(path.join(root, 'packages', p, 'dist') + path.sep),
      ),
    );
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const sandbox = {
      module,
      exports: module.exports,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      require(specifier) {
        if (specifier === '@alune/domain')
          return load(path.join(root, 'packages/domain/dist/index.js'));
        assert.ok(specifier.startsWith('.'), 'forbidden runtime import: ' + specifier);
        return load(path.resolve(path.dirname(file), specifier + '.js'));
      },
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 1000 });
    loaded.push(file);
    return module.exports;
  }
  for (const pkg of ['domain', 'protocol'])
    assert.ok(Object.keys(load(path.join(root, 'packages', pkg, 'dist/index.js'))).length);
  assert.ok(loaded.length >= 20);
  save('pure-runtime-imports', {
    loaded: loaded.map((f) => ({ path: path.relative(root, f), sha256: hash(fs.readFileSync(f)) })),
    denied: [
      'Node builtins',
      'Electron',
      'SSH',
      'process',
      'fetch',
      'timers',
      'document',
      'window',
    ],
  });
});

test('P0 shared aggregate audit preserves the unresolved retired event and barrel IDs', () => {
  const incompatible = contracts.filter((r) => !r.compatible);
  assert.deepEqual(
    incompatible.map((r) => r.name).sort(),
    [
      'CommandExitEvent',
      'CommandOutputEvent',
      'ConnectionStatusEvent',
      'RepositoryStatusEvent',
      'ServerEvents',
    ].sort(),
  );
  assert.equal(audit.length, 18);
  const values = {
    'P0-DOMAIN-2238': ['changeActions', 'changeKindLabel'],
    'P0-DOMAIN-2242': ['parseLfsPointer', 'LFS_STATUS_TIMEOUT_MS'],
    'P0-DOMAIN-2248': [
      'ConflictMarkerError',
      'parseConflictMarkers',
      'conflictBlocks',
      'resolveConflictBlock',
    ],
    'P0-DOMAIN-2255': ['parsePatchHunks'],
    'P0-DOMAIN-2263': ['pullRequestDiffLines', 'pullRequestRange'],
    'P0-PROTOCOL-2283': ['BLAME_MAX_BYTES', 'BLAME_MAX_LINES', 'BLAME_TIMEOUT_MS'],
    'P0-PROTOCOL-2306': ['LOG_LEVELS', 'LOGGING_LIMITS'],
    'P0-PROTOCOL-2353': ['previewRebasePlan'],
    'P0-PROTOCOL-2365': ['ANALYTICS_DAY_MS', 'ANALYTICS_CACHE_MS', 'ANALYTICS_BATCH_SIZE'],
    'P0-PROTOCOL-2371': [
      'DIFF_IMAGE_MEDIA_TYPES',
      'DIFF_IMAGE_MAX_BYTES',
      'diffImageMediaType',
      'REPOSITORY_STATUS_TIMEOUT_MS',
      'REPOSITORY_FOREGROUND_STATUS_TIMEOUT_MS',
      'REPOSITORY_STATUS_REQUEST_TIMEOUT_MS',
      'REPOSITORY_STATUS_CACHE_MS',
      'REPOSITORY_TREE_MAX_ENTRIES',
      'REPOSITORY_TEXT_PREVIEW_MAX_BYTES',
    ],
    'P0-PROTOCOL-2428': ['TERMINAL_LIMITS', 'terminalNeedsConfirmation'],
  };
  for (const row of audit) {
    assert.deepEqual(
      row.runtimeExportNames.sort(),
      (values[row.scenarioId] ?? []).sort(),
      'every runtime export needs its reviewed assertions',
    );
    if (row.runtimeExportNames.length) assert.ok(row.runtime, row.scenarioId);
  }
  save('module-audit', {
    modules: audit,
    unresolved,
    incompatibleEventContracts: incompatible,
    fullExportCount: contracts.length,
    associationCount: 18,
    releaseEligible: false,
  });
});
