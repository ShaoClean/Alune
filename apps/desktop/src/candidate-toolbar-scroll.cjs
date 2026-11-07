const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async ({ window, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (code) => wc.executeJavaScript(code);
  const { element } = require('./candidate-ui-driver.cjs')(wc, wait);
  const size = window.getSize(),
    minimum = window.getMinimumSize();
  const git = (...args) =>
    execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const before = [
    git('rev-parse', 'HEAD'),
    git('show-ref'),
    git('ls-files', '--stage'),
    git('diff', '--binary'),
  ];
  const preferences = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
  const nav = element('nav.repository-toolbar__views');
  const data = () =>
    ev(
      '(()=>{const e=(' +
        nav +
        '),r=e.getBoundingClientRect();return {left:e.scrollLeft,width:e.clientWidth,total:e.scrollWidth,overflow:e.dataset.overflow,x:Math.round(r.x+Math.min(r.width/2,50)),y:Math.round(r.y+r.height/2)}})()',
    );
  try {
    await require('./smoke-window.cjs')(window);
    window.setMinimumSize(0, 0);
    window.setContentSize(320, 900);
    await wait(wc, 'innerWidth===320&&!!(' + nav + ')');
    await wait(wc, '(' + nav + ').scrollWidth>(' + nav + ').clientWidth');
    await ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const start = await data();
    await ev(
      'window.__toolbarWheel=null;window.__toolbarWheelListener=event=>{window.__toolbarWheel={x:event.deltaX,y:event.deltaY,target:(' +
        nav +
        ').contains(event.target)}};document.addEventListener("wheel",window.__toolbarWheelListener,true)',
    );
    wc.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y });
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: start.x,
      y: start.y,
      deltaY: -10000,
      deltaX: 0,
      canScroll: true,
    });
    await wait(wc, '!!window.__toolbarWheel');
    const receipt = await ev('window.__toolbarWheel');
    assert.equal(receipt.target, true);
    assert.ok(receipt.y > 0, JSON.stringify(receipt));
    await wait(
      wc,
      '(' +
        nav +
        ').scrollLeft>0&&(' +
        nav +
        ').scrollWidth-(' +
        nav +
        ').clientWidth-(' +
        nav +
        ').scrollLeft<3&&(' +
        nav +
        ').dataset.overflow==="start"',
    );
    const end = await data();
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: end.x,
      y: end.y,
      deltaY: 10000,
      deltaX: 0,
      canScroll: true,
    });
    await wait(wc, '(' + nav + ').scrollLeft===0&&(' + nav + ').dataset.overflow==="end"');
    assert.deepEqual(
      JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout,
      preferences,
    );
    assert.deepEqual(
      [
        git('rev-parse', 'HEAD'),
        git('show-ref'),
        git('ls-files', '--stage'),
        git('diff', '--binary'),
      ],
      before,
    );
    await pass(
      ['UI-042', 'UI-065'],
      'at a 320px viewport native vertical wheel input scrolls overflowing repository views to both horizontal limits, updates both edge indicators and preserves Git and stored layout preferences',
    );
  } finally {
    await ev(
      'document.removeEventListener("wheel",window.__toolbarWheelListener,true);delete window.__toolbarWheelListener;delete window.__toolbarWheel',
    );
    window.setSize(...size);
    window.setMinimumSize(...minimum);
  }
};
