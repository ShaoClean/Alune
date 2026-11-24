const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async ({ window, origin, backend, logWindow, updates, repositoryTray }) => {
  const { repo, id, linkedId } = JSON.parse(process.env.ALUNE_CANDIDATE_FIXTURE);
  const phase = process.env.ALUNE_SMOKE_PHASE;
  const wait = (contents, test, label = test, timeoutMs = 20_000) =>
    contents.executeJavaScript(`new Promise((resolve,reject)=>{
      const until=Date.now()+${timeoutMs};
      async function poll(){
        try{
          if(await (${test}))return resolve(true);
          if(Date.now()>until)return reject(Error('Candidate UI timeout: '+${JSON.stringify(label)}+' | '+JSON.stringify([...document.querySelectorAll('.a-dlg-actions button')].filter(b=>b.getClientRects().length).map(b=>[b.textContent,b.disabled]))+' | '+document.body.innerText.slice(0,1500)));
          setTimeout(poll,40);
        }catch(error){reject(error);}
      }
      poll();
    })`);
  const wc=window.webContents;const {measure}=require('./candidate-ui-audit.cjs');
  await wait(wc, "document.querySelector('.app-shell')");
  if (process.env.ALUNE_CANDIDATE_FOCUS === 'tray') {
    await require('./candidate-tray.cjs')({ window, repositoryTray, repo, id, linkedId, wait });
    return;
  }
  assert.equal(await wc.executeJavaScript('typeof window.require'), 'undefined');
  assert.equal(await wc.executeJavaScript("fetch('/api/connections').then(r=>r.status)"), 404);
  assert.equal(
    JSON.parse(await wc.executeJavaScript('window.aluneWorkspace.load()')).state.repositorySession
      .activeId,
    id,
  );
  if (phase === 'restore') {
    const expected = JSON.parse(readFileSync(path.join(process.env.ALUNE_SMOKE_DIR,'tab-restore-proof.json'),'utf8'));
    await measure(['UI-041','UI-025'],'restart restores deliberately reordered tabs, exact active repository and real linked working tree',async()=>{
      assert.equal(expected.activeId,id);
      const order = JSON.stringify(expected.ids);
      await wait(wc,'location.pathname==='+JSON.stringify('/repositories/'+id)+' && JSON.stringify([...document.querySelectorAll("[data-repository-tab]")].map(e=>e.dataset.repositoryTab))==='+JSON.stringify(order));
      const saved = JSON.parse(await wc.executeJavaScript('window.aluneWorkspace.load()')).state.repositorySession;
      assert.deepEqual(saved,{ids:expected.ids,activeId:id});
      assert.equal(execFileSync('git',['-C',expected.linkedPath,'branch','--show-current'],{encoding:'utf8'}).trim(),'ui-linked');
    });
  }
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
    'changed in the workspace\n',
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
  if (phase === 'write') {
    if (process.env.ALUNE_CANDIDATE_FOCUS === 'updates') {
      await require('./candidate-update-actions.cjs')({ window, origin, updates, wait, measure });
      console.log('Candidate focused update UI passed with smoke adapter.');
      return;
    }
    await require('./candidate-workbench.cjs')({ window, origin, id, repo, wait });
    if (process.env.ALUNE_CANDIDATE_FOCUS) {
      console.log('Candidate focused acceptance passed.');
      return;
    }
    await measure(['UI-002','UI-007','UI-016'],'discard dialog: cancel focus, key trapping, destructive acknowledgement and no write on escape',()=>require('./dialogs-smoke.cjs')({window}));
    await measure(['UI-025','UI-026','UI-040','UI-050','UI-057','UI-059','UI-060','UI-061'],'settings shell: retained DOM, draft, scroll and focus, keyboard, proxy navigation guards',()=>require('./settings-shell-smoke.cjs')({
      window,
      origin,
      repositoryId: id,
      candidate: true,
    }));
  }
  await measure(['UI-001','UI-055','UI-056'],'theme, reduced motion, imported code colors, font and size write/restore',()=>require('./appearance-smoke.cjs')({ window, origin, restore: phase === 'restore' }));
  if (phase === 'restore' && process.env.ALUNE_TEST_FILE_VAULT === '1') {
    await require('./candidate-token-actions.cjs')({window,origin,id,wait,measure});
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
  if (phase === 'write') {
    await measure(['UI-066'], 'controlled renderer error and rejection events reach the independent log window with ERROR/web provenance; reporting the same error twice stores it once',
      () => require('./candidate-client-errors.cjs')({contents:wc, logs:target.webContents, wait, marker:'candidate-renderer-report'}));
    await measure(['UI-068'], 'log window: web source filtering and error context expansion, scroll/follow, pause/resume without duplication, keyword/level filters and clear/reload preserving file history',
      () => require('./candidate-log-actions.cjs')({contents:target.webContents, client:backend.client, wait, marker}));
  }
  await updates.check();
  assert.equal(updates.getState().status, 'available');
  if (phase === 'write')
    await require('./candidate-update-actions.cjs')({ window, origin, updates, wait, measure });
  console.log(`Desktop smoke ${phase} passed with the standalone Agent.`);
};
