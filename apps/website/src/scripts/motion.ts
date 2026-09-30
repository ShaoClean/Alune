const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Map<HTMLElement, Animation>();

/** The resting styles stay visible, even without JS or animation support. */
export function reveal(element: HTMLElement, { duration = 700, delay = 0, distance = 24 } = {}) {
  running.get(element)?.cancel();
  running.delete(element);
  if (reducedMotion.matches || typeof element.animate !== 'function') return;
  // Do not move a control while the keyboard user is interacting with it.
  if (element.contains(document.activeElement)) return;
  const animation = element.animate(
    [
      { opacity: 0, translate: `0 ${distance}px` },
      { opacity: 1, translate: '0 0' },
    ],
    { duration, delay, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' },
  );
  running.set(element, animation);
  const release = () => {
    if (running.get(element) === animation) running.delete(element);
  };
  animation.addEventListener('finish', release, { once: true });
  animation.addEventListener('cancel', release, { once: true });
}

reducedMotion.addEventListener('change', () => {
  if (!reducedMotion.matches) return;
  running.forEach((animation) => animation.cancel());
  running.clear();
});

document.addEventListener('focusin', (event) => {
  running.forEach((animation, element) => {
    if (event.target instanceof Node && element.contains(event.target)) animation.finish();
  });
});

export function initScrollMotion() {
  if (!('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  const revealed = new WeakSet<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || reducedMotion.matches) return;
        const element = entry.target as HTMLElement;
        revealed.add(element);
        observer.unobserve(element);
        reveal(element, { delay: Number(element.dataset.revealDelay) || 0 });
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
  );
  const observe = () => {
    observer.disconnect();
    if (reducedMotion.matches) return;
    targets.forEach((target) => {
      if (!revealed.has(target)) observer.observe(target);
    });
  };
  reducedMotion.addEventListener('change', observe);
  observe();
}
