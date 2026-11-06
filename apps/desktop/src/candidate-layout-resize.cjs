const assert = require('node:assert/strict'),
  { execFileSync } = require('node:child_process');
module.exports = async ({ window, origin, id, repo, wait, pass }) => {
  const wc = window.webContents,
    ev = (s) => wc.executeJavaScript(s),
    { button, element, click } = require('./candidate-ui-driver.cjs')(wc, wait);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const originalGit = [
    git('rev-parse', 'HEAD'),
    git('ls-files', '--stage'),
    git('status', '--porcelain'),
  ];
  const size = window.getSize(),
    minimum = window.getMinimumSize();
  const raw = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
  const saved = { sidebarWidth: raw?.sidebarWidth ?? 236, changesWidth: raw?.changesWidth ?? 320 };
  const data = (label) =>
    '(()=>{const e=(' +
    button(label) +
    '),r=e.getBoundingClientRect(),region=document.getElementById(e.getAttribute("aria-controls"));return {value:Number(e.getAttribute("aria-valuenow")),min:Number(e.getAttribute("aria-valuemin")),max:Number(e.getAttribute("aria-valuemax")),width:region.getBoundingClientRect().width,x:Math.round(r.x+r.width/2),y:Math.round(r.y+Math.min(180,r.height/2))}})()';
  async function matches(label, key, value) {
    await wait(
      wc,
      '(' + button(label) + ')?.getAttribute("aria-valuenow")===' + JSON.stringify(String(value)),
    );
    let actual;
    for (let n = 0; n < 100; n++) {
      actual = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout?.[key];
      if (actual === value) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(actual, value);
    assert.ok(Math.abs((await ev(data(label))).width - value) < 2);
  }
  async function drag(label, key, target, direction) {
    const d = await ev(data(label)),
      x = d.x,
      y = d.y,
      to = x + (target - d.value) * direction;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
      modifiers: ['leftbuttondown'],
    });
    try {
      await wait(
        wc,
        '(' + button(label) + ')?.classList.contains("panel-resize-handle--dragging")',
      );
      wc.sendInputEvent({
        type: 'mouseMove',
        x: to,
        y,
        button: 'left',
        modifiers: ['leftbuttondown'],
      });
      await matches(label, key, target);
    } finally {
      wc.sendInputEvent({ type: 'mouseUp', x: to, y, button: 'left', clickCount: 1 });
    }
    await wait(wc, '!(' + button(label) + ')?.classList.contains("panel-resize-handle--dragging")');
  }
  try {
    window.setMinimumSize(0, 0);
    window.setContentSize(1440, 900);
    await window.loadURL(origin + '/repositories/' + id);
    await click(element('button[aria-label^="改动"]'));
    await wait(wc, button('调整右侧面板宽度'));
    for (const [label, key, direction] of [
      ['调整工作区宽度', 'sidebarWidth', 1],
      ['调整右侧面板宽度', 'changesWidth', -1],
    ]) {
      for (const event of ['End', 'Home']) {
        const d = await ev(data(label)),
          target = event === 'End' ? d.max : d.min;
        await ev(
          '(' +
            button(label) +
            ').dispatchEvent(new KeyboardEvent("keydown",{key:' +
            JSON.stringify(event) +
            ',bubbles:true,cancelable:true}))',
        );
        await matches(label, key, target);
      }
      await drag(label, key, saved[key] + 40, direction);
      await drag(label, key, saved[key], direction);
      await pass(
        ['UI-029', key === 'sidebarWidth' ? 'UI-025' : 'UI-072'],
        'keyboard limits and native pointer capture resize ' +
          key +
          ' to measured/persisted values, then restore its original width',
      );
    }
    const responsiveBaseline = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
    for (const [width, tier] of [
      [1440, 'full'],
      [1024, 'compact'],
      [860, 'condensed'],
      [600, 'minimal'],
    ]) {
      window.setContentSize(width, 900);
      await wait(
        wc,
        'innerWidth===' +
          width +
          '&&document.querySelector(".repository-toolbar")?.dataset.tier===' +
          JSON.stringify(tier),
      );
      assert.equal(
        await ev(
          '[...document.querySelectorAll(".repository-toolbar__views button")].filter(e=>e.getClientRects().length).length',
        ),
        7,
      );
      const layout = JSON.parse(await ev('window.aluneWorkspace.load()')).state.layout;
      assert.equal(layout.sidebarWidth, saved.sidebarWidth);
      assert.equal(layout.changesWidth, saved.changesWidth);
      assert.equal(layout.sidebarCollapsed, responsiveBaseline.sidebarCollapsed);
      assert.equal(layout.changesCollapsed, responsiveBaseline.changesCollapsed);
    }
    assert.deepEqual(
      [git('rev-parse', 'HEAD'), git('ls-files', '--stage'), git('status', '--porcelain')],
      originalGit,
    );
    await pass(
      ['UI-064', 'UI-065', 'UI-042', 'UI-025', 'UI-072'],
      'native window resize traverses all four toolbar tiers, retains seven accessible view controls and stored panel preferences, and leaves Git refs, index and working bytes unchanged',
    );
  } finally {
    window.setSize(...size);
    window.setMinimumSize(...minimum);
  }
};
