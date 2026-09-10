/** Three-state light, dark, and system theme control. */

import { readStorage, writeStorage } from '../core/storage.js';

const THEME_KEY = 'bugu-theme';
const MODES = ['light', 'dark', 'system'];
const MODE_LABELS = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};
const THEME_LABELS = { light: '浅色', dark: '深色' };
const instances = new WeakMap();

/**
 * Resolve a persisted value to the supported theme-mode contract.
 * @param {string|null} value - Persisted value.
 * @returns {'light'|'dark'|'system'} Supported theme mode.
 */
function normalizeMode(value) {
  return MODES.includes(value) ? value : 'system';
}

/**
 * Resolve the actual rendered theme for a selected mode.
 * @param {'light'|'dark'|'system'} mode - Selected theme mode.
 * @param {MediaQueryList} system - System dark-mode query.
 * @returns {'light'|'dark'} Actual rendered theme.
 */
function resolveTheme(mode, system) {
  return mode === 'system' ? (system.matches ? 'dark' : 'light') : mode;
}

/**
 * Initialize the theme menu once for a document.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initTheme(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const control = root.querySelector('[data-theme-control]');
  if (!control) return () => {};
  const trigger = control.querySelector('[data-theme-trigger]');
  const menu = control.querySelector('[data-theme-menu]');
  const options = [...control.querySelectorAll('[data-theme-option]')];
  const system = matchMedia('(prefers-color-scheme: dark)');
  const controller = new AbortController();
  const { signal } = controller;
  let storage = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  let mode = normalizeMode(
    root.documentElement.dataset.themeMode || readStorage(storage, THEME_KEY),
  );

  /** Apply theme state to the document and control labels. */
  const render = () => {
    const theme = resolveTheme(mode, system);
    root.documentElement.dataset.themeMode = mode;
    root.documentElement.dataset.theme = theme;
    root.documentElement.style.colorScheme = theme;
    trigger.setAttribute(
      'aria-label',
      `主题：${MODE_LABELS[mode]}，当前${THEME_LABELS[theme]}`,
    );
    for (const option of options) {
      option.setAttribute(
        'aria-checked',
        String(option.dataset.themeOption === mode),
      );
    }
  };

  /**
   * Close the menu.
   * @param {boolean} restoreFocus - Whether to focus the trigger afterward.
   */
  const close = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  /** Open the menu and focus the selected option. */
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const selected = options.find(
      (option) => option.dataset.themeOption === mode,
    );
    selected.focus();
  };

  trigger.addEventListener(
    'click',
    () => {
      if (menu.hidden) open();
      else close(true);
    },
    { signal },
  );

  for (const option of options) {
    option.addEventListener(
      'click',
      () => {
        mode = normalizeMode(option.dataset.themeOption);
        writeStorage(storage, THEME_KEY, mode);
        render();
        close(true);
      },
      { signal },
    );
  }

  menu.addEventListener(
    'keydown',
    (event) => {
      const current = options.indexOf(root.activeElement);
      let target = -1;
      if (event.key === 'ArrowDown') target = (current + 1) % options.length;
      if (event.key === 'ArrowUp')
        target = (current - 1 + options.length) % options.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = options.length - 1;
      if (target >= 0) {
        event.preventDefault();
        options[target].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        close();
      }
    },
    { signal },
  );

  root.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !control.contains(event.target)) close();
    },
    { signal },
  );

  /** Update system-controlled themes when the OS preference changes. */
  const onSystemChange = () => {
    if (mode === 'system') render();
  };
  system.addEventListener('change', onSystemChange);
  render();

  const cleanup = () => {
    controller.abort();
    system.removeEventListener('change', onSystemChange);
    instances.delete(root);
  };
  instances.set(root, cleanup);
  return cleanup;
}
