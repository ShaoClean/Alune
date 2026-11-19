// Blocking bootstrap. Electron supplies the native window background until hydration.
(() => {
  if (window.aluneWorkspace) return;
  const root = document.documentElement;
  let theme;
  try {
    const owner = sessionStorage.getItem('alune.last-owner');
    const key = owner ? 'alune-workspace:' + owner : 'alune-workspace';
    const saved = JSON.parse(localStorage.getItem(key));
    const appearance = saved?.version === 1 ? saved.state?.appearance : null;
    theme = appearance?.theme;
    if (appearance?.reduceMotion === true) root.dataset.reducedMotion = 'true';
  } catch {
    /* Unavailable or malformed preferences fall back to the system. */
  }
  root.dataset.theme = theme === 'light' || theme === 'dark'
    ? theme
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
