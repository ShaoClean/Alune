// A native modal makes the toolbar inert while a Git progress notice is open.
// Keep the return pending until focus really lands, then release the observer.
export function restoreBranchTriggerFocus(target: HTMLButtonElement, onRestored: () => void) {
  const document = target.ownerDocument;
  const view = document.defaultView;
  if (!view) return () => {};
  let frame: number | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    observer.disconnect();
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
  };
  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      if (!target.isConnected || target.disabled) return;
      target.focus({ preventScroll: true });
      if (document.activeElement !== target) return;
      stop();
      onRestored();
    });
  };
  const observer = new view.MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'inert', 'disabled'],
  });
  schedule();
  return stop;
}
