const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync, execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const current = require('../dist/modules/git/repository-transport').runGit;
const { NativeRepositoryConnection } = require('../dist/adapters/git/native');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const oldFile = 'packages/ssh-client/src/repository-transport.ts';
const shellFile = 'packages/ssh-client/src/git-shell.ts';
const managerFile = 'packages/ssh-client/src/connection-manager.ts';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
const missing = { exitCode: 1, stdout: '', stderr: '/bin/sh: git-lfs: not found' };
const fallback = [
  '-c',
  'filter.lfs.required=false',
  '-c',
  'filter.lfs.process=',
  '-c',
  'filter.lfs.clean=',
  '-c',
  'filter.lfs.smudge=',
];
function proof(name, value) {
  if (process.env.P0_GIT_TRANSPORT_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_GIT_TRANSPORT_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function source(file) {
  const text = fs.readFileSync(path.join(process.env.P0_GIT_TRANSPORT_FROZEN, file), 'utf8');
  assert.equal(
    text,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  return text;
}
function frozen() {
  const shell = { exports: {} },
    module = { exports: {} },
    imports = [];
  const compile = (text) =>
    ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  vm.runInNewContext(compile(source(shellFile)), { module: shell, exports: shell.exports, Buffer });
  vm.runInNewContext(compile(source(oldFile)), {
    module,
    exports: module.exports,
    AbortSignal,
    require(id) {
      imports.push(id);
      assert.equal(id, './git-shell');
      return shell.exports;
    },
  });
  assert.deepEqual(imports, ['./git-shell']);
  assert.deepEqual(Object.keys(module.exports), ['runGit']);
  return module.exports.runGit;
}
function temp(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alune-transport-p0-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('P0 Git transport complete frozen source exports and typed ports preserve valid and reject invalid contracts', (t) => {
  const directory = temp(t),
    text = source(oldFile);
  const ast = ts.createSourceFile(oldFile, text, ts.ScriptTarget.Latest, true);
  assert.deepEqual(
    ast.statements.filter((s) => s.name).map((s) => s.name.text),
    ['CommandOptions', 'RepositoryTransport', 'runGit'],
  );
  const optionsAlias = ast.statements.find((s) => s.name?.text === 'CommandOptions');
  assert.deepEqual(
    optionsAlias.type.members.map((m) => m.name.text),
    ['onStderr', 'onStdout', 'stdin', 'maxOutputBytes', 'strictUtf8', 'binary', 'environment'],
  );
  const managerText = source(managerFile),
    manager = ts.createSourceFile(managerFile, managerText, ts.ScriptTarget.Latest, true);
  const conn = manager.statements.find(
    (s) => ts.isClassDeclaration(s) && s.name.text === 'SSHConnection',
  );
  const signatures = ['execCommand', 'withSftp'].map((name) => {
    const m = conn.members.find((m) => m.name?.getText(manager) === name);
    return managerText.slice(m.getStart(manager), m.body.pos).replace(/^async\s+/, '') + ';';
  });
  const result = manager.statements
    .find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'CommandResult')
    .getText(manager);
  fs.writeFileSync(
    path.join(directory, 'connection-manager.d.ts'),
    "import type { SFTPWrapper } from 'ssh2';\n" +
      result +
      '\nexport declare class SSHConnection {\n' +
      signatures.join('\n') +
      '\n}',
  );
  fs.writeFileSync(path.join(directory, 'repository-transport.ts'), text);
  fs.writeFileSync(path.join(directory, 'git-shell.ts'), source(shellFile));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const positive = `
const options: CommandOptions = {onStderr: (s: string) => {}, onStdout: (s: string) => {}, stdin: Buffer.from([0,255]), maxOutputBytes: 32, strictUtf8: true, binary: false, environment: {FIXTURE:'v'}};
const textOptions: CommandOptions = {...options, stdin: '中文'};
const empty: CommandOptions = {};
declare const connection: RepositoryTransport;
connection.execCommand('git', undefined, new AbortController().signal, options);
connection.withSftp(async (files) => { files.stat('fixture', () => {}); return 1; });
connection.hasAnyPath?.(['fixture']);
connection.execGit?.('/fixture', ['status'], connection.signal, options);
runGit(connection, '/fixture', ['status'], connection.signal, textOptions);
`;
  const negative = [
    `const bad: CommandOptions = {onStdout: (n: number) => {}};`,
    `const bad: CommandOptions = {onStderr: 'text'};`,
    `const bad: CommandOptions = {stdin: [0,255]};`,
    `const bad: CommandOptions = {maxOutputBytes: '32'};`,
    `const bad: CommandOptions = {strictUtf8: 'yes'};`,
    `const bad: CommandOptions = {binary: 1};`,
    `const bad: CommandOptions = {environment: {FIXTURE: 42}};`,
    `const bad: RepositoryTransport = {};`,
    `const bad: RepositoryTransport = {execCommand: connection.execCommand};`,
    `const bad: RepositoryTransport = {...connection, signal: {aborted: false}};`,
    `const bad: RepositoryTransport = {...connection, hasAnyPath: async () => 'yes'};`,
    `const bad: RepositoryTransport = {...connection, execGit: async () => ({stdout:'x'})};`,
    `runGit(connection, '/fixture', [1]);`,
    `runGit(connection, '/fixture', ['status'], 'signal');`,
  ];
  const rows = [];
  for (const [label, module] of [
    ['frozen', './repository-transport'],
    ['current', path.join(root, 'packages/agent/dist/modules/git/repository-transport')],
  ]) {
    const file = path.join(directory, label + '-contract.ts');
    const prelude = `import { CommandOptions, RepositoryTransport, runGit } from ${JSON.stringify(module)};\n`;
    const compiler = {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      ignoreDeprecations: '6.0',
      types: ['node'],
      typeRoots: [path.join(root, 'node_modules/@types')],
    };
    const diagnostics = (body) => {
      fs.writeFileSync(file, prelude + positive + body);
      return ts.getPreEmitDiagnostics(ts.createProgram([file], compiler)).map((d) => ({
        file: d.file && path.basename(d.file.fileName),
        line: d.file && d.file.getLineAndCharacterOfPosition(d.start).line + 1,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      }));
    };
    assert.deepEqual(diagnostics(''), []);
    // Every directive must suppress an error. An accepted bad shape yields TS2578.
    assert.deepEqual(
      diagnostics(negative.map((s, i) => `// @ts-expect-error negative ${i}\n{${s}}`).join('\n')),
      [],
    );
    const rejected = diagnostics(negative.map((s) => `{${s}}`).join('\n'));
    const startLine = (prelude + positive).split('\n').length;
    assert.equal(
      new Set(
        rejected
          .filter((d) => d.file === path.basename(file) && d.line >= startLine)
          .map((d) => d.line),
      ).size,
      negative.length,
    );
    rows.push({ label, valid: true, negativeCases: negative, rejected });
  }
  assert.equal(typeof frozen(), 'function');
  proof('transport-type-contracts', {
    sourceSha256: hash(text),
    signatures,
    resultDeclaration: result,
    rows,
    boundary:
      'Exact full frozen transport and git-shell sources; SSH class dependency represented by its exact extracted two method signatures, not a live SSH instance. Types are internal contracts, not RPC authorization.',
  });
});

test('P0 Git transport both routes preserve exact args options result errors and stash LFS pathspec policy', async () => {
  const rows = [];
  for (const [label, run] of [
    ['frozen', frozen()],
    ['current', current],
  ]) {
    for (const route of ['execGit', 'execCommand']) {
      const options = {
        stdin: Buffer.from([0, 255]),
        maxOutputBytes: 2048,
        binary: true,
        strictUtf8: false,
        environment: { FIXTURE: "value ' $()" },
        onStdout() {},
        onStderr() {},
      };
      for (const verb of ['status', 'stash', 'lfs', 'add']) {
        const args = [verb, '--', "中文 ' $() [*]"],
          original = [...args],
          result = { ...ok('kept'), stdoutBytes: Buffer.from([255, 0]) };
        let calls = 0;
        const conn = {
          [route]: async (...actual) => {
            calls++;
            if (route === 'execGit') {
              assert.equal(actual[0], "/repo ' $()中文");
              assert.deepEqual(
                Array.from(actual[1]),
                ['stash', 'lfs'].includes(verb) ? ['--no-literal-pathspecs', ...args] : args,
              );
              assert.equal(actual[3], options);
            } else {
              const expected = require('../dist/modules/git/git-shell').gitFileCommand(
                "/repo ' $()中文",
                ['stash', 'lfs'].includes(verb) ? ['--no-literal-pathspecs', ...args] : args,
                options.environment,
              );
              assert.equal(actual[0], expected);
              assert.equal(actual[1], undefined);
              assert.equal(actual[3], options);
            }
            return result;
          },
        };
        assert.equal(await run(conn, "/repo ' $()中文", args, undefined, options), result);
        assert.deepEqual(args, original);
        assert.equal(calls, 1);
        rows.push({ label, route, verb, calls, identity: true });
      }
      for (const error of [new Error('transport failed'), 'raw transport failure']) {
        let count = 0,
          caught;
        try {
          await run(
            {
              [route]: () => {
                count++;
                throw error;
              },
            },
            '/repo',
            ['status'],
          );
        } catch (e) {
          caught = e;
        }
        assert.equal(caught, error);
        assert.equal(count, 1);
      }
    }
    let fallbackCalls = 0;
    const chosen = await run(
      {
        execGit: async () => ok('structured'),
        execCommand: async () => {
          fallbackCalls++;
          return ok('shell');
        },
      },
      '/repo',
      ['status'],
    );
    assert.equal(chosen.stdout, 'structured');
    assert.equal(fallbackCalls, 0);
  }
  proof('transport-delegation', {
    rows,
    errorsAndResultsPreserveIdentity: true,
    callerArgvUnchanged: true,
  });
});

test('P0 Git transport retries only missing LFS read status diff once and never retries writes or thrown failures', async () => {
  const rows = [];
  for (const [label, run] of [
    ['frozen', frozen()],
    ['current', current],
  ]) {
    for (const route of ['execGit', 'execCommand']) {
      for (const [args, response, retries] of [
        [['status', '--short'], missing, 1],
        [['diff', '--cached'], { ...missing, stderr: 'git-lfs: No such file' }, 1],
        [
          ['-c', 'core.quotepath=false', '--no-optional-locks', 'diff'],
          { ...missing, stderr: 'GIT-LFS is not recognized' },
          1,
        ],
        [['status'], ok('git-lfs not found'), 0],
        [['status'], { ...missing, stderr: 'permission denied' }, 0],
        ...['add', 'commit', 'reset', 'checkout', 'stash', 'lfs', 'fetch', 'push', 'show'].map(
          (verb) => [[verb], missing, 0],
        ),
      ]) {
        const invocations = [],
          options = { maxOutputBytes: 512, environment: { FIXTURE: 'v' } },
          terminal = { ...missing, stderr: 'fallback also failed' };
        const conn = {
          [route]: async (...argv) => {
            invocations.push(argv);
            return invocations.length === 1 ? response : terminal;
          },
        };
        assert.equal(
          await run(conn, '/fixture', args, undefined, options),
          retries ? terminal : response,
        );
        assert.equal(invocations.length, 1 + retries);
        for (const call of invocations) assert.equal(call[3], options);
        if (retries) {
          if (route === 'execGit')
            assert.deepEqual(Array.from(invocations[1][1]), [...fallback, ...args]);
          else
            assert.equal(
              invocations[1][0],
              require('../dist/modules/git/git-shell').gitFileCommand(
                '/fixture',
                [...fallback, ...args],
                options.environment,
              ),
            );
        }
        rows.push({ label, route, args, calls: invocations.length, exitCode: response.exitCode });
      }
      const failure = new Error('unknown write outcome: git-lfs not found');
      let calls = 0;
      await assert.rejects(
        run(
          {
            [route]: async () => {
              calls++;
              throw failure;
            },
          },
          '/fixture',
          ['commit'],
        ),
        (e) => e === failure,
      );
      assert.equal(calls, 1);
      calls = 0;
      await assert.rejects(
        run(
          {
            [route]: async () => {
              if (++calls === 1) return missing;
              throw failure;
            },
          },
          '/fixture',
          ['status'],
        ),
        (e) => e === failure,
      );
      assert.equal(calls, 2);
    }
  }
  proof('transport-read-fallback', {
    rows,
    thrownFailureIdentity: true,
    noThirdAttempt: true,
    boundary:
      'Only status/diff missing-tool results permit one read fallback. No write retry; a thrown read error is not classified as missing LFS.',
  });
});

test('P0 Git transport cancellation combines both owners rejects before dispatch and prevents cancelled fallback', async () => {
  const rows = [];
  for (const [label, run] of [
    ['frozen', frozen()],
    ['current', current],
  ])
    for (const route of ['execGit', 'execCommand']) {
      for (const owner of ['request', 'lifetime'])
        for (const phase of ['before', 'during']) {
          const request = new AbortController(),
            lifetime = new AbortController(),
            controller = owner === 'request' ? request : lifetime,
            reason = new Error(owner + ' cancelled');
          let calls = 0,
            received;
          if (phase === 'before') controller.abort(reason);
          const work = run(
            {
              signal: lifetime.signal,
              [route]: (...actual) => {
                calls++;
                received = actual[2];
                assert.notEqual(received, request.signal);
                assert.notEqual(received, lifetime.signal);
                return new Promise((_resolve, reject) =>
                  received.addEventListener('abort', () => reject(received.reason), { once: true }),
                );
              },
            },
            '/fixture',
            ['status'],
            request.signal,
          );
          const rejected = assert.rejects(work, (e) => e === reason);
          if (phase === 'during') controller.abort(reason);
          await rejected;
          assert.equal(calls, phase === 'before' ? 0 : 1);
          rows.push({ label, route, owner, phase, calls });
        }
      for (const owner of ['request', 'lifetime']) {
        const request = new AbortController(),
          lifetime = new AbortController(),
          reason = new Error('between attempts');
        let calls = 0,
          caught;
        try {
          await run(
            {
              signal: lifetime.signal,
              [route]: async () => {
                if (++calls === 1) {
                  (owner === 'request' ? request : lifetime).abort(reason);
                  return missing;
                }
                return ok();
              },
            },
            '/fixture',
            ['status'],
            request.signal,
          );
        } catch (e) {
          caught = e;
        }
        assert.equal(calls, label === 'frozen' ? 2 : 1);
        assert.equal(caught, label === 'frozen' ? undefined : reason);
        rows.push({
          label,
          route,
          owner,
          phase: 'between attempts',
          calls,
          originalReason: caught === reason,
        });
      }
      for (const mode of ['none', 'request', 'lifetime']) {
        const controller = new AbortController();
        let received;
        await run(
          {
            signal: mode === 'lifetime' ? controller.signal : undefined,
            [route]: async (...a) => {
              received = a[2];
              return ok();
            },
          },
          '/fixture',
          ['status'],
          mode === 'request' ? controller.signal : undefined,
        );
        assert.equal(received, mode === 'none' ? undefined : controller.signal);
      }
    }
  proof('transport-cancellation', {
    rows,
    boundary:
      'Recording transports test exact AbortSignal ownership and deliberate late completion; frozen source permits cancelled fallback, successor strengthens cancellation. In-flight native process cleanup is independently tested by companion.',
  });
});

test('P0 Git transport real native and POSIX fallback preserve literal bytes stdin environment callbacks and index', async (t) => {
  const directory = temp(t),
    repo = path.join(directory, "repo ' $() 中文");
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'empty-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const name = "literal ' $() [*] 中文.bin",
    bytes = Buffer.from([0, 255, 128, 10, 13]);
  fs.writeFileSync(path.join(repo, name), bytes);
  git('add', '--', name);
  git('commit', '-qm', 'fixture');
  const index = hash(fs.readFileSync(path.join(repo, '.git/index'))),
    rows = [];
  const connection = new NativeRepositoryConnection();
  t.after(() => connection.close());
  for (const [label, run] of [
    ['frozen', frozen()],
    ['current', current],
  ]) {
    for (const route of ['native', 'POSIX shell']) {
      const commands = [];
      const conn =
        route === 'native'
          ? connection
          : {
              execCommand: (command, cwd, signal, options) =>
                new Promise((resolve, reject) => {
                  commands.push(command);
                  assert.equal(cwd, undefined);
                  const child = execFile(
                    '/bin/sh',
                    ['-c', command],
                    { cwd: directory, env, signal, encoding: 'buffer', maxBuffer: 1 << 20 },
                    (error, stdout, stderr) => {
                      if (error && typeof error.code !== 'number') return reject(error);
                      options?.onStdout?.(stdout.toString('utf8'));
                      options?.onStderr?.(stderr.toString('utf8'));
                      resolve({
                        exitCode: error?.code ?? 0,
                        stdout: options?.binary ? '' : stdout.toString('utf8'),
                        stderr: stderr.toString('utf8'),
                        ...(options?.binary ? { stdoutBytes: stdout } : {}),
                      });
                    },
                  );
                  child.stdin.end(options?.stdin);
                }),
            };
      const binary = await run(conn, repo, ['show', `HEAD:${name}`], undefined, { binary: true });
      assert.equal(binary.exitCode, 0);
      assert.deepEqual(binary.stdoutBytes, bytes);
      const input = Buffer.from('中文\u0000binary\n'),
        expected = hash(input);
      // hash-object --stdin is read-only without -w, and takes both Buffer/text inputs.
      for (const stdin of [input, '中文\u0000binary\n']) {
        let stdout = '',
          stderr = '';
        const actual = await run(conn, repo, ['hash-object', '--stdin'], undefined, {
          stdin,
          onStdout: (s) => {
            stdout += s;
          },
          onStderr: (s) => {
            stderr += s;
          },
        });
        assert.match(actual.stdout, /^[a-f0-9]{40}\n$/);
        assert.equal(stdout, actual.stdout);
        assert.equal(stderr, '');
        assert.equal(
          actual.stdout.trim(),
          execFileSync('git', ['hash-object', '--stdin'], {
            env,
            input: stdin,
            encoding: 'utf8',
          }).trim(),
        );
      }
      const marker = path.join(directory, 'injection-marker');
      const literal = `x ' $(touch ${marker})`;
      const value = await run(conn, repo, ['var', 'GIT_AUTHOR_IDENT'], undefined, {
        environment: { GIT_AUTHOR_NAME: literal, GIT_AUTHOR_EMAIL: 'fixture@example.invalid' },
      });
      assert(value.stdout.startsWith(literal + ' <fixture@example.invalid>'));
      assert(!fs.existsSync(marker));
      let errorOutput = '';
      const failed = await run(
        conn,
        repo,
        ['rev-parse', '--verify', 'refs/heads/alune-fixture-missing'],
        undefined,
        {
          onStderr: (s) => {
            errorOutput += s;
          },
        },
      );
      assert.notEqual(failed.exitCode, 0);
      assert(failed.stderr.length > 0);
      assert.equal(errorOutput, failed.stderr);
      rows.push({
        label,
        route,
        binary: binary.stdoutBytes.toString('hex'),
        stdinSha256: expected,
        literalEnvironment: true,
        commands,
      });
    }
    await assert.rejects(
      run(connection, repo, ['show', `HEAD:${name}`], undefined, { strictUtf8: true }),
    );
    await assert.rejects(
      run(connection, repo, ['show', `HEAD:${name}`], undefined, { maxOutputBytes: 4 }),
      /preview limit/,
    );
    let calls = 0;
    await assert.rejects(
      run(
        {
          execCommand: async () => {
            calls++;
            return ok();
          },
        },
        repo,
        ['status'],
        undefined,
        { environment: { 'INVALID-NAME': 'x' } },
      ),
      /environment/,
    );
    assert.equal(calls, 0);
  }
  assert.equal(hash(fs.readFileSync(path.join(repo, '.git/index'))), index);
  proof('transport-real-native-shell', {
    rows,
    indexUnchanged: true,
    boundary:
      'Real native Git and actual /bin/sh with exact frozen/current quoting on current Mac. Shell process port is a test adapter with explicit Buffer decoding; not a live SSH channel or Windows execution.',
  });
});

test('P0 Git transport actual missing LFS filters allow read fallback but never retry a failed add', async (t) => {
  const directory = temp(t),
    repo = path.join(directory, 'required-lfs');
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'empty-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'filter.lfs.required', 'true');
  git('config', 'filter.lfs.process', 'git-lfs-alune-fixture-missing filter-process');
  fs.writeFileSync(path.join(repo, '.gitattributes'), '*.bin filter=lfs\n');
  fs.writeFileSync(path.join(repo, 'tracked.bin'), 'before\n');
  git(...fallback, 'add', '--', '.');
  git(...fallback, 'commit', '-qm', 'fixture');
  // Equal byte size forces status to run the clean filter instead of concluding
  // modification from size alone. Force a distinct mtime without waiting.
  fs.writeFileSync(path.join(repo, 'tracked.bin'), 'after!\n');
  fs.utimesSync(path.join(repo, 'tracked.bin'), new Date(), new Date(Date.now() + 2000));
  const index = hash(fs.readFileSync(path.join(repo, '.git/index'))),
    content = fs.readFileSync(path.join(repo, 'tracked.bin'));
  const native = new NativeRepositoryConnection();
  t.after(() => native.close());
  const rows = [];
  for (const [label, run] of [
    ['frozen', frozen()],
    ['current', current],
  ])
    for (const verb of ['status', 'diff', 'add']) {
      const calls = [],
        options = { maxOutputBytes: 1 << 20 };
      const connection = {
        execGit: async (p, args, signal, actualOptions) => {
          assert.equal(actualOptions, options);
          const result = await native.execGit(p, args, signal, actualOptions);
          calls.push({ args: Array.from(args), exitCode: result.exitCode, stderr: result.stderr });
          return result;
        },
      };
      const result = await run(connection, repo, [verb, '--', 'tracked.bin'], undefined, options);
      assert.notEqual(calls[0].exitCode, 0, label + ' ' + verb + ' must exercise missing filter');
      assert.match(calls[0].stderr, /git-lfs[^\n]*(?:not found|not recognized|No such file)/i);
      if (verb === 'add') {
        assert.equal(calls.length, 1);
        assert.notEqual(result.exitCode, 0);
      } else {
        assert.equal(calls.length, 2);
        assert.equal(result.exitCode, 0);
        assert.deepEqual(calls[1].args, [...fallback, verb, '--', 'tracked.bin']);
        assert(result.stdout.includes('tracked.bin'));
      }
      assert.equal(hash(fs.readFileSync(path.join(repo, '.git/index'))), index);
      assert.deepEqual(fs.readFileSync(path.join(repo, 'tracked.bin')), content);
      rows.push({ label, verb, calls, finalExit: result.exitCode });
    }
  proof('transport-real-missing-lfs', {
    rows,
    indexUnchanged: true,
    contentUnchanged: true,
    boundary:
      'Actual Git launches a deliberately nonexistent filter from a disposable repo config. No git-lfs installation/uninstallation or user repository changes.',
  });
});

test('P0 Git transport SDK stdio keeps repository owner identity and forbids arbitrary Git execution', async (t) => {
  const { spawnAgent } = require('@alune/agent-client/node');
  const { randomUUID } = require('node:crypto');
  const directory = temp(t),
    repo = path.join(directory, 'owner repo');
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(directory, 'empty-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'preserved\n');
  git('add', '--', 'tracked.txt');
  git('commit', '-qm', 'fixture');
  const index = hash(fs.readFileSync(path.join(repo, '.git/index'))),
    head = git('rev-parse', 'HEAD');
  const child = spawnAgent(process.execPath, [
    path.join(__dirname, 'settings-fixture.cjs'),
    path.join(directory, 'state'),
  ]);
  t.after(() => child.close());
  try {
    const init = await child.client.initialize();
    const registered = await child.client.registerRepository(repo);
    assert.equal(registered.resource.agentId, init.agentId);
    const status = await child.client.readRepository(registered.resource, 'status', {});
    assert.equal(status.branch, 'main');
    assert.equal(
      (await child.client.readRepository(registered.resource, 'file', { path: 'tracked.txt' }))
        .content,
      'preserved\n',
    );
    for (const resource of [
      { ...registered.resource, agentId: randomUUID() },
      { ...registered.resource, resourceId: randomUUID() },
    ])
      await assert.rejects(
        child.client.readRepository(resource, 'status', {}),
        (e) => e.kind === 'not-found',
      );
    await assert.rejects(
      child.client.request('repositories.read', {
        resource: registered.resource,
        kind: 'execute',
        params: { args: ['reset', '--hard'] },
      }),
      (e) => e.kind === 'invalid-params',
    );
    await assert.rejects(
      child.client.request('git.stage', { resource: registered.resource, files: ['.'] }),
      (e) => e.kind === 'unknown-method',
    );
    await assert.rejects(
      child.client.readRepository(registered.resource, 'file', { path: '../outside' }),
      (e) => e.kind === 'invalid-params',
    );
    assert.equal(hash(fs.readFileSync(path.join(repo, '.git/index'))), index);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'preserved\n');
    proof('transport-sdk-stdio', {
      agentId: init.agentId,
      resource: registered.resource,
      branch: status.branch,
      indexUnchanged: true,
      headUnchanged: true,
      rejected: [
        'other Agent',
        'unknown resource',
        'arbitrary execute query',
        'unregistered git.stage method',
        'outside path',
      ],
      boundary:
        'Actual SDK and stdio state-kernel child with temporary repository/data. No remote SSH transport or machine claim.',
    });
  } finally {
    await child.close();
  }
});
