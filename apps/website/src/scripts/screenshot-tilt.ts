export function initScreenshotTilt() {
  const enabled = matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  const resets: (() => void)[] = [];

  document.querySelectorAll<HTMLElement>('[data-screenshot-tilt]').forEach((host) => {
    const surface = host.querySelector<HTMLElement>('.shell');
    if (!surface) return;
    let frame = 0;

    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      surface.removeAttribute('data-tilt-active');
      surface.style.removeProperty('--tilt-x');
      surface.style.removeProperty('--tilt-y');
    };

    const move = (event: PointerEvent) => {
      if (!enabled.matches || event.pointerType !== 'mouse') return;
      // Measure the stable host, so the moving image cannot feed back into its angle.
      const bounds = host.getBoundingClientRect();
      const imageHeight = bounds.height * (surface.offsetHeight / host.offsetHeight);
      const relativeY = event.clientY - bounds.top;
      if (relativeY < 0 || relativeY > imageHeight) {
        reset();
        return;
      }
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      const x = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 2);
      const y = clamp((relativeY / imageHeight - 0.5) * 2);

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        surface.dataset.tiltActive = '';
        surface.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
        surface.style.setProperty('--tilt-y', `${(x * 7).toFixed(2)}deg`);
        frame = 0;
      });
    };

    host.addEventListener('pointerenter', move);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', reset);
    host.addEventListener('pointercancel', reset);
    resets.push(reset);
  });

  const resetAll = () => resets.forEach((reset) => reset());
  enabled.addEventListener('change', resetAll);
  window.addEventListener('blur', resetAll);
  window.addEventListener('scroll', resetAll, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetAll();
  });
}
