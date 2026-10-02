const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const { createTerminalFixture } = require('./terminal-fixture.cjs');
const until = async (check, timeout = 10_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error('Timed out waiting for terminal state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
async function connect(fixture, token = fixture.token) {
  const socket = io(fixture.url + '/terminal', {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const output = new Map();
  const states = new Map();
  let autoAck = true;
  let packets = 0;
  socket.on('terminal:state', (state) => states.set(state.id, state));
  socket.on('terminal:output', (packet) => {
    packets++;
    output.set(
      packet.sessionId,
      (output.get(packet.sessionId) || '') + packet.data,
    );
    if (autoAck)
      socket.emit('terminal:ack', {
        sessionId: packet.sessionId,
        sequence: packet.sequence,
      });
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
  });
  return {
    socket,
    output,
    states,
    get packets() {
      return packets;
    },
    set autoAck(value) {
      autoAck = value;
    },
    async request(event, body) {
      return socket.timeout(10_000).emitWithAck('terminal:' + event, body);
    },
    async create(repositoryId) {
      const id = randomUUID();
      const response = await this.request('create', {
        requestId: id,
        repositoryId,
        cols: 80,
        rows: 24,
      });
      assert.equal(response.ok, true, response.error);
      await until(
        () => states.has(id) && states.get(id).state !== 'connecting',
      );
      return id;
    },
    async input(id, data) {
      const response = await this.request('input', { sessionId: id, data });
      assert.equal(response.ok, true, response.error);
    },
  };
}

test(
  'real PTY sessions preserve registered paths, ownership, lifecycle and flow control',
  { timeout: 90_000 },
  async (t) => {
    const fixture = await createTerminalFixture();
    const clients = [];
    t.after(async () => {
      clients.forEach((item) => item.socket.disconnect());
      await fixture.close();
    });
    const a = await connect(fixture);
    clients.push(a);
    const b = await connect(fixture);
    clients.push(b);
    const local = await a.create(fixture.repo.id);
    const wt = await a.create(fixture.worktree.id);
    assert.equal(a.states.get(local).state, 'running');
    assert.equal(a.states.get(wt).initialPath, fixture.worktree.path);
    const posix = process.platform !== 'win32';
    await a.input(
      local,
      posix
        ? "printf '\\nLOCAL_BEGIN\\n'; pwd; hostname; id -un; printf 'LOCAL_END\\n'\r"
        : 'echo LOCAL_BEGIN & cd & hostname & echo LOCAL_END\r',
    );
    await until(() => a.output.get(local)?.includes('LOCAL_END'));
    await until(() => a.output.get(local)?.includes(fixture.repo.path));
    await a.input(
      wt,
      posix
        ? "printf '\\nWORKTREE_BEGIN\\n'; pwd; printf 'WORKTREE_END\\n'\r"
        : 'echo WORKTREE_BEGIN & cd & echo WORKTREE_END\r',
    );
    await until(() => a.output.get(wt)?.includes(fixture.worktree.path));
    assert.equal(b.output.size, 0);
    assert.equal(b.states.size, 0);
    for (const [event, body] of [
      ['input', { data: 'echo LEAK\r' }],
      ['resize', { cols: 120, rows: 30 }],
      ['ack', { sequence: 1 }],
      ['close', { confirmed: true }],
    ])
      assert.equal(
        (await b.request(event, { sessionId: local, ...body })).ok,
        false,
      );
    assert.equal(
      (await a.request('resize', { sessionId: local, cols: -1, rows: 30 })).ok,
      false,
    );
    assert.equal(
      (await a.request('input', { sessionId: local, data: 'x'.repeat(20_000) }))
        .ok,
      false,
    );
    assert.equal((await a.request('close', { sessionId: local })).ok, false);
    assert.equal(
      (await a.request('resize', { sessionId: local, cols: 100, rows: 35 })).ok,
      true,
    );
    if (posix) {
      await a.input(local, "stty size; printf 'SIZE_DONE\\n'\r");
      await until(() => a.output.get(local)?.includes('35 100'));
      await a.input(local, "printf '\\nSLEEP_READY\\n'; sleep 30\r");
      await until(() => a.output.get(local)?.includes('\r\nSLEEP_READY\r\n'));
      const beforeInterrupt = a.output.get(local).length;
      await a.input(local, '\x03');
      await until(() =>
        a.output.get(local)?.slice(beforeInterrupt).includes('ALUNE_TEST>'),
      );
      await a.input(local, "printf '\\nINTERRUPTED_OK\\n'\r");
      await until(() =>
        a.output.get(local)?.includes('\r\nINTERRUPTED_OK\r\n'),
      );
      for (let index = 0; index < fixture.remoteRepos.length; index++) {
        const repo = fixture.remoteRepos[index];
        const id = await a.create(repo.id);
        assert.equal(a.states.get(id).state, 'running', a.states.get(id).error);
        await a.input(
          id,
          "printf '\\nREMOTE_BEGIN\\n'; pwd; printf '%s\\n' \"$TEST_SSH_HOST\"; printf 'REMOTE_END\\n'\r",
        );
        await until(() => a.output.get(id)?.includes(repo.path));
        await until(() =>
          a.output.get(id)?.includes('\r\nssh-' + (index ? 'b' : 'a') + '\r\n'),
        );
        assert.equal(a.output.get(local).includes(repo.path), false);
        if (!index) {
          // Closing one PTY must leave shared Git/SSH transport usable.
          assert.equal(
            (await a.request('close', { sessionId: id, confirmed: true })).ok,
            true,
          );
          assert.ok(await fixture.repositories.getStatus(repo.id));
        } else {
          fixture.remotes[index].drop();
          await until(() => a.states.get(id)?.state === 'disconnected');
          assert.equal(
            (await a.request('input', { sessionId: id, data: 'echo replay\r' }))
              .ok,
            false,
          );
        }
      }
    }
    const headers = {
      Authorization: 'Bearer ' + fixture.token,
      'Content-Type': 'application/json',
    };
    const removal = await fetch(
      fixture.url + '/api/repositories/' + fixture.worktree.id,
      { method: 'DELETE', headers },
    );
    assert.equal(removal.status, 409);
    assert.equal((await removal.json()).code, 'TERMINAL_CONFIRM_REQUIRED');
    const confirmed = await fetch(
      fixture.url + '/api/repositories/' + fixture.worktree.id,
      {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ terminalSessionIds: [wt] }),
      },
    );
    assert.equal(confirmed.status, 200);
    await until(() => !fixture.registry.entries.has(wt));
    const cancelled = randomUUID();
    const created = a.request('create', {
      requestId: cancelled,
      repositoryId: fixture.repo.id,
      cols: 80,
      rows: 24,
    });
    const closed = a.request('close', {
      sessionId: cancelled,
      confirmed: true,
    });
    await Promise.all([created, closed]);
    await until(() => !fixture.registry.entries.has(cancelled));
    const exit = await a.create(fixture.repo.id);
    await a.input(exit, posix ? 'exit 7\r' : 'exit /b 7\r');
    await until(() => a.states.get(exit)?.state === 'exited');
    assert.equal(a.states.get(exit).exitCode, 7);
    const pressure = await b.create(fixture.repo.id);
    await until(() => b.output.has(pressure));
    if (posix) {
      b.autoAck = false;
      await b.input(pressure, 'yes TERMINAL_PRESSURE\r');
      const at = b.packets;
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.ok(b.packets - at <= 1, 'unacknowledged output must stop sending');
      const service = fixture.app.get(
        require('../dist/terminal/terminal.service').TerminalService,
      );
      assert.ok(service.sessions.get(pressure).pendingBytes <= 256 * 1024);
    }
    b.socket.disconnect();
    await until(() => !fixture.registry.entries.has(pressure));
    // A stale registration must fail in place, without falling back to HOME.
    const database = fixture.app.get('DATABASE');
    database
      .prepare('UPDATE repositories SET path = ? WHERE id = ?')
      .run(fixture.repo.path + '-missing', fixture.repo.id);
    const missing = await a.create(fixture.repo.id);
    assert.equal(a.states.get(missing).state, 'failed');
    database
      .prepare('UPDATE repositories SET path = ? WHERE id = ?')
      .run(fixture.repo.path, fixture.repo.id);
    await a.request('close', { sessionId: missing });
    if (posix) {
      const fs = require('node:fs');
      const oldShell = process.env.SHELL;
      process.env.SHELL = '/alune-no-such-shell';
      try {
        const absent = await a.create(fixture.repo.id);
        assert.equal(a.states.get(absent).state, 'failed');
        await a.request('close', { sessionId: absent });
      } finally {
        if (oldShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = oldShell;
      }
      // Kill an owned foreground/background process tree, including HUP-resistant jobs.
      const cleanup = await a.create(fixture.repo.id);
      await a.input(
        cleanup,
        'sh -c \'printf "\\nCHILD_PID=%s\\n" "$$"; trap "" HUP; sleep 30\' &\r',
      );
      try {
        await until(() => /CHILD_PID=(\d+)/.test(a.output.get(cleanup) || ''));
      } catch (error) {
        throw new Error(error.message + '\n' + a.output.get(cleanup));
      }
      const pid = Number(a.output.get(cleanup).match(/CHILD_PID=(\d+)/)[1]);
      await a.request('close', { sessionId: cleanup, confirmed: true });
      await until(() => {
        try {
          process.kill(pid, 0);
          const state = require('node:child_process')
            .execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], {
              encoding: 'utf8',
            })
            .trim();
          return state.startsWith('Z');
        } catch {
          return true;
        }
      });
      // The test itself only wrote into disposable repositories.
      assert.equal(fs.existsSync(fixture.repo.path), true);
    }
  },
);

test(
  'unauthenticated services and missing tokens cannot open terminals',
  { timeout: 30_000 },
  async () => {
    const fixture = await createTerminalFixture({ ssh: false });
    try {
      await assert.rejects(connect(fixture, ''), /websocket|Unauthorized/i);
    } finally {
      await fixture.close();
    }
    const disabled = await createTerminalFixture({ ssh: false, token: '' });
    try {
      await assert.rejects(connect(disabled), /已认证/);
    } finally {
      await disabled.close();
    }
  },
);
