/** Manual featured-post selection for the home hero. */

const instances = new WeakMap();

/**
 * Initialize the home hero once for a document.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initHero(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const hero = root.querySelector('[data-hero]');
  if (!hero) return () => {};

  const data = JSON.parse(hero.querySelector('[data-hero-data]').textContent);
  const choices = [...hero.querySelectorAll('[data-hero-choice]')];
  const cover = hero.querySelector('[data-hero-cover]');
  const controller = new AbortController();
  const { signal } = controller;
  let imageRequest = 0;
  let pendingImage = null;

  /** Stop the current detached image request. */
  const cancelPendingImage = () => {
    if (!pendingImage) return;
    pendingImage.onload = null;
    pendingImage.onerror = null;
    pendingImage.removeAttribute('srcset');
    pendingImage.removeAttribute('sizes');
    pendingImage.removeAttribute('src');
    pendingImage = null;
  };

  /** Hide the current large image while preserving the hero backdrop. */
  const hideCover = () => {
    cover.hidden = true;
    hero.classList.add('hero-cover-empty');
  };

  /** Commit a loaded image only when its post is still selected. */
  const loadCover = (item, request) => {
    cancelPendingImage();
    if (!item.cover.url) {
      hideCover();
      return;
    }
    const image = new Image();
    pendingImage = image;
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.sizes = '100vw';
    if (item.cover.srcset.length) image.srcset = item.cover.srcset.join(', ');
    image.onload = () => {
      if (request !== imageRequest) return;
      pendingImage = null;
      cover.srcset = image.srcset;
      cover.sizes = image.sizes;
      cover.src = item.cover.url;
      cover.style.objectPosition = item.cover.position;
      if (item.cover.width && item.cover.height) {
        cover.width = item.cover.width;
        cover.height = item.cover.height;
      } else {
        cover.removeAttribute('width');
        cover.removeAttribute('height');
      }
      cover.hidden = false;
      hero.classList.remove('hero-cover-empty');
    };
    image.onerror = () => {
      if (request === imageRequest) {
        pendingImage = null;
        hideCover();
      }
    };
    image.src = item.cover.url;
  };

  /** Render the selected post fields without replacing trusted DOM structure. */
  const render = (index) => {
    imageRequest += 1;
    const item = data[index];
    const link = hero.querySelector('[data-hero-link]');
    const read = hero.querySelector('[data-hero-read]');
    const description = hero.querySelector('[data-hero-description]');
    const date = hero.querySelector('[data-hero-date]');

    for (const [choiceIndex, choice] of choices.entries()) {
      choice.setAttribute('aria-pressed', String(choiceIndex === index));
    }
    link.textContent = item.title;
    link.href = item.url;
    read.href = item.url;
    description.textContent = item.heroExcerpt;
    description.hidden = !item.heroExcerpt;
    date.textContent = `${item.displayDateKind === 'updated' ? '更新于\u00a0' : ''}${item.displayDate}`;
    date.dateTime = item.displayDateISO;
    hero.querySelector('[data-hero-time]').textContent =
      `${item.readingMinutes} 分钟`;

    hideCover();
    loadCover(item, imageRequest);
  };

  for (const choice of choices) {
    choice.addEventListener(
      'click',
      () => render(Number(choice.dataset.heroChoice)),
      { signal },
    );
  }

  for (const thumbnail of hero.querySelectorAll('[data-hero-thumb]')) {
    const markFailed = () => {
      thumbnail.hidden = true;
      thumbnail.parentElement.classList.add('hero-choice-thumb-empty');
    };
    thumbnail.addEventListener('error', markFailed, { signal });
    if (thumbnail.complete && !thumbnail.naturalWidth) markFailed();
  }

  cover.addEventListener('error', hideCover, { signal });
  if (!cover.hidden && cover.complete && !cover.naturalWidth) hideCover();
  hero.dataset.heroEnhanced = '';

  const cleanup = () => {
    imageRequest += 1;
    cancelPendingImage();
    controller.abort();
    delete hero.dataset.heroEnhanced;
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
