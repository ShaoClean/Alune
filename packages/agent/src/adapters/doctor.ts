import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

export async function doctor() {
  const git = spawnSync('git', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  let sqlite = false;
  let pty = false;
  try {
    const Database = require('better-sqlite3');
    const database = new Database(':memory:');
    try {
      sqlite = database.prepare('SELECT 42 AS answer').get().answer === 42;
    } finally {
      database.close();
    }
  } catch {
    /* Diagnostics report missing or mismatched native modules explicitly. */
  }
  try {
    const terminal = require('node-pty').spawn(
      process.execPath,
      ['-e', 'process.stdout.write("ALUNE_PTY_OK")'],
      { cwd: tmpdir(), env: { ...process.env, TERM: 'dumb' }, cols: 80, rows: 24 },
    );
    pty = await new Promise<boolean>((resolve) => {
      let output = '';
      const timer = setTimeout(() => {
        try {
          terminal.kill();
        } catch {}
        resolve(false);
      }, 5000);
      terminal.onData((data: string) => {
        output = (output + data).slice(-1024);
      });
      terminal.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timer);
        resolve(exitCode === 0 && output.includes('ALUNE_PTY_OK'));
      });
    });
  } catch {
    /* PTY spawn is an actual native ABI check, not just require(). */
  }
  return {
    ok: git.status === 0 && sqlite && pty,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    abi: process.versions.modules,
    git: git.status === 0 ? git.stdout.trim() : 'unavailable',
    native: { sqlite, pty },
  };
}
