const { readFileSync, writeFileSync, renameSync, rmSync } = require('node:fs');

function isPreferences(value) {
  return value && typeof value === 'object' && value.version === 1
    && value.state && typeof value.state === 'object' && !Array.isArray(value.state);
}

function isTrustedWorkspaceSender(event, contents, origin) {
  try {
    return Boolean(contents && event.sender === contents && event.senderFrame === contents.mainFrame
      && new URL(event.senderFrame.url).origin === origin);
  } catch { return false; }
}

function createWorkspacePreferences(filePath) {
  return {
    load() {
      try {
        const value = readFileSync(filePath, 'utf8');
        return isPreferences(JSON.parse(value)) ? value : null;
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
        throw error;
      }
    },
    save(value) {
      if (typeof value !== 'string' || !isPreferences(JSON.parse(value))) throw new Error('Invalid workspace preferences');
      const temporary = `${filePath}.tmp`;
      try {
        // Synchronous handlers serialize IPC writes; readers see either complete version.
        writeFileSync(temporary, value, { mode: 0o600 });
        renameSync(temporary, filePath);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    clear() { rmSync(filePath, { force: true }); },
  };
}

function workspaceBackground(value, systemDark) {
  let theme;
  try { theme = JSON.parse(value).state.appearance.theme; } catch {}
  return (theme === 'dark' || (theme !== 'light' && systemDark)) ? '#151e30' : '#f5f7fb';
}

module.exports = { workspaceBackground, createWorkspacePreferences, isTrustedWorkspaceSender };
