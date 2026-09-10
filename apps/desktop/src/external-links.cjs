// New windows stay blocked; only web URLs may leave the renderer via the OS browser.
function createExternalLinkHandler(openExternal) {
  return ({ url }) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return { action: 'deny' };
    }
    if (target.protocol === 'https:' || target.protocol === 'http:') {
      void openExternal(target.href).catch((error) => {
        console.warn('无法打开外部链接：', error.message);
      });
    }
    return { action: 'deny' };
  };
}

module.exports = { createExternalLinkHandler };
