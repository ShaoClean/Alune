import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { withInstalledWindow } from './installed-window.mjs';

// The updater queries the production feed and downloads the signed-off stable
// asset; it never publishes the test build or installs in a user's desktop.
export async function verifyLiveUpdate({ exe, candidateFile, target, data, stable, stableDigest }) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')
    throw Error('Hosted runner required');
  const mac = process.platform === 'darwin',
    win = process.platform === 'win32';
  const env = { ...process.env };
  if (process.platform === 'linux') {
    env.APPIMAGE = path.join(target, 'Alune.AppImage');
    env.APPIMAGE_EXTRACT_AND_RUN = '1';
    fs.copyFileSync(candidateFile, env.APPIMAGE);
    fs.chmodSync(env.APPIMAGE, 0o755);
  }
  const since = Date.now();
  await withInstalledWindow(
    exe,
    async (evaluate, { exited }) => {
      const info = await evaluate('window.desktopUpdates.check()');
      if (info.status !== 'available' || info.latestVersion !== stable)
        throw Error(
          'Actual stable update not available: ' +
            JSON.stringify({ status: info.status, version: info.latestVersion, error: info.error }),
        );
      await evaluate('void window.desktopUpdates.download()');
      const deadline = Date.now() + 300000;
      for (;;) {
        const state = await evaluate('window.desktopUpdates.getState()');
        if (state.status === 'downloaded') break;
        if (state.status === 'error' || Date.now() > deadline)
          throw Error('Actual update download failed: ' + JSON.stringify(state.error));
        await delay(500);
      }
      await evaluate('void window.desktopUpdates.install()');
      let timer;
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Candidate did not exit for update')), 150000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    env,
  );
  // The assisted NSIS wizard retains the same Next/Finish action a keyboard
  // user would take. Only press IDOK in the verified release installer itself.
  if (win) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL('./finish-update-wizard.ps1', import.meta.url)),
      ],
      {
        env: { ...env, ALUNE_EXPECTED_EXECUTABLE: exe, ALUNE_EXPECTED_DIGEST: stableDigest },
        timeout: 195000,
        stdio: 'inherit',
      },
    );
  }
  // Use application evidence: a new, packaged stable process must actually log
  // startup after the RC quit. A replaced file or installer exit is not enough.
  const deadline = Date.now() + 150000;
  for (;;) {
    const dir = path.join(data, 'agent', 'logs');
    const started =
      fs.existsSync(dir) &&
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.log'))
        .some((f) =>
          fs
            .readFileSync(path.join(dir, f), 'utf8')
            .split('\n')
            .some((line) => {
              try {
                const e = JSON.parse(line);
                return (
                  e.source === 'app' &&
                  e.message === 'Alune 启动' &&
                  e.context?.version === stable &&
                  e.context.packaged === true &&
                  Date.parse(e.time) >= since
                );
              } catch {
                return false;
              }
            }),
        );
    if (started) break;
    if (Date.now() > deadline) throw Error('Updated stable binary did not relaunch');
    await delay(500);
  }
  if (win)
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-Process Alune -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:ALUNE_EXPECTED_EXECUTABLE } | Stop-Process -Force',
      ],
      { env: { ...env, ALUNE_EXPECTED_EXECUTABLE: exe } },
    );
  else if (mac) {
    // The bundle is installed in this job's unique temporary directory.
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .trim()
      .split('\n');
    for (const row of rows) {
      const m = row.trim().match(/^(\d+) (.+)$/);
      if (m && (m[2] === exe || m[2].startsWith(exe + ' '))) process.kill(Number(m[1]), 'SIGTERM');
    }
  } else {
    for (const pid of fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
      try {
        const vars = fs.readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0');
        if (vars.includes('APPIMAGE=' + env.APPIMAGE)) process.kill(Number(pid), 'SIGTERM');
      } catch {}
    }
  }
  console.log(
    JSON.stringify({
      nativeUpdate: 'check/download/restart/relaunch',
      stable,
      platform: process.platform,
    }),
  );
}
