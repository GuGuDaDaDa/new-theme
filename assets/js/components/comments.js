/** Article comments: server data, single-level replies, and submission. */
import { t } from '../core/i18n.js';
import { initDialog } from '../core/dialog.js';
import { readLocal, writeLocal } from '../core/storage.js';
import { safeURL } from '../core/url.js';
import {
  clearAdminToken,
  readAdminToken,
  sameEmail,
  verifyAdmin,
  writeAdminToken,
} from './comments-admin.js';
import {
  EMOJI_PAGE_SIZE,
  emojiImageURL,
  emojiImageURLs,
  emojiInsertText,
  parseEmojiPacks,
} from './comments-emoji.js';
import {
  createMarkdownRenderer,
  setAllowedImages,
} from './comments-markdown.js';

/** Identity fields are remembered only after an explicit opt-in. */
const IDENTITY_KEY = 'night:comments:identity';
/** Identity inputs stored with the remembered record. */
const IDENTITY_FIELDS = ['nickname', 'email', 'website'];
/** Root comments requested per page. */
const ROOT_LIMIT = 10;
/** Replies shown before a root comment can be expanded. */
const REPLY_PREVIEW = 3;
/** Longest a comment request may run before it is aborted. */
const REQUEST_TIMEOUT = 15000;
/** Address sent when the reader leaves the optional email field empty. */
const ANONYMOUS_EMAIL = 'example@example.com';
/** Avatar shown when the API provides no usable image. */
const AVATAR_FALLBACK =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg>';

/**
 * Enhance the server-rendered comment section on an article page.
 * @param {Document} root - Document holding the comment section.
 * @returns {() => void} Cleanup callback.
 */
export function initComments(root) {
  const section = root.querySelector('[data-comments]');
  if (!section) return () => {};

  const base = new URL(section.dataset.apiBase, location.href).href.replace(
    /\/$/,
    '',
  );
  const emojiURL = section.dataset.emoji
    ? new URL(section.dataset.emoji, location.href).href
    : '';
  const siteId = section.dataset.siteId;
  const postSlug = `${location.origin}${location.pathname}`;
  const renderMarkdown = createMarkdownRenderer(location.href);
  const dateFormat = new Intl.DateTimeFormat(
    document.documentElement.lang || 'zh-CN',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
  );

  const home = section.querySelector('[data-composer-home]');
  const form = section.querySelector('[data-composer]');
  const fields = section.querySelector('[data-composer-fields]');
  const legend = section.querySelector('[data-composer-title]');
  const body = section.querySelector('[data-comment-body]');
  const preview = section.querySelector('[data-comment-preview]');
  const notice = section.querySelector('[data-reply-notice]');
  const replyName = section.querySelector('[data-reply-name]');
  const gotoReply = section.querySelector('[data-goto-reply]');
  const cancelButton = section.querySelector('[data-cancel-reply]');
  const submitButton = section.querySelector('[data-submit]');
  const submitStatus = section.querySelector('[data-submit-status]');
  const remember = section.querySelector('[data-remember]');
  const list = section.querySelector('[data-comment-list]');
  const listStatus = section.querySelector('[data-list-status]');
  const count = section.querySelector('[data-comment-count]');
  const badgeIcon = section.querySelector('[data-owner-badge]');
  const loadMoreButton = section.querySelector('[data-load-more]');
  const loadStatus = section.querySelector('[data-load-status]');
  const panel = section.querySelector('[data-emoji-panel]');
  const emojiToggle = section.querySelector('[data-emoji-toggle]');
  const emojiClose = section.querySelector('[data-emoji-close]');
  const packList = section.querySelector('[data-emoji-categories]');
  const grid = section.querySelector('[data-emoji-grid]');
  const pageLabel = section.querySelector('[data-emoji-page]');
  const previousButton = section.querySelector('[data-emoji-prev]');
  const nextButton = section.querySelector('[data-emoji-next]');
  const emojiStatus = section.querySelector('[data-emoji-status]');
  const editButton = section.querySelector('[data-mode-edit]');
  const previewButton = section.querySelector('[data-mode-preview]');
  const authDialog = section.querySelector('[data-comments-auth-dialog]');
  const authInput = section.querySelector('[data-admin-key]');
  const authStatus = section.querySelector('[data-admin-status]');
  const authConfirm = section.querySelector('[data-admin-confirm]');
  const authCancel = section.querySelector('[data-admin-cancel]');
  const adminNotice = section.querySelector('[data-admin-notice]');
  const authModal = initDialog(authDialog);
  const identity = Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, form.elements.namedItem(field)]),
  );

  const state = {
    roots: [],
    page: 0,
    pages: 1,
    total: 0,
    ready: false,
    failed: false,
    loading: false,
    packs: {},
    pack: '',
    emojiPage: 0,
    activeReply: null,
    submitting: false,
    previewing: false,
    verifying: false,
    authRetry: false,
    adminEmail: '',
    requiredAdminEmail: '',
    badge: t('comments.ownerBadge'),
    badgeEnabled: true,
  };
  const expanded = new Set();
  const requests = new Set();
  const events = new AbortController();
  const { signal } = events;
  let selection = [0, 0];
  let disposed = false;

  /**
   * Build one comment API URL.
   * @param {string} path - Path below the configured base.
   * @param {Record<string, string>} [params] - Query parameters.
   * @returns {string} Absolute URL.
   */
  function apiURL(path, params = {}) {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    if (siteId) url.searchParams.set('site_id', siteId);
    return url.href;
  }

  /**
   * Fetch JSON with a bounded timeout.
   * @param {string} url - Absolute request URL.
   * @param {RequestInit} [options] - Extra fetch options.
   * @returns {Promise<object>} Parsed payload.
   */
  async function request(url, options = {}) {
    const control = new AbortController();
    requests.add(control);
    const timer = setTimeout(() => control.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        ...options,
        signal: control.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message ?? '');
        error.status = response.status;
        error.payload = payload ?? {};
        throw error;
      }
      return payload ?? {};
    } finally {
      clearTimeout(timer);
      requests.delete(control);
    }
  }

  /**
   * Request one page of root comments.
   * @param {number} page - Page number.
   * @returns {Promise<object>} Comments payload.
   */
  function fetchComments(page) {
    return request(
      apiURL('/api/comments', {
        post_slug: postSlug,
        page: String(page),
        limit: String(ROOT_LIMIT),
        nested: 'true',
      }),
    );
  }

  /**
   * Store the pagination fields of one payload.
   * @param {object} payload - Comments payload.
   * @returns {void}
   */
  function applyPagination(payload) {
    const pagination = payload.pagination ?? {};
    state.page = pagination.page ?? state.page;
    state.pages = pagination.total ?? state.pages;
    state.total = pagination.totalCount ?? state.total;
  }

  /**
   * Read the first page of comments.
   * @returns {Promise<void>} Completion.
   */
  async function loadComments() {
    state.failed = false;
    try {
      const payload = await fetchComments(1);
      if (disposed) return;
      state.roots = Array.isArray(payload.data) ? payload.data : [];
      applyPagination(payload);
      state.ready = true;
    } catch {
      if (disposed) return;
      state.failed = true;
      state.ready = true;
    }
  }

  /**
   * Reload the first page after a reader action.
   * @returns {Promise<void>} Completion.
   */
  async function retryComments() {
    state.ready = false;
    state.roots = [];
    render();
    await loadComments();
    if (!disposed) render();
  }

  /**
   * Append the next page of root comments.
   * @returns {Promise<void>} Completion.
   */
  async function loadMoreComments() {
    if (state.loading || state.page >= state.pages) return;
    state.loading = true;
    render();
    try {
      const payload = await fetchComments(state.page + 1);
      if (disposed) return;
      state.roots = state.roots.concat(
        Array.isArray(payload.data) ? payload.data : [],
      );
      applyPagination(payload);
    } catch {
      if (disposed) return;
    }
    state.loading = false;
    render();
  }

  /**
   * Reload every shown page so server data stays authoritative.
   * @returns {Promise<void>} Completion.
   */
  async function refreshComments() {
    const pages = Math.max(1, state.page);
    const results = await Promise.allSettled(
      Array.from({ length: pages }, (_, index) => fetchComments(index + 1)),
    );
    if (disposed) return;
    const roots = [];
    const seen = new Set();
    let updated = false;
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      updated = true;
      applyPagination(result.value);
      for (const comment of result.value.data ?? []) {
        if (seen.has(comment.id)) continue;
        seen.add(comment.id);
        roots.push(comment);
      }
    }
    if (updated) state.roots = roots;
    render();
  }

  /**
   * Read the public configuration that controls the owner badge.
   * @returns {Promise<void>} Completion.
   */
  async function loadConfig() {
    try {
      const payload = await request(apiURL('/api/config/comments'));
      if (disposed) return;
      const badge =
        typeof payload.adminBadge === 'string' ? payload.adminBadge.trim() : '';
      state.badge = badge || t('comments.ownerBadge');
      state.badgeEnabled = payload.adminEnabled !== false;
      state.adminEmail =
        typeof payload.adminEmail === 'string' ? payload.adminEmail.trim() : '';
      updateAdminNotice();
    } catch {
      // The theme label stands when the public configuration is unavailable.
    }
  }

  /**
   * Read the configured OwO expression file.
   * @returns {Promise<void>} Completion.
   */
  async function loadEmoji() {
    if (!emojiURL) return;
    try {
      const payload = await request(emojiURL);
      if (disposed) return;
      state.packs = parseEmojiPacks(payload);
      setAllowedImages(emojiImageURLs(state.packs, location.href));
      state.pack = Object.keys(state.packs)[0] ?? '';
    } catch {
      if (disposed) return;
      emojiStatus.textContent = t('comments.emojiUnavailable');
    }
  }

  /**
   * Persist or clear the identity fields after an explicit opt-in.
   * @returns {void}
   */
  function rememberIdentity() {
    if (!remember.checked) {
      writeLocal(IDENTITY_KEY, null);
      return;
    }
    const record = {};
    for (const field of IDENTITY_FIELDS) record[field] = identity[field].value;
    if (!writeLocal(IDENTITY_KEY, record))
      submitStatus.textContent = t('comments.rememberFailed');
  }

  /**
   * Restore the identity fields the reader chose to remember.
   * @returns {void}
   */
  function restoreIdentity() {
    const saved = readLocal(IDENTITY_KEY);
    if (!saved) return;
    for (const field of IDENTITY_FIELDS) {
      if (typeof saved[field] === 'string')
        identity[field].value = saved[field];
    }
    remember.checked = true;
  }

  /** Reveal the administrator hint when the typed email matches the blog owner. */
  function updateAdminNotice() {
    adminNotice.hidden = !sameEmail(identity.email.value, state.adminEmail);
  }

  /**
   * Decide whether the typed email needs administrator credentials: either the
   * public configuration names it, or the server already demanded a key for it.
   * @returns {boolean} Whether the submission carries the administrator identity.
   */
  function submitAdmin() {
    return (
      sameEmail(identity.email.value, state.adminEmail) ||
      sameEmail(identity.email.value, state.requiredAdminEmail)
    );
  }

  /**
   * Open the administrator key dialog.
   * @param {boolean} retry - Whether a verified key should resend the comment.
   * @returns {void}
   */
  function openAuth(retry) {
    state.authRetry = retry;
    state.verifying = false;
    authConfirm.disabled = false;
    authInput.value = '';
    authStatus.textContent = '';
    toggleEmoji(false);
    authModal.open(submitButton, authInput);
  }

  /** Verify the typed administrator key, then continue the pending submission. */
  async function confirmAuth() {
    if (state.verifying) return;
    const token = authInput.value.trim();
    if (!token) {
      authStatus.textContent = t('comments.adminKeyRequired');
      authInput.focus({ preventScroll: true });
      return;
    }
    state.verifying = true;
    authConfirm.disabled = true;
    authStatus.textContent = t('comments.adminKeyVerifying');
    try {
      await verifyAdmin(request, base, token);
      if (disposed) return;
      writeAdminToken(token);
      state.verifying = false;
      authConfirm.disabled = false;
      const retry = state.authRetry;
      state.authRetry = false;
      updateAdminNotice();
      authModal.close();
      if (retry) void sendComment();
    } catch (error) {
      if (disposed) return;
      state.verifying = false;
      authConfirm.disabled = false;
      clearAdminToken();
      authStatus.textContent = error.message || t('comments.adminKeyFailed');
      authInput.focus({ preventScroll: true });
    }
  }

  /** Save the caret before toolbar actions take focus. */
  function saveSelection() {
    selection = [body.selectionStart, body.selectionEnd];
  }

  /**
   * Switch edit and preview modes without dropping the draft.
   * @param {boolean} enabled - Whether preview is selected.
   * @returns {void}
   */
  function setPreview(enabled) {
    state.previewing = enabled;
    body.hidden = enabled;
    preview.hidden = !enabled;
    editButton.setAttribute('aria-pressed', String(!enabled));
    previewButton.setAttribute('aria-pressed', String(enabled));
    if (!enabled) return;
    if (body.value.trim()) preview.innerHTML = renderMarkdown(body.value);
    else preview.textContent = t('comments.previewEmpty');
  }

  /**
   * Insert a snippet at the saved caret.
   * @param {string} text - Snippet to insert.
   * @returns {void}
   */
  function insertText(text) {
    setPreview(false);
    body.focus({ preventScroll: true });
    body.setSelectionRange(...selection);
    body.setRangeText(text, ...selection, 'end');
    saveSelection();
  }

  /** Focus the editor and reveal its current location. */
  function focusEditor() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    form.scrollIntoView({
      block: 'center',
      behavior: reduced ? 'instant' : 'smooth',
    });
    (state.previewing ? preview : body).focus({ preventScroll: true });
    if (!state.previewing) body.setSelectionRange(...selection);
  }

  /**
   * Open or close the in-flow expression picker.
   * @param {boolean} open - Desired open state.
   * @returns {void}
   */
  function toggleEmoji(open) {
    panel.hidden = !open;
    emojiToggle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    renderEmoji();
    packList.querySelector('button')?.focus({ preventScroll: true });
  }

  /**
   * Render the expression categories and the current page of items.
   * @returns {void}
   */
  function renderEmoji() {
    packList.replaceChildren();
    for (const name of Object.keys(state.packs)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-pressed', String(name === state.pack));
      button.addEventListener(
        'click',
        () => {
          state.pack = name;
          state.emojiPage = 0;
          renderEmoji();
        },
        { signal },
      );
      packList.append(button);
    }
    const pack = state.packs[state.pack];
    grid.replaceChildren();
    if (!pack) return;
    grid.dataset.type = pack.type;
    const items = pack.container.slice(
      state.emojiPage * EMOJI_PAGE_SIZE,
      (state.emojiPage + 1) * EMOJI_PAGE_SIZE,
    );
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = item.text || item.icon;
      button.setAttribute(
        'aria-label',
        item.text ||
          (pack.type === 'image' ? t('comments.emojiImage') : item.icon),
      );
      if (pack.type === 'image') {
        const url = emojiImageURL(item, location.href);
        if (!url) continue;
        const image = document.createElement('img');
        image.src = url;
        image.alt = '';
        button.append(image);
      } else button.textContent = item.icon;
      button.addEventListener(
        'click',
        () => {
          const text =
            pack.type === 'image'
              ? emojiInsertText(item, location.href, t('comments.emojiImage'))
              : item.icon;
          if (!text) return;
          insertText(text);
          toggleEmoji(false);
          emojiToggle.focus({ preventScroll: true });
        },
        { signal },
      );
      grid.append(button);
    }
    const total = Math.max(
      1,
      Math.ceil(pack.container.length / EMOJI_PAGE_SIZE),
    );
    pageLabel.textContent = `${state.emojiPage + 1} / ${total}`;
    previousButton.disabled = state.emojiPage === 0;
    nextButton.disabled = state.emojiPage + 1 >= total;
  }

  /**
   * Move the single editor to the active reply target or back to the top.
   * @returns {void}
   */
  function placeEditor() {
    notice.hidden = !state.activeReply;
    if (state.activeReply) {
      const { id, name } = state.activeReply;
      legend.textContent = t('comments.replyLegend', { Name: name });
      replyName.textContent = `@${name}`;
      const target = section.querySelector(`#comment-${id} > .comment-card`);
      if (target) target.after(form);
      else home.append(form);
    } else {
      legend.textContent = t('comments.legend');
      home.append(form);
    }
    submitButton.textContent = state.submitting
      ? t('comments.submitting')
      : state.activeReply
        ? t('comments.submitReply')
        : t('comments.submit');
    cancelButton.disabled = state.submitting;
  }

  /**
   * Build the list item for one comment.
   * @param {object} comment - Comment record from the API.
   * @param {number} rootId - Root comment grouping this row.
   * @param {boolean} [reply] - Whether the row is a reply.
   * @returns {HTMLLIElement} List item.
   */
  function commentRow(comment, rootId, reply = false) {
    const item = document.createElement('li');
    item.className = reply ? 'comment-reply' : 'comment-root';
    item.id = `comment-${comment.id}`;
    const card = document.createElement('article');
    card.className = 'comment-card';
    card.setAttribute(
      'aria-label',
      t('comments.cardLabel', { Name: comment.name ?? comment.author ?? '' }),
    );

    const avatar = document.createElement('div');
    avatar.className = 'comment-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const avatarURL = safeURL(comment.avatar, location.href);
    if (avatarURL) {
      const image = document.createElement('img');
      image.src = avatarURL;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener(
        'error',
        () => {
          avatar.innerHTML = AVATAR_FALLBACK;
        },
        { once: true },
      );
      avatar.append(image);
    } else avatar.innerHTML = AVATAR_FALLBACK;

    const content = document.createElement('div');
    content.className = 'comment-content';
    const metadata = document.createElement('div');
    metadata.className = 'comment-meta';
    const name = comment.name ?? comment.author ?? '';
    const website = safeURL(comment.url, location.href);
    const author = document.createElement(website ? 'a' : 'span');
    author.className = 'comment-name';
    author.textContent = name;
    if (website) {
      author.href = website;
      author.target = '_blank';
      author.rel = 'ugc nofollow noopener noreferrer';
    }
    metadata.append(author);
    if (comment.isAdmin === true && state.badgeEnabled) {
      const badge = document.createElement('span');
      badge.className = 'owner-badge';
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', state.badge);
      badge.append(badgeIcon.content.cloneNode(true));
      metadata.append(badge);
    }
    const created = new Date(comment.created ?? comment.pubDate);
    const time = document.createElement('time');
    time.dateTime = created.toISOString();
    time.textContent = dateFormat.format(created);
    if (reply && comment.replyToAuthor) {
      const target = document.createElement('span');
      target.className = 'reply-to';
      target.textContent = t('comments.replyTo', {
        Name: comment.replyToAuthor,
      });
      metadata.append(target);
    }
    metadata.append(time);
    content.append(metadata);

    const text = document.createElement('div');
    text.className = 'comment-body';
    text.innerHTML = renderMarkdown(
      comment.contentText ?? comment.content ?? '',
    );
    const replyButton = document.createElement('button');
    replyButton.className = 'reply-button';
    replyButton.type = 'button';
    replyButton.textContent = t('comments.reply');
    replyButton.disabled = state.submitting;
    replyButton.setAttribute(
      'aria-label',
      t('comments.replyTo', { Name: name }),
    );
    replyButton.addEventListener('click', () => startReply(comment, rootId), {
      signal,
    });
    content.append(text, replyButton);

    card.append(avatar, content);
    item.append(card);
    return item;
  }

  /**
   * Build the reply group under a root comment.
   * @param {object} root - Root comment record.
   * @returns {HTMLElement} Reply list and its fold control.
   */
  function replyGroup(root) {
    const wrap = document.createElement('div');
    const replies = document.createElement('ol');
    replies.className = 'replies';
    replies.id = `replies-${root.id}`;
    const open = expanded.has(root.id);
    const visible = open ? root.replies : root.replies.slice(0, REPLY_PREVIEW);
    for (const reply of visible)
      replies.append(commentRow(reply, root.id, true));
    wrap.append(replies);
    if (root.replies.length > REPLY_PREVIEW) {
      const fold = document.createElement('button');
      fold.className = 'fold-replies';
      fold.type = 'button';
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-controls', replies.id);
      fold.disabled = state.submitting || state.activeReply?.rootId === root.id;
      fold.textContent =
        state.activeReply?.rootId === root.id
          ? t('comments.foldingWhileReplying')
          : open
            ? t('comments.unfoldReplies')
            : t('comments.foldReplies', {
                Count: root.replies.length - REPLY_PREVIEW,
              });
      fold.addEventListener(
        'click',
        () => {
          if (open) expanded.delete(root.id);
          else expanded.add(root.id);
          render();
          section
            .querySelector(`#comment-${root.id} > .fold-replies`)
            ?.focus({ preventScroll: true });
        },
        { signal },
      );
      wrap.append(fold);
    }
    return wrap;
  }

  /**
   * Redraw the list, editor placement, and loading controls.
   * @returns {void}
   */
  function render() {
    home.append(form);
    list.replaceChildren();
    listStatus.replaceChildren();
    count.textContent = state.ready && !state.failed ? String(state.total) : '';

    if (state.failed) {
      listStatus.textContent = t('comments.loadFailed');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = t('comments.retry');
      retry.addEventListener('click', () => void retryComments(), { signal });
      listStatus.append(retry);
    } else if (!state.ready) {
      listStatus.textContent = t('comments.loading');
    } else if (!state.roots.length) {
      listStatus.textContent = t('comments.empty');
    } else {
      for (const root of state.roots) {
        const item = commentRow(root, root.id);
        if (root.replies?.length) item.append(replyGroup(root));
        list.append(item);
      }
    }

    const remaining = state.ready && !state.failed && state.page < state.pages;
    loadMoreButton.hidden = !remaining;
    loadMoreButton.disabled = state.loading;
    loadMoreButton.textContent = state.loading
      ? t('comments.loading')
      : t('comments.loadMore');
    loadStatus.textContent =
      !remaining && state.roots.length ? t('comments.allShown') : '';

    emojiToggle.hidden = !Object.keys(state.packs).length;
    if (emojiToggle.hidden) toggleEmoji(false);
    updateAdminNotice();

    placeEditor();
  }

  /**
   * Enter reply mode and keep the active root visible.
   * @param {object} comment - Reply target.
   * @param {number} rootId - Root grouping id.
   * @returns {void}
   */
  function startReply(comment, rootId) {
    if (state.submitting) return;
    state.activeReply = { id: comment.id, rootId, name: comment.name };
    expanded.add(rootId);
    toggleEmoji(false);
    submitStatus.textContent = '';
    render();
    focusEditor();
  }

  /**
   * Return the editor and its unchanged draft to the top.
   * @param {boolean} [focus] - Whether to focus the relocated editor.
   * @returns {void}
   */
  function cancelReply(focus = true) {
    if (state.submitting) return;
    state.activeReply = null;
    render();
    if (focus) focusEditor();
  }

  /**
   * Build the submission body from the current editor state.
   * @returns {object} Comment payload.
   */
  function collectPayload() {
    const payload = {
      post_slug: postSlug,
      post_title: section.dataset.postTitle,
      post_url: section.dataset.postUrl,
      name: identity.nickname.value.trim(),
      email: identity.email.value.trim() || ANONYMOUS_EMAIL,
      content: body.value,
    };
    const website = safeURL(identity.website.value.trim(), location.href);
    if (website) payload.url = website;
    if (state.activeReply) payload.parent_id = state.activeReply.id;
    if (siteId) payload.site_id = siteId;
    const token = submitAdmin() ? readAdminToken() : '';
    if (token) payload.adminToken = token;
    return payload;
  }

  /** Send the current editor content and apply the server result. */
  async function sendComment() {
    if (state.submitting) return;
    const target = state.activeReply;
    rememberIdentity();
    state.submitting = true;
    fields.disabled = true;
    toggleEmoji(false);
    submitStatus.textContent = t('comments.submitting');
    render();
    let authRequired = false;
    try {
      const result = await request(apiURL('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectPayload()),
      });
      if (disposed) return;
      state.submitting = false;
      fields.disabled = false;
      body.value = '';
      selection = [0, 0];
      state.activeReply = null;
      setPreview(false);
      if (target) expanded.add(target.rootId);
      if (result.status === 'pending') {
        submitStatus.textContent = t('comments.statusPending');
        render();
      } else {
        await refreshComments();
        if (disposed) return;
        submitStatus.textContent = t('comments.statusSubmitted');
      }
    } catch (error) {
      if (disposed) return;
      state.submitting = false;
      fields.disabled = false;
      submitStatus.textContent = error.message || t('comments.statusFailed');
      if (error.status === 401) {
        clearAdminToken();
        state.requiredAdminEmail = identity.email.value.trim();
        authRequired = true;
        updateAdminNotice();
      }
      render();
    }
    if (authRequired) {
      openAuth(true);
      return;
    }
    submitStatus.tabIndex = -1;
    submitStatus.focus({ preventScroll: true });
    submitStatus.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Validate the editor and request administrator verification when required.
   * @param {SubmitEvent} event - Form submission.
   * @returns {void}
   */
  function submit(event) {
    event.preventDefault();
    if (state.submitting) return;
    if (!identity.nickname.value.trim() || !body.value.trim()) {
      submitStatus.textContent = t('comments.statusInvalid');
      setPreview(false);
      body.focus();
      return;
    }
    if (submitAdmin() && !readAdminToken()) {
      openAuth(true);
      return;
    }
    void sendComment();
  }

  editButton.addEventListener(
    'click',
    () => {
      setPreview(false);
      body.focus();
      body.setSelectionRange(...selection);
    },
    { signal },
  );
  previewButton.addEventListener('click', () => setPreview(true), { signal });
  for (const button of section.querySelectorAll('[data-format]')) {
    button.addEventListener(
      'click',
      () => {
        const selected = body.value.slice(...selection);
        const snippets = {
          bold: `**${selected || t('comments.sampleBold')}**`,
          link: `[${selected || t('comments.sampleLink')}](https://)`,
          quote: `\n> ${(selected || t('comments.sampleQuote')).replace(/\n/g, '\n> ')}\n`,
          code: `\n\n\`\`\`\n${selected || t('comments.sampleCode')}\n\`\`\`\n\n`,
        };
        insertText(snippets[button.dataset.format]);
      },
      { signal },
    );
  }
  for (const type of ['input', 'select', 'keyup', 'click', 'blur']) {
    body.addEventListener(type, saveSelection, { signal });
  }
  form.addEventListener('submit', submit, { signal });
  form.addEventListener('invalid', () => setPreview(false), {
    signal,
    capture: true,
  });
  emojiToggle.addEventListener('click', () => toggleEmoji(panel.hidden), {
    signal,
  });
  emojiClose.addEventListener(
    'click',
    () => {
      toggleEmoji(false);
      emojiToggle.focus({ preventScroll: true });
    },
    { signal },
  );
  panel.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      toggleEmoji(false);
      emojiToggle.focus({ preventScroll: true });
      event.stopPropagation();
    },
    { signal },
  );
  previousButton.addEventListener(
    'click',
    () => {
      state.emojiPage -= 1;
      renderEmoji();
      nextButton.focus({ preventScroll: true });
    },
    { signal },
  );
  nextButton.addEventListener(
    'click',
    () => {
      state.emojiPage += 1;
      renderEmoji();
      previousButton.focus({ preventScroll: true });
    },
    { signal },
  );
  gotoReply.addEventListener('click', focusEditor, { signal });
  cancelButton.addEventListener('click', () => cancelReply(), { signal });
  loadMoreButton.addEventListener('click', () => void loadMoreComments(), {
    signal,
  });
  remember.addEventListener('change', rememberIdentity, { signal });
  for (const field of IDENTITY_FIELDS) {
    identity[field].addEventListener('change', rememberIdentity, { signal });
  }
  identity.email.addEventListener('input', updateAdminNotice, { signal });
  authDialog.querySelector('[data-comments-auth-form]').addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      void confirmAuth();
    },
    { signal },
  );
  authConfirm.addEventListener('click', () => void confirmAuth(), { signal });
  authCancel.addEventListener('click', () => authModal.close(), { signal });

  updateAdminNotice();
  restoreIdentity();
  render();
  void Promise.allSettled([loadComments(), loadConfig(), loadEmoji()]).then(
    () => {
      if (!disposed) render();
    },
  );

  return () => {
    disposed = true;
    events.abort();
    for (const control of requests) control.abort();
    requests.clear();
    authModal.cleanup();
  };
}
