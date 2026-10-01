const { app } = require('electron');

// A window can be visible without its application being active on macOS CI.
// Keyboard and clipboard checks need both native activation and renderer focus.
module.exports = async function focusSmokeWindow(window) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    window.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
    window.focus();
    window.webContents.focus();
    if (await window.webContents.executeJavaScript('document.hasFocus()')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Smoke window did not acquire native and renderer focus');
};
