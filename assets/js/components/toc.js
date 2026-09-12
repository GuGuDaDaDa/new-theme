/** Desktop reading position tracking for the server-rendered table of contents. */
const instances = new WeakMap();

/**
 * Track real heading anchors without changing focus or browser history.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initToc(root) {
  if (instances.has(root)) return instances.get(root);
  const toc = root.querySelector('[data-toc]');
  const links = [...toc.querySelectorAll('a')];
  const headings = links.map((link) =>
    root.getElementById(decodeURIComponent(link.hash.slice(1))),
  );
  const controller = new AbortController();
  const viewport = matchMedia('(min-width: 1101px)');
  let frame = 0;
  /** Select the last heading that passed the reading line. @returns {void} */
  function update() {
    frame = 0;
    if (!viewport.matches) return;
    let current = 0;
    headings.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top <= 115) current = index;
    });
    if (
      Math.ceil(window.scrollY + window.innerHeight) >=
      root.documentElement.scrollHeight
    ) {
      current = headings.length - 1;
    }
    links.forEach((link, index) => {
      link.classList.toggle('active', index === current);
      if (index === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  /** Coalesce scroll and observer updates. @returns {void} */
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  const observer = new IntersectionObserver(schedule, {
    rootMargin: '-110px 0px -60% 0px',
  });
  headings.forEach((heading) => observer.observe(heading));
  window.addEventListener('scroll', schedule, {
    passive: true,
    signal: controller.signal,
  });
  window.addEventListener('resize', schedule, {
    passive: true,
    signal: controller.signal,
  });
  update();
  const cleanup = () => {
    controller.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    links.forEach((link) => {
      link.classList.remove('active');
      link.removeAttribute('aria-current');
    });
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
