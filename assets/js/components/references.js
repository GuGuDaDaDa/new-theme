/** Interactive reference previews sourced exclusively from the article notes. */
import { initDialog } from '../core/dialog.js';

const instances = new WeakMap();

/**
 * Copy readable note content with private IDs and no stale ID associations.
 * @param {HTMLElement} source - The sole server-rendered content source.
 * @param {string} prefix - Unique preview namespace.
 * @returns {HTMLElement} Independent content copy.
 */
function copyContent(source, prefix) {
  const copy = source.cloneNode(true);
  const elements = [copy, ...copy.querySelectorAll('*')];
  const ids = new Map();
  for (const element of elements) {
    if (element.id) {
      const id = `${prefix}-${ids.size}`;
      ids.set(element.id, id);
      element.id = id;
    }
  }
  const associations = [
    'for',
    'headers',
    'list',
    'form',
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-activedescendant',
    'aria-details',
    'aria-errormessage',
    'aria-flowto',
  ];
  for (const element of elements) {
    for (const attribute of associations) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element
        .getAttribute(attribute)
        .split(/\s+/)
        .map((id) => ids.get(id))
        .filter(Boolean)
        .join(' ');
      if (value) element.setAttribute(attribute, value);
      else element.removeAttribute(attribute);
    }
    for (const attribute of ['href', 'xlink:href']) {
      const value = element.getAttribute(attribute);
      if (value?.startsWith('#') && ids.has(value.slice(1))) {
        element.setAttribute(attribute, `#${ids.get(value.slice(1))}`);
      }
    }
    // Copies are readable previews, not new instances of article components.
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith('data-'))
        element.removeAttribute(attribute.name);
    }
  }
  copy
    .querySelectorAll('script, style, button, nav, .fn-backref')
    .forEach((node) => node.remove());
  copy
    .querySelectorAll('.fn-item-link')
    .forEach((node) => node.classList.add('note-source-title'));
  return copy;
}

/**
 * Bind desktop hover/focus previews and mobile modal source panels.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initReferences(root) {
  if (instances.has(root)) return instances.get(root);
  const controller = new AbortController();
  const { signal } = controller;
  const references = [...root.querySelectorAll('[data-reference]')];
  const dialog = root.querySelector('[data-reference-dialog]');
  const modal = initDialog(dialog);
  const mobile = matchMedia('(max-width: 768px)');
  const preview = root.createElement('div');
  preview.id = 'note-preview';
  preview.className = 'popover';
  preview.dataset.referencePreview = '';
  preview.dataset.searchExclude = '';
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', '引用来源');
  preview.hidden = true;
  root.body.append(preview);
  let current = null;
  let suppressedReference = null;
  let mobileTrigger = null;
  let timer = 0;

  /** Cancel a pending pointer/focus dismissal. @returns {void} */
  function cancelClose() {
    clearTimeout(timer);
  }
  /** Hide the desktop preview without stranding keyboard focus. @returns {void} */
  function closePreview() {
    cancelClose();
    if (preview.contains(root.activeElement))
      current?.focus({ preventScroll: true });
    preview.hidden = true;
    preview.replaceChildren();
    current?.setAttribute('aria-expanded', 'false');
    current = null;
  }
  /** Allow the pointer to cross the gap below the reference. @returns {void} */
  function delayClose() {
    cancelClose();
    timer = setTimeout(() => {
      if (
        preview.contains(root.activeElement) ||
        preview.matches(':hover') ||
        current?.matches(':hover') ||
        current?.matches(':focus-visible')
      )
        return;
      closePreview();
    }, 150);
  }
  /** Position below the marker, clamped to the visible viewport. @returns {void} */
  function position() {
    if (!current || preview.hidden) return;
    const box = current.getBoundingClientRect();
    const width = preview.getBoundingClientRect().width;
    const left = Math.max(
      12,
      Math.min(
        box.left + box.width / 2 - width / 2,
        window.innerWidth - width - 12,
      ),
    );
    const top = Math.min(box.bottom + 10, window.innerHeight - 100);
    preview.style.left = `${left}px`;
    preview.style.top = `${Math.max(12, top)}px`;
    preview.style.maxHeight = `${Math.max(80, window.innerHeight - top - 12)}px`;
  }
  /**
   * Resolve the real note addressed by a reference link.
   * @param {HTMLAnchorElement} reference - Article marker.
   * @returns {HTMLElement} Note entry.
   */
  function noteFor(reference) {
    return root.getElementById(reference.hash.slice(1));
  }
  /**
   * Reveal an interactive desktop source copy.
   * @param {HTMLAnchorElement} reference - Hovered or focused marker.
   * @returns {void}
   */
  function showPreview(reference) {
    if (mobile.matches || root.querySelector('dialog[open]')) return;
    if (suppressedReference === reference) {
      if (!reference.matches(':hover')) suppressedReference = null;
      else return;
    }
    cancelClose();
    if (current === reference) return;
    closePreview();
    current = reference;
    const note = noteFor(reference);
    const content = copyContent(
      note.querySelector('[data-reference-content]'),
      'night-preview',
    );
    content.dataset.referencePreviewContent = '';
    const goto = root.createElement('a');
    goto.className = 'note-goto';
    goto.href = reference.hash;
    goto.textContent = '跳到文末注释';
    preview.append(content, goto);
    reference.setAttribute('aria-expanded', 'true');
    preview.hidden = false;
    position();
  }
  /**
   * Move to the original note while keeping its real fragment URL.
   * @param {HTMLElement} note - Target entry.
   * @returns {void}
   */
  function focusNote(note) {
    note.focus({ preventScroll: true });
    note.scrollIntoView({ block: 'start' });
  }
  for (const reference of references) {
    reference.setAttribute('aria-expanded', 'false');
    reference.addEventListener('pointerenter', () => showPreview(reference), {
      signal,
    });
    reference.addEventListener(
      'pointerleave',
      () => {
        if (suppressedReference === reference) suppressedReference = null;
        delayClose();
      },
      { signal },
    );
    reference.addEventListener('focus', () => showPreview(reference), {
      signal,
    });
    reference.addEventListener('blur', delayClose, { signal });
    reference.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Tab' && !event.shiftKey && current === reference) {
          const first = preview.querySelector('a[href]');
          event.preventDefault();
          first.focus();
        }
      },
      { signal },
    );
    reference.addEventListener(
      'click',
      (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        if (!mobile.matches) {
          closePreview();
          return;
        }
        const content = dialog.querySelector(
          '[data-reference-preview-content]',
        );
        content.replaceChildren(
          copyContent(
            noteFor(reference).querySelector('[data-reference-content]'),
            'night-panel',
          ),
        );
        dialog.querySelector('[data-reference-goto]').href = reference.hash;
        mobileTrigger = reference;
        reference.setAttribute('aria-expanded', 'true');
        modal.open(reference);
        event.preventDefault();
      },
      { signal },
    );
  }
  for (const backref of root.querySelectorAll('.fn-backref')) {
    const suppressTargetPreview = () => {
      const reference = root.getElementById(backref.hash.slice(1));
      if (!reference) return;
      suppressedReference = reference;
      closePreview();
    };
    backref.addEventListener('pointerdown', suppressTargetPreview, { signal });
    backref.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter' || event.key === ' ') suppressTargetPreview();
      },
      { signal },
    );
  }
  preview.addEventListener('pointerenter', cancelClose, { signal });
  preview.addEventListener('pointerleave', delayClose, { signal });
  preview.addEventListener('focusin', cancelClose, { signal });
  preview.addEventListener('focusout', delayClose, { signal });
  preview.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Tab') return;
      const links = [...preview.querySelectorAll('a[href]')];
      if (event.shiftKey && root.activeElement === links[0]) {
        event.preventDefault();
        current.focus({ preventScroll: true });
      } else if (!event.shiftKey && root.activeElement === links.at(-1)) {
        // The browser continues Tab from the original marker in article order.
        closePreview();
      }
    },
    { signal },
  );
  preview.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('.note-goto');
      if (!link) return;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const reference = current;
      const note = noteFor(reference);
      suppressedReference = reference;
      closePreview();
      focusNote(note);
    },
    { signal },
  );
  dialog.querySelector('[data-reference-goto]').addEventListener(
    'click',
    (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const note = root.getElementById(event.currentTarget.hash.slice(1));
      modal.close();
      focusNote(note);
    },
    { signal },
  );
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.open) return;
      mobileTrigger?.setAttribute('aria-expanded', 'false');
      mobileTrigger = null;
      dialog
        .querySelector('[data-reference-preview-content]')
        .replaceChildren();
    },
    { signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && current) {
        event.preventDefault();
        closePreview();
      }
    },
    { signal },
  );
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !preview.contains(event.target) &&
        !event.target.closest('[data-reference]')
      )
        closePreview();
    },
    { signal },
  );
  window.addEventListener('scroll', closePreview, { passive: true, signal });
  window.addEventListener('resize', position, { passive: true, signal });
  mobile.addEventListener(
    'change',
    () => {
      closePreview();
      modal.close();
    },
    { signal },
  );
  const cleanup = () => {
    controller.abort();
    closePreview();
    modal.cleanup();
    preview.remove();
    for (const reference of references)
      reference.removeAttribute('aria-expanded');
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
