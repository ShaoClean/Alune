const fs = require('node:fs');
const path = require('node:path');

const closeModes = ['ask', 'hide', 'system'];
function desktopPreferences(directory, onReadError) {
  const file = path.join(directory, 'desktop.json');
  let value = { closeMode: 'ask', showTitle: true };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (closeModes.includes(saved?.closeMode)) value.closeMode = saved.closeMode;
    if (typeof saved?.showTitle === 'boolean') value.showTitle = saved.showTitle;
  } catch (error) {
    if (error.code !== 'ENOENT') onReadError?.(error);
  }
  return {
    get: () => ({ ...value }),
    update(patch) {
      if (
        !patch ||
        typeof patch !== 'object' ||
        Array.isArray(patch) ||
        !Object.keys(patch).every((key) => key === 'closeMode' || key === 'showTitle') ||
        ('closeMode' in patch && !closeModes.includes(patch.closeMode)) ||
        ('showTitle' in patch && typeof patch.showTitle !== 'boolean')
      )
        throw new Error('无效的桌面偏好');
      const next = { ...value, ...patch };
      fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      value = next;
    },
  };
}

function cleanLabel(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function shortened(value, limit) {
  const chars = Array.from(value);
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : value;
}

function createRepositoryTray({ tray, Menu, platform, preferences, show, quit, send }) {
  let tabs = [];
  let activeId = null;
  let request = 0;
  const heads = new Map();
  let lastMenu;
  let menu;
  function render() {
    const rows = tabs.map((tab) => {
      const head = heads.get(tab.id);
      const name = head?.label || tab.branch;
      const offline = tab.offline || head?.state === 'offline';
      const cached = head?.state === 'cached' || (!head && tab.stale);
      const status = offline
        ? name
          ? '离线，上次读取'
          : '离线'
        : cached && name
          ? '上次读取'
          : '';
      const branch = name || '分支未知';
      return { id: tab.id, label: tab.label, branch, status: status ? '（' + status + '）' : '' };
    });
    const current = rows.find((tab) => tab.id === activeId);
    const title = current ? current.label + ' · ' + current.branch + current.status : '';
    const showTitle = preferences.get().showTitle;
    const signature = JSON.stringify([rows, activeId, showTitle]);
    if (signature === lastMenu) return;
    lastMenu = signature;
    if (platform === 'darwin')
      tray.setTitle(
        showTitle && current
          ? shortened(current.label, 16) + ' · ' + shortened(current.branch, 24) + current.status
          : '',
      );
    tray.setToolTip(title ? 'Alune — ' + title : 'Alune');
    menu = Menu.buildFromTemplate([
      { label: rows.length ? '已打开的仓库' : '尚未打开仓库', enabled: false },
      ...rows.map((row) => {
        const label = row.label + ' · ' + row.branch + row.status;
        return {
          label: platform === 'darwin' ? label : label.replaceAll('&', '&&'),
          type: 'checkbox',
          checked: row.id === activeId,
          click: () => {
            show();
            if (tabs.some((tab) => tab.id === row.id)) send('tray:select', row.id);
            renderAfterClick();
          },
        };
      }),
      { type: 'separator' },
      { label: '显示主窗口', click: show },
      { label: '退出 Alune', click: quit },
    ]);
    tray.setContextMenu(menu);
  }
  // Native checkbox items toggle before the router can acknowledge a selection.
  function renderAfterClick() {
    lastMenu = undefined;
    render();
  }
  function refresh(id = activeId) {
    if (id !== activeId) return;
    const tab = tabs.find((item) => item.id === activeId);
    if (tab && !tab.offline) send('tray:read-head', { id: tab.id, request: ++request });
  }
  function setTabs(snapshot) {
    if (
      !snapshot ||
      !Array.isArray(snapshot.tabs) ||
      !snapshot.tabs.every(
        (t) =>
          t &&
          typeof t.id === 'string' &&
          typeof t.label === 'string' &&
          typeof t.branch === 'string' &&
          typeof t.offline === 'boolean' &&
          typeof t.stale === 'boolean',
      )
    )
      return;
    const previous = tabs.find((t) => t.id === activeId);
    tabs = snapshot.tabs.map((t) => ({
      ...t,
      label: cleanLabel(t.label),
      branch: cleanLabel(t.branch),
    }));
    const ids = new Set(tabs.map((t) => t.id));
    for (const id of heads.keys()) if (!ids.has(id)) heads.delete(id);
    const current = tabs.find((t) => t.id === snapshot.activeId);
    for (const tab of tabs) {
      const head = heads.get(tab.id);
      if (head && head.basis !== tab.branch) heads.delete(tab.id);
    }
    activeId = current?.id ?? null;
    render();
    if (
      current?.id !== previous?.id ||
      current?.branch !== previous?.branch ||
      current?.offline !== previous?.offline ||
      current?.revision !== previous?.revision
    ) {
      request++;
      refresh();
    }
  }
  function acceptHead(reply) {
    if (
      !reply ||
      reply.request !== request ||
      reply.id !== activeId ||
      !['ready', 'offline', 'cached'].includes(reply.state)
    )
      return;
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || tab.offline) return;
    if (reply.state === 'ready' && typeof reply.label !== 'string') return;
    heads.set(tab.id, {
      basis: tab.branch,
      state: reply.state,
      label: reply.state === 'ready' ? cleanLabel(reply.label) : heads.get(tab.id)?.label,
    });
    render();
  }
  render();
  if (platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
  const timer = setInterval(refresh, 30_000);
  timer.unref();
  return {
    get menu() {
      return menu;
    },
    setTabs,
    refresh,
    acceptHead,
    render,
    destroy() {
      clearInterval(timer);
      tray.destroy();
    },
  };
}

module.exports = { desktopPreferences, createRepositoryTray };
