const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async ({ window, origin, backend, logWindow, updates }) => {
  const { repo, id, workspace, db, fromRelease, tokenId } = JSON.parse(
    process.env.ALUNE_CANDIDATE_FIXTURE,
  );
  const phase = process.env.ALUNE_SMOKE_PHASE;
  const wait = (contents, test) =>
    contents.executeJavaScript(`new Promise((resolve,reject)=>{const until=Date.now()+20000;function poll(){if(${test})return resolve(true);
      if(Date.now()>until)return reject(Error('Candidate UI timeout: '+${JSON.stringify(test)}+' | '+JSON.stringify([...document.querySelectorAll('.a-dlg-actions button')].filter(b=>b.getClientRects().length).map(b=>[b.textContent,b.disabled]))+' | '+document.body.innerText.slice(0,1500)));setTimeout(poll,40)}poll()})`);
  const wc=window.webContents;const {measure}=require('./candidate-ui-audit.cjs');
  await wait(wc, "document.querySelector('.app-shell')");
  assert.equal(await wc.executeJavaScript('typeof window.require'), 'undefined');
  assert.equal(await wc.executeJavaScript("fetch('/api/connections').then(r=>r.status)"), 404);
  assert.equal(
    JSON.parse(await wc.executeJavaScript('window.aluneWorkspace.load()')).state.repositorySession
      .activeId,
    id,
  );
  await window.loadURL(origin + '/repositories/' + id);
  const button = phase === 'write' ? '暂存 candidate.txt' : '取消暂存 candidate.txt';
  const selector = (label) =>
    'document.querySelector(' + JSON.stringify('[aria-label="' + label + '"]') + ')';
  await wait(wc, selector(button));
  if (phase === 'write') {
    await wc.executeJavaScript(selector(button) + '.click()');
    await wait(wc, selector('取消暂存 candidate.txt'));
  }
  assert.equal(
    execFileSync('git', ['-C', repo, 'show', ':candidate.txt'], { encoding: 'utf8' }),
    'changed in legacy workspace\n',
  );
  assert.equal(
    execFileSync('git', ['-C', repo, 'show', 'HEAD:candidate.txt'], { encoding: 'utf8' }),
    'original\n',
  );
  if (process.env.ALUNE_CANDIDATE_EVIDENCE) {
    mkdirSync(process.env.ALUNE_CANDIDATE_EVIDENCE, { recursive: true });
    writeFileSync(
      path.join(process.env.ALUNE_CANDIDATE_EVIDENCE, phase + '.png'),
      (await wc.capturePage()).toPNG(),
    );
  }
  if (fromRelease) {
    await window.loadURL(origin + '/settings/proxy');
    await wait(wc, "document.querySelector('[aria-label=代理端口]')?.value === '18291'");
    if (tokenId) {
      await window.loadURL(origin + '/settings/tokens');
      await wait(wc, "document.body.innerText.includes('Upgrade fixture token')");
      assert.equal(
        await wc.executeJavaScript(
          "document.body.innerText.includes('isolated-upgrade-test-token')",
        ),
        false,
      );
    }
  } else {
    if (phase === 'write') {
      await require('./candidate-workbench.cjs')({ window, origin, id, repo, wait });
      await measure(wc,['UI-002','UI-007','UI-016'],'discard dialog: cancel focus, key trapping, destructive acknowledgement and no write on escape',()=>require('./dialogs-smoke.cjs')({window}));
      await measure(wc,['UI-025','UI-026','UI-040','UI-050','UI-057','UI-059','UI-060','UI-061'],'settings shell: retained DOM, draft, scroll and focus, keyboard, proxy navigation guards',()=>require('./settings-shell-smoke.cjs')({
        window,
        origin,
        repositoryId: id,
        candidate: true,
      }));
    }
    await measure(wc,['UI-001','UI-055','UI-056'],'theme, reduced motion, imported code colors, font and size write/restore',()=>require('./appearance-smoke.cjs')({ window, origin, restore: phase === 'restore' }));
  }
  const target = logWindow.open();
  if (target.webContents.isLoading())
    await new Promise((resolve) => target.webContents.once('did-finish-load', resolve));
  await wait(target.webContents, "document.querySelector('.log-viewer__status--live')");
  const marker = 'candidate-native-log-' + phase;
  await backend.client.request('desktop.log', { level: 'WARN', source: 'native', message: marker });
  await wait(
    target.webContents,
    'document.body.innerText.includes(' + JSON.stringify(marker) + ')',
  );
  await updates.check();
  assert.equal(updates.getState().status, 'available');
  for (const [file, expected] of [
    ['workspace.json', workspace],
    ['alune.db', db],
  ])
    assert.equal(
      createHash('sha256')
        .update(readFileSync(path.join(process.env.ALUNE_SMOKE_DIR, file)))
        .digest('hex'),
      expected,
    );
  if (process.env.ALUNE_CANDIDATE_EVIDENCE) {
    const collect = (contents) =>
      contents.executeJavaScript(
        "Array.from(window.__aluneAudit?.hits??JSON.parse(sessionStorage.getItem('alune.audit.cases')||'[]'))",
      );
    const uiCallbacks = [
      ...new Set([...(await collect(wc)), ...(await collect(target.webContents))]),
    ].sort();
    writeFileSync(
      path.join(process.env.ALUNE_CANDIDATE_EVIDENCE, phase + '-callbacks.json'),
      JSON.stringify(
        { phase, platform: process.platform, arch: process.arch, uiCallbacks },
        null,
        2,
      ),
    );
  }
  console.log(
    'Candidate ' +
      phase +
      ': actual Git index, migrated tab, legacy source hashes, native update check and live log window passed.',
  );
};
