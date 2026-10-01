// Shared renderer checks in actual Electron. This is a fixture entry, not a unit test.
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.ALUNE_DIALOG_PROFILE);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const evaluate = (fn, arg) =>
    window.webContents.executeJavaScript(
      `(${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})`,
      true,
    );
  const waitForFunction = async (fn, arg) => {
    const until = Date.now() + 10000;
    while (!(await evaluate(fn, arg))) {
      if (Date.now() > until) throw new Error(`Timed out: ${fn}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  const selector = (value) =>
    value.startsWith('text="')
      ? [...document.querySelectorAll('button')].find(
          (n) => n.textContent.trim() === value.slice(6, -1),
        )
      : document.querySelector(value);
  const resolve = (fn) => async (value, arg) =>
    window.webContents.executeJavaScript(
      `(${fn.toString()})((${selector.toString()})(${JSON.stringify(value)}), ${JSON.stringify(arg) ?? 'undefined'})`,
      true,
    );
  const page = {
    goto: (url) => window.loadURL(url),
    evaluate,
    waitForFunction,
    waitForSelector: (value) => waitForFunction((value) => !!document.querySelector(value), value),
    click: resolve((node) => {
      node.focus();
      node.click();
    }),
    fill: resolve((node, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }),
    press: async (value, key) => {
      await resolve((node) => node.focus())(value);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
    },
  };
  try {
    const { runDialogChecks } = await import('../../website/scripts/ui-dialog-browser.mjs');
    console.log('Electron UI dialogs:', JSON.stringify(await runDialogChecks(page)));
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    window.destroy();
    app.exit(1);
  }
});
