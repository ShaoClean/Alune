const assert = require('node:assert/strict');

// Dialog contract from the UI-Dialogs spec, checked in the real renderer with
// the L2 「放弃所有更改」 dialog: default focus, ↵ stays disabled, Esc closes and
// returns focus, the spring/fade motion, and the bottom sheet on narrow windows.
module.exports = async ({ window }) => {
  const execute = (script) => window.webContents.executeJavaScript(script);
  const wait = (condition) =>
    execute(`new Promise((resolve, reject) => {
    const started = Date.now(); const poll = () => {
      if (${condition}) return resolve(true);
      if (Date.now() - started > 8000) return reject(Error('Dialogs smoke: ' + ${JSON.stringify(condition)} + ' | active=' + document.activeElement?.outerHTML.slice(0, 500)));
      setTimeout(poll, 20);
    }; poll();
  })`);
  const press = async (keyCode) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const shell = 'document.querySelector(\'.a-dlg-shell[data-level="2"]\')';
  const visible = `(${shell}?.closest('.ant-modal-wrap') && getComputedStyle(${shell}.closest('.ant-modal-wrap')).display !== 'none')`;
  const gone = `!${visible}`;
  // Capture CSS motion at class changes as well as animation frames. CI
  // renderers can throttle frames, so getAnimations() alone misses entrances.
  const recordMotion = () =>
    execute(`(() => {
    window.__dialogMotion = [];
    const add = (entry) => {
      if (!window.__dialogMotion.includes(entry)) window.__dialogMotion.push(entry);
    };
    const captureStyle = () => {
      for (const panel of document.querySelectorAll('.a-dlg .ant-modal')) {
        const style = getComputedStyle(panel);
        const names = style.animationName.split(',');
        const durations = style.animationDuration.split(',');
        names.forEach((name, index) => {
          name = name.trim();
          if (!name || name === 'none') return;
          const duration = (durations[index] || durations[0] || '0s').trim();
          const millis = duration.endsWith('ms') ? parseFloat(duration) : parseFloat(duration) * 1000;
          add(name + ':' + Math.round(millis));
        });
      }
    };
    const observer = new MutationObserver(captureStyle);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    const started = performance.now();
    const sample = () => {
      captureStyle();
      for (const animation of document.getAnimations()) {
        const target = animation.effect?.target;
        if (!(target instanceof Element) || !target.matches('.a-dlg .ant-modal')) continue;
        const entry = animation.animationName + ':' + animation.effect.getTiming().duration;
        add(entry);
      }
      if (performance.now() - started < 1500) requestAnimationFrame(sample);
    };
    setTimeout(() => observer.disconnect(), 1500);
    captureStyle();
    requestAnimationFrame(sample);
  })()`);
  const motion = () =>
    execute('new Promise((resolve) => setTimeout(() => resolve(window.__dialogMotion), 1600))');
  const open = async () => {
    await execute(
      '(() => { const trigger = document.querySelector(\'[aria-label="放弃所有更改"]\'); trigger.focus(); trigger.click(); })()',
    );
    await wait(visible);
    // The DOM becomes visible before the dialog's effect moves focus from the
    // trigger. Wait on every opening before sending keyboard input, including
    // the reopen used by the Tab focus-trap check.
    await wait(
      `document.activeElement === ${shell}.querySelector('.a-dlg-actions .ant-btn:not(.ant-btn-dangerous)')`,
    );
  };
  const close = async () => {
    await press('Escape');
    await wait(gone);
    await wait("document.activeElement?.getAttribute('aria-label') === '放弃所有更改'");
    assert.equal(
      await execute("document.activeElement.getAttribute('aria-label')"),
      '放弃所有更改',
    );
  };
  const originalSize = window.getSize();
  const originalMotion = await execute('document.documentElement.dataset.reducedMotion ?? null');
  const motionEnabled =
    originalMotion !== 'true' &&
    !(await execute("matchMedia('(prefers-reduced-motion: reduce)').matches"));
  const restoreMotion = () =>
    execute(
      `(${JSON.stringify(originalMotion)} === null) ? delete document.documentElement.dataset.reducedMotion : (document.documentElement.dataset.reducedMotion = ${JSON.stringify(originalMotion)})`,
    );
  try {
    await require('./smoke-window.cjs')(window);
    await wait(
      'document.querySelector(\'[aria-label="放弃所有更改"]\') && !document.querySelector(\'[aria-label="放弃所有更改"]\').disabled',
    );

    // L2: alertdialog, Cancel focused, ↵ disabled even after the acknowledgement.
    await recordMotion();
    await open();
    assert.equal(await execute(`${shell}.closest('[role]').getAttribute('role')`), 'alertdialog');
    assert.equal(
      await execute(`${shell}.querySelector('.a-dlg-actions .ant-btn-dangerous').disabled`),
      true,
    );
    const entrance = (await motion()).filter((entry) => entry.startsWith('alune-dlg-rise'));
    if (motionEnabled) assert.deepEqual(entrance, ['alune-dlg-rise:360']);
    else assert.deepEqual(entrance, []);
    await wait(
      `!${shell}.querySelector('.a-dlg-actions .ant-btn-dangerous').getAttribute('aria-busy')`,
    );
    await execute(`${shell}.querySelector('.dlg-check input').click()`);
    await wait(`!${shell}.querySelector('.a-dlg-actions .ant-btn-dangerous').disabled`);
    await execute(`${shell}.querySelector('.dlg-check input').focus()`);
    await press('Enter');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await execute(visible), true);
    assert.equal(
      await execute('Boolean(document.querySelector(\'[aria-label="放弃所有更改"]\'))'),
      true,
    );

    // Esc closes with the configured exit motion and returns focus to the trigger.
    await recordMotion();
    await close();
    if (motionEnabled) assert.ok((await motion()).includes('alune-dlg-leave:160'));
    else await motion();

    // Tab stays inside the open dialog.
    await open();
    for (let step = 0; step < 8; step += 1) {
      await execute('window.__dialogTabTarget = document.activeElement');
      await press('Tab');
      // Native key dispatch can expose <body> between blur and the next focus
      // event. Wait for a real destination, then assert it is inside the dialog.
      await wait(`document.activeElement !== window.__dialogTabTarget &&
        document.activeElement !== document.body &&
        document.activeElement !== document.documentElement`);
      assert.equal(
        await execute(`${shell}.closest('.ant-modal-wrap').contains(document.activeElement)`),
        true,
        `Tab ${step + 1} must keep focus inside the dialog`,
      );
    }
    await close();

    // Reduced motion keeps only a short fade.
    await execute("document.documentElement.dataset.reducedMotion = 'true'");
    await recordMotion();
    await open();
    const reduced = await motion();
    if (motionEnabled) assert.ok(reduced.includes('alune-fade-in:120'), reduced.join());
    assert.equal(
      reduced.some((entry) => entry.startsWith('alune-dlg-rise')),
      false,
    );
    await recordMotion();
    await close();
    if (motionEnabled) assert.ok((await motion()).includes('alune-fade-out:120'));
    else await motion();
    await restoreMotion();

    // ≤560px: a bottom sheet with full-width, stacked 44px actions.
    window.setSize(390, 760);
    await wait('innerWidth <= 400');
    await open();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const sheet = await execute(`(() => {
      const rect = ${shell}.getBoundingClientRect();
      const buttons = Array.from(${shell}.querySelectorAll('.a-dlg-actions .ant-btn')).map((button) => button.getBoundingClientRect());
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight,
        buttons: buttons.map((button) => ({ height: button.height, width: button.width, top: button.top })) };
    })()`);
    assert.ok(
      Math.abs(sheet.left) <= 1 && Math.abs(sheet.right - sheet.width) <= 1,
      JSON.stringify(sheet),
    );
    assert.ok(Math.abs(sheet.bottom - sheet.height) <= 1, JSON.stringify(sheet));
    assert.equal(sheet.buttons.length, 2);
    for (const button of sheet.buttons) assert.equal(Math.round(button.height), 44);
    assert.notEqual(sheet.buttons[0].top, sheet.buttons[1].top);
    await close();
    console.log(
      `Desktop dialogs passed: L2 alertdialog with Cancel focus and disabled ↵, Esc and focus return, focus trap, ${motionEnabled ? '360ms enter / 160ms exit and reduced-motion fade' : 'system reduced motion respected'}, and 390px bottom sheet.`,
    );
  } finally {
    await restoreMotion().catch(() => {});
    window.setSize(...originalSize);
  }
};
