const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { execFileSync, spawn } = require('node:child_process');
const ts = require('typescript');
const current = require('../dist/adapters/ssh/proxy-git');
const local = require('../dist/adapters/git/local-git-proxy');
const transport = require('../dist/adapters/network/proxy-transport');
const root = path.resolve(__dirname, '../../..');
const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const gitFile = 'packages/ssh-client/src/proxy-git.ts';
const transportFile = 'packages/ssh-client/src/proxy-transport.ts';
const plain = (value) => JSON.parse(JSON.stringify(value));
function proof(name, value) {
  if (process.env.P0_PROXY_GIT_CONTRACTS_PROOF_DIR)
    fs.writeFileSync(
      path.join(process.env.P0_PROXY_GIT_CONTRACTS_PROOF_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
}
function source(file) {
  const text = fs.readFileSync(path.join(process.env.P0_PROXY_GIT_CONTRACTS_FROZEN, file), 'utf8');
  assert.equal(
    text,
    execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8' }),
  );
  return text;
}
function evaluate(file, dependencies, globals = {}, frozen = true) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(frozen ? source(file) : fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      module,
      exports: module.exports,
      Error,
      Buffer,
      URL,
      AbortSignal,
      AbortController,
      setTimeout,
      clearTimeout,
      require(id) {
        assert(Object.hasOwn(dependencies, id), id);
        return dependencies[id];
      },
      ...globals,
    },
    { filename: file },
  );
  return module.exports;
}
function oldGit() {
  const shell = evaluate('packages/ssh-client/src/git-shell.ts', {});
  return evaluate(gitFile, { './git-shell': shell, 'node:zlib': require('node:zlib') });
}
function oldTransport(deps = {}, globals = {}, frozen = true) {
  const dependencies = Object.fromEntries(
    ['node:net', 'node:tls', 'node:http', 'node:https', 'undici', 'socks'].map((id) => [
      id,
      require(id),
    ]),
  );
  return evaluate(
    frozen ? transportFile : 'packages/agent/src/adapters/network/proxy-transport.ts',
    { ...dependencies, ...deps },
    globals,
    frozen,
  );
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-batch28-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function recordExecutable(
  directory,
  name,
  body = 'process.stdout.write(JSON.stringify({argv:process.argv.slice(2),environment:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("GIT_")||["NO_PROXY","no_proxy","FIXTURE"].includes(k)))}));',
) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, '#!' + process.execPath + '\n' + body + '\n', { mode: 0o700 });
  return file;
}
function execute(command, environment, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', command], { env: environment });
    const out = [],
      err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    timer.unref();
    child.on('error', reject);
    child.stdout.on('data', (x) => out.push(x));
    child.stderr.on('data', (x) => err.push(x));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() });
    });
  });
}

test('P0 proxy Git full source inventory and shared error identity retain explicit safe contracts', () => {
  const ast = ts.createSourceFile(gitFile, source(gitFile), ts.ScriptTarget.Latest, true);
  assert.deepEqual(
    ast.statements.filter(ts.isImportDeclaration).map((x) => x.moduleSpecifier.text),
    ['./connection-manager', './git-shell', 'node:zlib'],
  );
  const declarations = ast.statements.filter((x) => !ts.isImportDeclaration(x));
  const names = declarations.map(
    (x) => x.name?.text ?? x.declarationList?.declarations[0].name.getText(ast),
  );
  assert.deepEqual(names, [
    'GitProxyError',
    'isLoopbackAddress',
    'python',
    'connectScript',
    'sshProxyCommand',
    'proxyGitArguments',
  ]);
  assert.equal(declarations[0].members.length, 0);
  assert.equal(current.GitProxyError, local.GitProxyError);
  const rows = [];
  for (const [label, mod] of [
    ['frozen', oldGit()],
    ['current', current],
  ]) {
    assert.deepEqual(Object.keys(mod).sort(), [
      'GitProxyError',
      'isLoopbackAddress',
      'proxyGitArguments',
      'sshProxyCommand',
    ]);
    const error = new mod.GitProxyError('safe fixture');
    assert(error instanceof Error);
    assert(error instanceof mod.GitProxyError);
    assert.equal(error.message, 'safe fixture');
    assert.equal(error.name, 'Error');
    assert.match(error.stack, /safe fixture/);
    assert.deepEqual(Object.keys(error), []);
    assert.deepEqual(Object.getOwnPropertyNames(mod.GitProxyError.prototype), ['constructor']);
    const addresses = [
      ['127.0.0.1', true],
      ['127.2.3.4', true],
      ['::1', true],
      ['::FFFF:127.0.0.1', true],
      ['127.999.999.999', true],
      ['localhost', false],
      ['0.0.0.0', false],
      ['128.0.0.1', false],
      ['127.0.0.1.evil', false],
      ['', false],
      ['::ffff:192.168.0.1', false],
    ];
    for (const [address, expected] of addresses)
      assert.equal(mod.isLoopbackAddress(address), expected, address);
    rows.push({ label, addresses, inheritedError: true });
  }
  proof('proxy-git-source-inventory', {
    declarations: names,
    rows,
    note: 'Loopback predicate is syntactic and accepts 127.999.999.999; this is not asserted as valid routable IP validation.',
  });
});

test('P0 proxy Git exact commands preserve quoted argv environment cancellation and fail closed on config reads', async (t) => {
  const bin = temporary(t);
  recordExecutable(bin, 'git');
  fs.symlinkSync('/usr/bin/env', path.join(bin, 'env'));
  const rows = [];
  for (const [label, mod] of [
    ['frozen', oldGit()],
    ['current', current],
  ]) {
    for (const port of [1, 3128, 65535])
      for (const exitCode of [0, 1]) {
        const calls = [],
          signal = new AbortController().signal;
        const repo = "/synthetic/repo ' $literal\n中文";
        const args = [
          'fetch',
          "origin ' literal",
          '--',
          '$(touch SHOULD_NOT_EXIST)',
          '; echo injected',
        ];
        const environment = {
          FIXTURE: "value ' $ \n中文",
          NO_PROXY: '*',
          no_proxy: '*',
          GIT_SSH_COMMAND: 'evil',
          GIT_SSH_VARIANT: 'evil',
          GIT_TERMINAL_PROMPT: '1',
        };
        const connection = {
          async execCommand(...params) {
            calls.push(params);
            return {
              exitCode,
              stdout:
                exitCode === 0 ? 'http.https://fixture.invalid.proxy\nremote.origin.proxy\n\n' : '',
              stderr: '',
            };
          },
        };
        const command = await mod.proxyGitArguments(
          connection,
          repo,
          args,
          port,
          signal,
          environment,
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1], undefined);
        assert.equal(calls[0][2], signal);
        assert.deepEqual(plain(calls[0][3]), { maxOutputBytes: 65536 });
        const query = await execute(calls[0][0], { PATH: bin });
        assert.equal(query.code, 0, query.stderr);
        assert.deepEqual(JSON.parse(query.stdout).argv, [
          '--literal-pathspecs',
          '-C',
          repo,
          'config',
          '--name-only',
          '--get-regexp',
          '^(http\\..*\\.proxy|remote\\..*\\.proxy)$',
        ]);
        const result = await execute(command, { PATH: bin });
        assert.equal(result.code, 0, result.stderr);
        const actual = JSON.parse(result.stdout),
          proxy = 'http://127.0.0.1:' + port;
        assert.deepEqual(actual.argv, [
          '--literal-pathspecs',
          '-C',
          repo,
          '-c',
          'http.proxy=' + proxy,
          ...(exitCode === 0
            ? [
                '-c',
                'http.https://fixture.invalid.proxy=' + proxy,
                '-c',
                'remote.origin.proxy=' + proxy,
              ]
            : []),
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.http.allow=always',
          '-c',
          'protocol.https.allow=always',
          '-c',
          'protocol.ssh.allow=always',
          '-c',
          'protocol.file.allow=always',
          ...args,
        ]);
        for (const key of ['NO_PROXY', 'no_proxy']) assert.equal(actual.environment[key], '');
        assert.equal(actual.environment.FIXTURE, environment.FIXTURE);
        assert.equal(actual.environment.GIT_TERMINAL_PROMPT, '0');
        assert.equal(actual.environment.GIT_SSH_VARIANT, 'ssh');
        assert.match(actual.environment.GIT_SSH_COMMAND, /ProxyJump=none/);
        assert.match(actual.environment.GIT_SSH_COMMAND, /ControlMaster=no/);
        assert.match(actual.environment.GIT_SSH_COMMAND, /PermitLocalCommand=no/);
        assert.match(actual.environment.GIT_SSH_COMMAND, /BatchMode=yes/);
        assert.equal(environment.NO_PROXY, '*');
        assert.deepEqual(args, [
          'fetch',
          "origin ' literal",
          '--',
          '$(touch SHOULD_NOT_EXIST)',
          '; echo injected',
        ]);
        rows.push({
          label,
          port,
          exitCode,
          argv: actual.argv,
          environment: actual.environment,
          signalIdentity: true,
        });
      }
    for (const exitCode of [-1, 2, 127]) {
      let calls = 0;
      await assert.rejects(
        mod.proxyGitArguments(
          {
            async execCommand() {
              calls++;
              return { exitCode, stdout: '', stderr: 'synthetic-private-password' };
            },
          },
          '/repo',
          ['fetch'],
          3128,
        ),
        (e) =>
          e instanceof mod.GitProxyError &&
          /已中止网络操作/.test(e.message) &&
          !e.message.includes('synthetic-private-password'),
      );
      assert.equal(calls, 1);
    }
    const abort = new AbortController();
    const marker = Error('cancelled config query');
    abort.abort(marker);
    let count = 0;
    await assert.rejects(
      mod.proxyGitArguments(
        {
          async execCommand(...args) {
            count++;
            assert.equal(args[2], abort.signal);
            throw marker;
          },
        },
        '/repo',
        ['fetch'],
        3128,
        abort.signal,
      ),
      (e) => e === marker,
    );
    assert.equal(count, 1);
    await assert.rejects(
      mod.proxyGitArguments(
        {
          async execCommand() {
            return { exitCode: 1, stdout: '' };
          },
        },
        '/repo',
        ['fetch'],
        3128,
        undefined,
        { 'INVALID-NAME': 'x' },
      ),
      /Invalid command environment name/,
    );
  }
  assert(!fs.existsSync(path.join(root, 'SHOULD_NOT_EXIST')));
  proof('proxy-git-arguments', {
    rows,
    failedExitCodes: [-1, 2, 127],
    rejectionAndCancellationIdentity: true,
    recordingGitExecutable: true,
  });
});

test('P0 proxy Git every tool selection branch retains ordered flags and explicit missing tool failure', async (t) => {
  const parent = temporary(t),
    rows = [];
  for (const [label, mod] of [
    ['frozen', oldGit()],
    ['current', current],
  ])
    for (const tool of [
      'nc',
      'ncat',
      'connect',
      'socat',
      'python3',
      'none',
      'socat-ipv6',
      'all',
      'nc-fallback',
      'socat-ipv6-python',
    ]) {
      const bin = path.join(parent, label + '-' + tool);
      fs.mkdirSync(bin);
      fs.symlinkSync('/bin/sh', path.join(bin, 'sh'));
      fs.symlinkSync('/usr/bin/grep', path.join(bin, 'grep'));
      const available =
        tool === 'all'
          ? ['nc', 'ncat', 'connect', 'socat', 'python3']
          : tool === 'nc-fallback'
            ? ['nc', 'ncat']
            : tool === 'socat-ipv6-python'
              ? ['socat', 'python3']
              : tool === 'none'
                ? []
                : [tool === 'socat-ipv6' ? 'socat' : tool];
      for (const name of available)
        recordExecutable(
          bin,
          name,
          'if(process.argv[2]==="-h")process.stdout.write(' +
            JSON.stringify(tool === 'nc-fallback' ? 'incompatible nc' : '-X supported') +
            ');else process.stdout.write(JSON.stringify(process.argv.slice(2)));',
        );
      const command = mod.sshProxyCommand(43123);
      assert(!command.includes('\\'));
      assert(!command.replace(/%[hp]/g, '').includes('%'));
      const host = tool.startsWith('socat-ipv6') ? '::1' : 'git.fixture.test';
      const result = await execute(command.replace('%h', host).replace('%p', '22'), { PATH: bin });
      if (['none', 'socat-ipv6'].includes(tool)) {
        assert.equal(result.code, 1, result.stderr);
        assert.match(result.stderr, /nc、ncat、connect、socat 或 python3/);
      } else {
        assert.equal(result.code, 0, result.stderr);
        const argv = JSON.parse(result.stdout);
        const expected = {
          nc: ['-X', 'connect', '-x', '127.0.0.1:43123', host, '22'],
          ncat: ['--proxy', '127.0.0.1:43123', '--proxy-type', 'http', host, '22'],
          connect: ['-H', '127.0.0.1:43123', host, '22'],
          socat: ['-', 'PROXY:127.0.0.1:git.fixture.test:22,proxyport=43123'],
        };
        const selected =
          tool === 'all'
            ? 'nc'
            : tool === 'nc-fallback'
              ? 'ncat'
              : tool === 'socat-ipv6-python'
                ? 'python3'
                : tool;
        if (selected === 'python3') {
          assert.equal(argv[0], '-c');
          assert.match(argv[1], /zlib/);
          assert.deepEqual(argv.slice(2), [host, '22', '43123']);
        } else assert.deepEqual(argv, expected[selected]);
      }
      rows.push({ label, tool, host, code: result.code, recordingTool: true });
    }
  proof('proxy-git-tools', {
    rows,
    note: 'Tool doubles verify generated command selection/flags only; real Python tunnel separately executed.',
  });
});

test(
  'P0 proxy Git real Python CONNECT helper relays binary data brackets IPv6 and rejects refused damaged headers',
  { timeout: 60000 },
  async (t) => {
    const parent = temporary(t),
      rows = [];
    const python = execFileSync('/bin/sh', ['-c', 'command -v python3'], {
      encoding: 'utf8',
    }).trim();
    assert(python);
    const bin = path.join(parent, 'bin');
    fs.mkdirSync(bin);
    for (const [name, target] of [
      ['sh', '/bin/sh'],
      ['grep', '/usr/bin/grep'],
      ['python3', python],
    ])
      fs.symlinkSync(target, path.join(bin, name));
    for (const [label, mod] of [
      ['frozen', oldGit()],
      ['current', current],
    ])
      for (const mode of ['binary', 'ipv6', 'refused', 'closed', 'oversized']) {
        const sockets = new Set(),
          requests = [];
        const server = net.createServer((socket) => {
          sockets.add(socket);
          socket.on('error', () => {});
          socket.on('close', () => sockets.delete(socket));
          let header = Buffer.alloc(0);
          const receive = (chunk) => {
            header = Buffer.concat([header, chunk]);
            const boundary = header.indexOf('\r\n\r\n');
            if (boundary < 0) return;
            requests.push(header.subarray(0, boundary).toString());
            socket.removeListener('data', receive);
            if (mode === 'refused') return socket.end('HTTP/1.1 407 Refused\r\n\r\n');
            if (mode === 'closed') return socket.end();
            if (mode === 'oversized') return socket.end('x'.repeat(16386));
            socket.write('HTTP/1.1 200 Connected\r\n\r\n');
            if (header.length > boundary + 4) socket.write(header.subarray(boundary + 4));
            socket.pipe(socket);
          };
          socket.on('data', receive);
        });
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        let result;
        try {
          const host = mode === 'ipv6' ? '::1' : 'git.fixture.test';
          const input = Buffer.from([0, 255, 128, 10, 13, 39, 34, 65]);
          result = await execute(
            mod.sshProxyCommand(server.address().port).replace('%h', host).replace('%p', '22'),
            { PATH: bin },
            input,
          );
          assert.equal(result.signal, null, result.stderr);
          if (['binary', 'ipv6'].includes(mode)) {
            assert.equal(result.code, 0, result.stderr);
            assert.deepEqual(result.stdout, input);
          } else {
            assert.equal(result.code, mode === 'refused' ? 73 : 72, result.stderr);
            assert.equal(result.stdout.length, 0);
          }
          assert.equal(requests.length, 1);
          assert.match(
            requests[0],
            mode === 'ipv6'
              ? /^CONNECT \[::1\]:22 HTTP\/1.1/
              : /^CONNECT git.fixture.test:22 HTTP\/1.1/,
          );
          rows.push({
            label,
            mode,
            code: result.code,
            request: requests[0],
            bytes: result.stdout.length,
          });
        } finally {
          for (const socket of sockets) socket.destroy();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    proof('proxy-git-real-python', {
      python,
      rows,
      note: 'Actual Python on current Mac over disposable loopback; no external host or Windows execution.',
    });
  },
);

function compilerCheck(directory, label, declaration, importPath) {
  const prelude = importPath
    ? `import { ProxySnapshot, ProxyTransportError } from ${JSON.stringify(importPath)};`
    : declaration;
  const valid = `\nconst snapshot: ProxySnapshot = {revision:'r',enabled:false,protocol:'http',host:'fixture',port:3128};\nconst enabled: ProxySnapshot = {...snapshot,enabled:true,protocol:'https',credentials:{username:'u',password:'p'}};\nconst socks: ProxySnapshot = {...snapshot,protocol:'socks5'};\nconst error = new ProxyTransportError('PROXY_AUTH');\nnew ProxyTransportError('PROXY_TLS');new ProxyTransportError('PROXY_CONNECT');new ProxyTransportError('PROXY_TIMEOUT');\n`;
  const invalid = [
    ...['revision', 'enabled', 'protocol', 'host', 'port'].map(
      (key) =>
        `const {${key}: removed, ...remaining} = snapshot; const bad: ProxySnapshot = remaining;`,
    ),
    `const bad: ProxySnapshot = {...snapshot,revision:1};`,
    `const bad: ProxySnapshot = {...snapshot,host:1};`,
    `const bad: ProxySnapshot = {enabled:false,protocol:'http',host:'h',port:1};`,
    `const bad: ProxySnapshot = {...snapshot,protocol:'direct'};`,
    `const bad: ProxySnapshot = {...snapshot,enabled:'yes'};`,
    `const bad: ProxySnapshot = {...snapshot,port:'3128'};`,
    `const bad: ProxySnapshot = {...snapshot,credentials:{username:'u'}};`,
    `const bad: ProxySnapshot = {...snapshot,credentials:{username:1,password:'p'}};`,
    `new ProxyTransportError('RAW_SECRET');`,
    `error.code='PROXY_TLS';`,
  ];
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    ignoreDeprecations: '6.0',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  function compile(suffix, text) {
    const file = path.join(directory, label + '-' + suffix + '.ts');
    fs.writeFileSync(file, prelude + valid + text);
    const program = ts.createProgram([file], options);
    return ts
      .getPreEmitDiagnostics(program)
      .map((d) => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') }));
  }
  assert.deepEqual(compile('valid', ''), []);
  const rows = invalid.map((text, index) => {
    const diagnostics = compile('invalid-' + index, text);
    assert(diagnostics.length > 0, text);
    return { text, diagnostics };
  });
  return { label, valid: true, invalid: rows };
}

test('P0 proxy snapshot exact frozen type and production declaration accept valid shapes and reject invalid fields', (t) => {
  const directory = temporary(t),
    text = source(transportFile),
    ast = ts.createSourceFile(transportFile, text, ts.ScriptTarget.Latest, true);
  const snapshot = ast.statements.find(
    (s) => ts.isInterfaceDeclaration(s) && s.name.text === 'ProxySnapshot',
  );
  const error = ast.statements.find(
    (s) => ts.isClassDeclaration(s) && s.name.text === 'ProxyTransportError',
  );
  const protoFile = 'packages/shared/src/types/proxy.ts',
    proto = ts.createSourceFile(protoFile, source(protoFile), ts.ScriptTarget.Latest, true);
  const alias = proto.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'ProxyProtocol',
  );
  assert.equal(alias.type.getText(proto), "'http' | 'https' | 'socks5'");
  const nextText = fs.readFileSync(
    path.join(root, 'packages/agent/src/adapters/network/proxy-transport.ts'),
    'utf8',
  );
  const nextAst = ts.createSourceFile('current.ts', nextText, ts.ScriptTarget.Latest, true);
  const nextSnapshot = nextAst.statements.find(
    (s) => ts.isInterfaceDeclaration(s) && s.name.text === 'ProxySnapshot',
  );
  assert.deepEqual(
    snapshot.members.map((m) => m.getText(ast)),
    nextSnapshot.members.map((m) => m.getText(nextAst)),
  );
  assert.deepEqual(
    snapshot.members.map((m) => m.name.text),
    ['revision', 'enabled', 'protocol', 'host', 'port', 'credentials'],
  );
  const declarations = ts.transpileDeclaration(
    alias.getText(proto) + '\n' + snapshot.getText(ast) + '\n' + error.getText(ast),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const rows = [
    compilerCheck(directory, 'frozen', declarations),
    compilerCheck(
      directory,
      'current',
      undefined,
      path.join(root, 'packages/agent/dist/adapters/network/proxy-transport'),
    ),
  ];
  proof('proxy-snapshot-type-contract', {
    members: snapshot.members.map((m) => m.getText(ast)),
    rows,
    note: 'Compile-time internal runtime shape only, no public serialization permission or runtime validator implied.',
  });
});

test('P0 proxy transport all typed failures retain safe messages prototype and real failure classification', async () => {
  const messages = {
    PROXY_AUTH: '代理认证失败，请检查已保存的用户名和密码。',
    PROXY_TLS: '代理 TLS 证书验证失败，请检查证书与服务器地址。',
    PROXY_CONNECT: '代理无法建立连接，请检查地址、端口、目标访问权限与网络。',
    PROXY_TIMEOUT: '代理连接超时，请检查网络后重试。',
  };
  const rows = [];
  for (const [label, mod] of [
    ['frozen', oldTransport()],
    ['current', transport],
  ]) {
    assert.deepEqual(Object.getOwnPropertyNames(mod.ProxyTransportError.prototype), [
      'constructor',
    ]);
    for (const [code, message] of Object.entries(messages)) {
      const e = new mod.ProxyTransportError(code);
      assert(e instanceof Error);
      assert(e instanceof mod.ProxyTransportError);
      assert.equal(e.code, code);
      assert.equal(e.message, message);
      assert.equal(e.name, 'Error');
      assert.deepEqual(Object.keys(e), ['code']);
      assert.match(e.stack, /Error/);
      rows.push({ label, code, message });
    }
  }
  for (const frozen of [true, false])
    for (const rawCode of [
      'CERT_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'SSL_ERROR',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'ECONNREFUSED',
      '',
    ]) {
      const secret = Error('synthetic-private-password');
      secret.code = rawCode;
      const failing = {
        request() {
          const request = new EventEmitter();
          request.end = () => queueMicrotask(() => request.emit('error', secret));
          request.destroy = () => {};
          return request;
        },
      };
      const mod = oldTransport({ 'node:http': failing }, {}, frozen);
      const expected = /CERT|TLS|SSL|SELF_SIGNED/.test(rawCode) ? 'PROXY_TLS' : 'PROXY_CONNECT';
      await assert.rejects(
        mod.connectProxySocket(
          { enabled: true, protocol: 'http', host: '127.0.0.1', port: 3128 },
          'fixture',
          22,
        ),
        (e) =>
          e instanceof mod.ProxyTransportError &&
          e.code === expected &&
          !JSON.stringify(e).includes('synthetic-private-password') &&
          !e.message.includes('synthetic-private-password'),
      );
      rows.push({
        label: frozen ? 'frozen' : 'current-source',
        rawCode,
        expected,
        rawSecretRedacted: true,
      });
    }
  for (const frozen of [true, false]) {
    let typedModule;
    let typedMarker;
    const typedPort = {
      request() {
        const request = new EventEmitter();
        request.end = () => queueMicrotask(() => request.emit('error', typedMarker));
        request.destroy = () => {};
        return request;
      },
    };
    typedModule = oldTransport({ 'node:http': typedPort }, {}, frozen);
    typedMarker = new typedModule.ProxyTransportError('PROXY_AUTH');
    await assert.rejects(
      typedModule.connectProxySocket(
        { enabled: true, protocol: 'http', host: '127.0.0.1', port: 3128 },
        'fixture',
        22,
      ),
      (e) => e === typedMarker,
    );
    let request;
    const deadline = new AbortController();
    const AbortFixture = {
      timeout(ms) {
        assert.equal(ms, 20000);
        return deadline.signal;
      },
      any: AbortSignal.any.bind(AbortSignal),
    };
    const mod = oldTransport(
      {
        'node:http': {
          request() {
            request = new EventEmitter();
            request.end = () => queueMicrotask(() => deadline.abort());
            request.destroy = (error) => {
              if (error) queueMicrotask(() => request.emit('error', error));
            };
            return request;
          },
        },
      },
      { AbortSignal: AbortFixture },
      frozen,
    );
    await assert.rejects(
      mod.connectProxySocket(
        { enabled: true, protocol: 'http', host: '127.0.0.1', port: 3128 },
        'fixture',
        22,
      ),
      (e) => e instanceof mod.ProxyTransportError && e.code === 'PROXY_TIMEOUT',
    );
    const cancelled = new AbortController(),
      reason = Error('explicit cancellation');
    cancelled.abort(reason);
    await assert.rejects(
      mod.connectProxySocket(
        { enabled: true, protocol: 'http', host: '127.0.0.1', port: 3128 },
        'fixture',
        22,
        cancelled.signal,
      ),
      (e) => e === reason,
    );
    rows.push({
      label: frozen ? 'frozen' : 'current-source',
      controlledDeadline: true,
      explicitCancellationIdentity: true,
    });
  }
  proof('proxy-transport-error-contract', {
    rows,
    timeout:
      'Injected AbortSignal deadline; not real 20 second wait. Real network classifications executed by git-proxy-transport companion.',
  });
});
