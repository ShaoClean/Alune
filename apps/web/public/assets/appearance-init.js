// Blocking, same-origin bootstrap: match the saved browser theme before CSS paints.
// Desktop uses workspace.json and a matching native window background instead.
(() => {
  if (window.aluneWorkspace) return;
  try {
    const saved = JSON.parse(localStorage.getItem('alune-workspace'));
    const appearance = saved?.version === 1 ? saved.state?.appearance : null;
    if (appearance?.theme === 'light' || appearance?.theme === 'dark') {
      document.documentElement.dataset.theme = appearance.theme;
    }
    if (appearance?.reduceMotion === true) document.documentElement.dataset.reducedMotion = 'true';
  } catch {
    /* Unavailable or malformed preferences fall back to the system. */
  }
})();
