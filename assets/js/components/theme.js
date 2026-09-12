/** Three-state light, dark, and system theme control. */

import { readStorage, writeStorage } from '../core/storage.js';

const THEME_KEY = 'bugu-theme';
const MODES = ['light', 'dark', 'system'];
const MODE_LABELS = {
  light: '浅色',
  dark: '深色',
  system: '自动（跟随系统）',
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
 * Initialize the cycling theme button once for a document.
 * @param {Document} root - Current document.
 * @returns {() => void} Cleanup callback.
 */
export function initTheme(root) {
  const existing = instances.get(root);
  if (existing) return existing;

  const control = root.querySelector('[data-theme-control]');
  if (!control) return () => {};
  const trigger = control.querySelector('[data-theme-trigger]');
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
    const nextMode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    const label = `主题：${MODE_LABELS[mode]}，当前${THEME_LABELS[theme]}；点击切换为${MODE_LABELS[nextMode]}`;
    trigger.setAttribute('aria-label', label);
    trigger.title = label;
  };

  trigger.addEventListener(
    'click',
    () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      writeStorage(storage, THEME_KEY, mode);
      render();
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
