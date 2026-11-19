const { app } = require('electron');

const showNativeWindow = process.env.ALUNE_SMOKE_VISIBLE === '1';

function focusContents(window) {
  if (showNativeWindow) {
    window.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
    window.focus();
  }
  // A hidden BrowserWindow can still hold focus within its own renderer.
  window.webContents.focus();
}

async function focusSmokeWindow(window) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    focusContents(window);
    if (await window.webContents.executeJavaScript('document.hasFocus()')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Smoke window did not acquire renderer focus');
}

module.exports = Object.assign(focusSmokeWindow, { focusContents, showNativeWindow });
