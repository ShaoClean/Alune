// Drive the published binary's own authenticated renderer. This harness is
// only invoked from the disposable hosted-runner installer cycle.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

export async function withInstalledWindow(exe, work) {
  const child = spawn(
    exe,
    ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-gpu'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let port,
    ended = false,
    ws;
  const calls = new Map();
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      ended = true;
      resolve({ code, signal });
    }),
  );
  const failed = new Promise((_, reject) => child.once('error', reject));
  failed.catch(() => {});
  let startup = '';
  child.stderr.on('data', (bytes) => {
    if (port) return;
    startup = (startup + bytes.toString()).slice(-4096);
    const m = startup.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) port = Number(m[1]);
  });
  const deadline = Date.now() + 60000;
  const wait = async () => {
    if (ended || Date.now() > deadline) throw Error('Installed renderer did not become ready');
    await Promise.race([delay(100), failed]);
  };
  let sequence = 0;
  try {
    while (!port) await wait();
    let page;
    while (!page) {
      const list = await (
        await fetch('http://127.0.0.1:' + port + '/json/list', {
          signal: AbortSignal.timeout(5000),
        })
      ).json();
      page = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:'));
      if (!page) await wait();
    }
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.id) calls.get(m.id)?.(m);
    });
    ws.on('close', () => {
      for (const fn of calls.values()) fn({ error: { message: 'Renderer closed' } });
    });
    const evaluate = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          calls.delete(id);
          reject(Error('Installed renderer request timed out'));
        }, 30000);
        calls.set(id, (m) => {
          clearTimeout(timeout);
          calls.delete(id);
          if (m.error || m.result?.exceptionDetails)
            reject(
              Error(
                m.error?.message ??
                  m.result.exceptionDetails.exception?.description ??
                  'Renderer failed',
              ),
            );
          else resolve(m.result.result.value);
        });
        ws.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    while (
      !(await evaluate("Boolean(window.aluneWorkspace && document.querySelector('.app-shell'))"))
    )
      await wait();
    return await work(evaluate);
  } finally {
    // A killed Chromium process can leave its DPAPI master-key descriptor
    // unflushed even though SQLite has already committed a protected token.
    if (ws?.readyState === WebSocket.OPEN && !ended) {
      ws.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }));
      let grace;
      await Promise.race([
        exited,
        new Promise((resolve) => {
          grace = setTimeout(resolve, 5000);
        }),
      ]);
      clearTimeout(grace);
      if (!ended && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: ++sequence, method: 'Page.close' }));
        let remaining;
        await Promise.race([
          exited,
          new Promise((resolve) => {
            remaining = setTimeout(resolve, 3000);
          }),
        ]);
        clearTimeout(remaining);
      }
    }
    ws?.close();
    if (!ended) child.kill('SIGTERM');
    let timer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          if (!ended) child.kill('SIGKILL');
          resolve();
        }, 8000);
      }),
    ]);
    clearTimeout(timer);
    if (child.pid) await exited;
  }
}

export function oldApi(evaluate, method, route, body) {
  return evaluate(
    '(async()=>{const r=await fetch(' +
      JSON.stringify('/api/' + route) +
      ',{method:' +
      JSON.stringify(method) +
      ",headers:{'Content-Type':'application/json'},body:" +
      JSON.stringify(JSON.stringify(body)) +
      "});if(!r.ok)throw Error('Installed API returned '+r.status);return r.json()})()",
  );
}
