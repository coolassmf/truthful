'use strict';

const HOME = 'browser://newtab';

const state = {
  tabs: [],
  activeId: null,
  closed: [],
  seq: 0,
  settings: {},
  bookmarks: [],
  downloadsLive: new Map(),
  downloadsHistory: [],
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(n, rest);
  for (const [k, v] of Object.entries(dataset || {})) n.dataset[k] = v;
  kids.forEach((c) => n.append(c));
  return n;
};

const views = $('#views');
const tabsEl = $('#tabs');
const omnibox = $('#omnibox');

/* ------------------------------------------------------------------ */
/*  URL / search parsing                                               */
/* ------------------------------------------------------------------ */
function toURL(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^(https?|file|ftp|browser|about|chrome|data|view-source|blob):/i.test(s)) return s;
  const looksDomain =
    /^localhost(:\d+)?([/?#].*)?$/i.test(s) ||
    (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s) && !/\s/.test(s));
  if (looksDomain) return 'https://' + s;
  const engine = state.settings.searchEngine || 'https://www.google.com/search?q=%s';
  return engine.replace('%s', encodeURIComponent(s));
}

function prettyURL(url) {
  if (!url || url === HOME || url === 'about:blank') return '';
  return url;
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */
function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

function createTab(url = HOME, { activate = true, background = false } = {}) {
  const id = ++state.seq;
  const wv = document.createElement('webview');
  wv.setAttribute('src', url);
  wv.setAttribute('allowpopups', 'true');
  wv.setAttribute('webpreferences', 'spellcheck=yes');
  wv.classList.add('hidden');

  const tab = {
    id, webview: wv, url, title: 'New Tab', favicon: '',
    loading: false, canBack: false, canForward: false, zoom: 0,
  };
  state.tabs.push(tab);
  views.append(wv);
  wireWebview(tab);

  if (activate && !background) activateTab(id);
  renderTabs();
  scheduleSessionSave();
  return tab;
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [tab] = state.tabs.splice(idx, 1);
  if (tab.url && tab.url !== HOME) state.closed.push(tab.url);
  tab.webview.remove();

  if (state.tabs.length === 0) {
    createTab(HOME);
    return;
  }
  if (state.activeId === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    activateTab(next.id);
  }
  renderTabs();
  scheduleSessionSave();
}

function activateTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  state.activeId = id;
  state.tabs.forEach((t) => t.webview.classList.toggle('hidden', t.id !== id));
  syncChrome();
  renderTabs();
  setTimeout(() => { try { tab.webview.focus(); } catch {} }, 0);
  scheduleSessionSave();
}

function wireWebview(tab) {
  const wv = tab.webview;
  const isActive = () => tab.id === state.activeId;

  wv.addEventListener('did-start-loading', () => { tab.loading = true; renderTabs(); if (isActive()) syncChrome(); });
  wv.addEventListener('did-stop-loading', () => { tab.loading = false; renderTabs(); if (isActive()) syncChrome(); });

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url;
    renderTabs();
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = (e.favicons && e.favicons[0]) || '';
    renderTabs();
  });

  const onNav = (url) => {
    tab.url = url;
    try {
      tab.canBack = wv.canGoBack();
      tab.canForward = wv.canGoForward();
    } catch {}
    if (isActive()) syncChrome();
    if (url && !url.startsWith('browser://')) {
      window.browser.addHistory({ url, title: tab.title });
    }
    scheduleSessionSave();
  };
  wv.addEventListener('did-navigate', (e) => onNav(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNav(e.url); });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return;
    tab.loading = false; renderTabs();
  });

  wv.addEventListener('found-in-page', (e) => {
    const r = e.result || {};
    $('#find-status').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'No results';
  });

  wv.addEventListener('close', () => closeTab(tab.id));
}

function navigate(input) {
  const url = toURL(input);
  if (!url) return;
  let tab = activeTab();
  if (!tab) { createTab(url); return; }
  try {
    tab.webview.loadURL(url);
  } catch {
    tab.webview.setAttribute('src', url);
  }
}

/* ------------------------------------------------------------------ */
/*  Chrome sync (omnibox, nav buttons, star, shield)                   */
/* ------------------------------------------------------------------ */
async function syncChrome() {
  const tab = activeTab();
  if (!tab) return;

  if (document.activeElement !== omnibox) omnibox.value = prettyURL(tab.url);

  $('#nav-back').disabled = !tab.canBack;
  $('#nav-forward').disabled = !tab.canForward;
  $('#nav-reload').textContent = tab.loading ? '✕' : '↻';

  const scheme = $('#omnibox-scheme');
  if (/^https:/i.test(tab.url)) { scheme.textContent = '\u{1F512}'; scheme.className = 'secure'; }
  else if (/^http:/i.test(tab.url)) { scheme.textContent = '⚠'; scheme.className = 'insecure'; }
  else { scheme.textContent = '⚙'; scheme.className = 'secure'; }

  const bookmarked = await window.browser.isBookmarked(tab.url);
  const star = $('#star-btn');
  star.classList.toggle('on', bookmarked);
  star.textContent = bookmarked ? '★' : '☆';
}

async function refreshShield() {
  const s = await window.browser.adblockStats();
  $('#shield-count').textContent = s.blocked > 999 ? `${(s.blocked / 1000).toFixed(1)}k` : s.blocked;
  $('#shield-btn').classList.toggle('off', !s.enabled);
  $('#shield-btn').title = s.available
    ? (s.enabled ? `Blocking ads & trackers — ${s.blocked} blocked` : 'Ad blocking is OFF')
    : 'Ad blocker unavailable';
}

/* ------------------------------------------------------------------ */
/*  Rendering: tab strip + bookmarks bar                               */
/* ------------------------------------------------------------------ */
function faviconStyle(url, pageUrl) {
  let src = url;
  if (!src && pageUrl && /^https?:/i.test(pageUrl)) {
    try { src = new URL(pageUrl).origin + '/favicon.ico'; } catch {}
  }
  return src ? `background-image:url("${src.replace(/"/g, '')}")` : '';
}

function renderTabs() {
  tabsEl.textContent = '';
  for (const tab of state.tabs) {
    const fav = el('span', { className: 'favicon' });
    if (tab.loading) fav.classList.add('loading');
    else fav.setAttribute('style', faviconStyle(tab.favicon, tab.url));

    const close = el('span', { className: 'close', textContent: '✕', title: 'Close tab' });
    // Use mousedown, not click: activating a tab re-renders the strip, which
    // destroys this node before a click's mouseup can land on it.
    close.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); closeTab(tab.id); });

    const node = el('div', { className: 'tab' + (tab.id === state.activeId ? ' active' : '') }, [
      fav,
      el('span', { className: 'title', textContent: tab.title || 'New Tab', title: tab.title }),
      close,
    ]);
    node.addEventListener('mousedown', (e) => {
      if (e.target.closest('.close')) return;
      if (e.button === 1) { closeTab(tab.id); return; }
      activateTab(tab.id);
    });
    tabsEl.append(node);
  }
}

function renderBookmarksBar() {
  const bar = $('#bookmarksbar');
  bar.textContent = '';
  for (const bm of state.bookmarks.slice(0, 40)) {
    const node = el('div', { className: 'bm', title: bm.url }, [
      el('span', { className: 'favicon', style: faviconStyle('', bm.url) }),
      el('span', { className: 'title', textContent: bm.title }),
    ]);
    node.addEventListener('mousedown', (e) => {
      if (e.button === 1) createTab(bm.url, { background: true });
      else navigate(bm.url);
    });
    node.addEventListener('contextmenu', async () => {
      await window.browser.removeBookmark(bm.id);
      state.bookmarks = await window.browser.getBookmarks();
      renderBookmarksBar();
      syncChrome();
    });
    bar.append(node);
  }
}

/* ------------------------------------------------------------------ */
/*  Panels                                                             */
/* ------------------------------------------------------------------ */
const panel = $('#panel');
const panelOverlay = $('#panel-overlay');

function openPanel(kind) {
  closeMenu();
  panel.classList.remove('hidden');
  panelOverlay.classList.remove('hidden');
  const body = $('#panel-body');
  const bar = $('#panel-toolbar');
  body.textContent = '';
  bar.textContent = '';

  if (kind === 'history') renderHistoryPanel(body, bar);
  else if (kind === 'downloads') { renderDownloadsPanel(body, bar); refreshDownloadsHistory(); }
  else if (kind === 'bookmarks') renderBookmarksPanel(body, bar);
  else if (kind === 'settings') renderSettingsPanel(body, bar);
}

function closePanel() {
  panel.classList.add('hidden');
  panelOverlay.classList.add('hidden');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString();
}
function fmtBytes(b) {
  if (!b || b < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

async function renderHistoryPanel(body, bar) {
  $('#panel-title').textContent = 'History';
  const { history } = await window.browser.getState();

  const search = el('input', { className: 'field', placeholder: 'Search history' });
  const clearBtn = el('button', { className: 'text-btn danger', textContent: 'Clear all' });
  bar.append(search, clearBtn);

  const list = el('div');
  body.append(list);

  const draw = (items) => {
    list.textContent = '';
    if (!items.length) { list.append(el('div', { className: 'empty-state', textContent: 'No history' })); return; }
    let lastGroup = '';
    for (const h of items.slice(0, 500)) {
      const g = new Date(h.ts).toDateString();
      if (g !== lastGroup) { lastGroup = g; list.append(el('div', { className: 'row-group-label', textContent: g })); }
      const del = el('span', { className: 'r-act icon-btn', textContent: '✕', title: 'Remove' });
      const row = el('div', { className: 'row' }, [
        el('span', { className: 'favicon', style: faviconStyle('', h.url) }),
        el('div', { className: 'r-main' }, [
          el('div', { className: 'r-title', textContent: h.title || h.url }),
          el('div', { className: 'r-sub', textContent: `${fmtTime(h.ts)}  ·  ${h.url}` }),
        ]),
        del,
      ]);
      row.addEventListener('click', (e) => { if (e.target !== del) { navigate(h.url); closePanel(); } });
      del.addEventListener('click', async () => { await window.browser.removeHistory(h.id); row.remove(); });
      list.append(row);
    }
  };
  draw(history);

  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    draw(history.filter((h) => (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q)));
  });
  clearBtn.addEventListener('click', async () => {
    await window.browser.clearHistory();
    draw([]);
  });
}

async function renderBookmarksPanel(body, bar) {
  $('#panel-title').textContent = 'Bookmarks';
  const search = el('input', { className: 'field', placeholder: 'Search bookmarks' });
  bar.append(search);
  const list = el('div');
  body.append(list);

  const draw = (items) => {
    list.textContent = '';
    if (!items.length) { list.append(el('div', { className: 'empty-state', textContent: 'No bookmarks yet' })); return; }
    for (const b of items) {
      const del = el('span', { className: 'r-act icon-btn', textContent: '✕', title: 'Remove' });
      const row = el('div', { className: 'row' }, [
        el('span', { className: 'favicon', style: faviconStyle('', b.url) }),
        el('div', { className: 'r-main' }, [
          el('div', { className: 'r-title', textContent: b.title }),
          el('div', { className: 'r-sub', textContent: b.url }),
        ]),
        del,
      ]);
      row.addEventListener('click', (e) => { if (e.target !== del) { navigate(b.url); closePanel(); } });
      del.addEventListener('click', async () => {
        state.bookmarks = await window.browser.removeBookmark(b.id);
        row.remove(); renderBookmarksBar(); syncChrome();
      });
      list.append(row);
    }
  };
  draw(state.bookmarks);
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    draw(state.bookmarks.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)));
  });
}

async function refreshDownloadsHistory() {
  try {
    const { downloads } = await window.browser.getState();
    state.downloadsHistory = downloads || [];
  } catch { /* ignore */ }
  if (isPanelOpen('Downloads')) renderDownloadsPanel($('#panel-body'), $('#panel-toolbar'));
}

function isPanelOpen(title) {
  return !panel.classList.contains('hidden') && $('#panel-title').textContent === title;
}

function renderDownloadsPanel(body, bar) {
  $('#panel-title').textContent = 'Downloads';
  body.textContent = '';
  bar.textContent = '';

  const clearBtn = el('button', { className: 'text-btn', textContent: 'Clear finished' });
  clearBtn.addEventListener('click', async () => {
    await window.browser.clearDownloads();
    state.downloadsHistory = [];
    renderDownloadsPanel(body, bar);
  });
  bar.append(clearBtn);
  const list = el('div');
  body.append(list);

  const live = [...state.downloadsLive.values()].map((d) => ({ ...d, live: true }));
  const liveKeys = new Set(live.map((d) => d.url + ' ' + d.filename));
  const past = (state.downloadsHistory || []).filter((d) => !liveKeys.has(d.url + ' ' + d.filename));
  const combined = [...live, ...past];

  if (!combined.length) { list.append(el('div', { className: 'empty-state', textContent: 'No downloads' })); return; }

  for (const d of combined) {
    const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
    const done = d.state === 'completed';
    const failed = d.state === 'cancelled' || d.state === 'interrupted';

    const sub = el('div', { className: 'r-sub' });
    if (d.live && !done && !failed) {
      sub.textContent = `${fmtBytes(d.receivedBytes)} / ${fmtBytes(d.totalBytes) || '?'} ${d.paused ? '(paused)' : ''}`;
    } else {
      sub.textContent = failed ? 'Failed / cancelled' : `${fmtBytes(d.totalBytes)} · ${d.savePath || ''}`;
    }

    const acts = el('div', { className: 'r-act', style: 'display:flex;gap:2px' });
    if (d.live && !done && !failed) {
      const pause = el('span', { className: 'icon-btn', textContent: d.paused ? '▶' : '⏸' });
      pause.addEventListener('click', () => window.browser.downloadAction(d.id, d.paused ? 'resume' : 'pause'));
      const cancel = el('span', { className: 'icon-btn', textContent: '✕' });
      cancel.addEventListener('click', () => window.browser.downloadAction(d.id, 'cancel'));
      acts.append(pause, cancel);
    } else if (done) {
      const open = el('span', { className: 'icon-btn', textContent: '↗', title: 'Open' });
      open.addEventListener('click', () => window.browser.openDownload(d.savePath));
      const folder = el('span', { className: 'icon-btn', textContent: '\u{1F4C1}', title: 'Show in folder' });
      folder.addEventListener('click', () => window.browser.revealDownload(d.savePath));
      acts.append(open, folder);
    }

    const rows = [
      el('span', { className: 'favicon', style: faviconStyle('', d.url) }),
      el('div', { className: 'r-main' }, [
        el('div', { className: 'r-title', textContent: d.filename }),
        sub,
        ...(d.live && !done && !failed
          ? [el('div', { className: 'dl-bar' }, [el('i', { style: `width:${pct}%` })])]
          : []),
      ]),
      acts,
    ];
    list.append(el('div', { className: 'row', dataset: { dlid: d.id } }, rows));
  }
}

async function renderSettingsPanel(body, bar) {
  $('#panel-title').textContent = 'Settings';
  const s = await window.browser.getSettings();

  const mk = (labelText, control, hint) => {
    const wrap = el('div', { className: 'setting' });
    wrap.append(el('label', { textContent: labelText }));
    wrap.append(control);
    if (hint) wrap.append(el('div', { className: 'hint', textContent: hint }));
    return wrap;
  };

  // Search engine
  const engines = {
    Google: 'https://www.google.com/search?q=%s',
    DuckDuckGo: 'https://duckduckgo.com/?q=%s',
    Bing: 'https://www.bing.com/search?q=%s',
    Brave: 'https://search.brave.com/search?q=%s',
    'Startpage': 'https://www.startpage.com/sp/search?query=%s',
  };
  const sel = el('select', { className: 'field' });
  for (const [name, url] of Object.entries(engines)) {
    sel.append(el('option', { value: url, textContent: name, selected: url === s.searchEngine }));
  }
  if (!Object.values(engines).includes(s.searchEngine)) {
    sel.append(el('option', { value: s.searchEngine, textContent: 'Custom', selected: true }));
  }
  sel.addEventListener('change', async () => {
    const name = sel.options[sel.selectedIndex].textContent;
    state.settings = await window.browser.setSettings({ searchEngine: sel.value, searchEngineName: name });
  });
  body.append(mk('Search engine', sel));

  // Homepage
  const home = el('input', { className: 'field', value: s.homepage });
  home.addEventListener('change', async () => {
    state.settings = await window.browser.setSettings({ homepage: home.value.trim() || HOME });
  });
  body.append(mk('Homepage / new tab', home, 'Use browser://newtab for the built-in start page.'));

  // Adblock
  const ab = el('input', { type: 'checkbox', checked: s.adblock });
  ab.addEventListener('change', async () => {
    state.settings = await window.browser.setSettings({ adblock: ab.checked });
    refreshShield();
  });
  body.append(mk('Ad & tracker blocking',
    el('div', { className: 'switch' }, [ab, el('span', { textContent: 'Block ads and trackers (EasyList + EasyPrivacy)' })])));

  // Ask download location
  const ask = el('input', { type: 'checkbox', checked: s.askWhereToSaveDownloads });
  ask.addEventListener('change', async () => {
    state.settings = await window.browser.setSettings({ askWhereToSaveDownloads: ask.checked });
  });
  body.append(mk('Downloads',
    el('div', { className: 'switch' }, [ask, el('span', { textContent: 'Ask where to save each file' })])));

  // Restore session
  const rs = el('input', { type: 'checkbox', checked: s.restoreSession });
  rs.addEventListener('change', async () => {
    state.settings = await window.browser.setSettings({ restoreSession: rs.checked });
  });
  body.append(mk('On startup',
    el('div', { className: 'switch' }, [rs, el('span', { textContent: 'Reopen tabs from last session' })])));

  body.append(mk('About',
    el('div', { className: 'hint', textContent: 'Truthful 0.1.0 — Chromium via Electron. Not affiliated with Google Chrome or Brave.' })));
}

/* ------------------------------------------------------------------ */
/*  Menu dropdown                                                      */
/* ------------------------------------------------------------------ */
const menu = $('#menu-dropdown');
function toggleMenu() { menu.classList.toggle('hidden'); }
function closeMenu() { menu.classList.add('hidden'); }

menu.addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  closeMenu();
  const t = activeTab();
  switch (act) {
    case 'new-tab': createTab(HOME); break;
    case 'new-window': window.browser.newWindow(); break;
    case 'history': openPanel('history'); break;
    case 'downloads': openPanel('downloads'); break;
    case 'bookmarks': openPanel('bookmarks'); break;
    case 'settings': openPanel('settings'); break;
    case 'find': openFind(); break;
    case 'zoom-in': if (t) t.webview.setZoomLevel((t.zoom += 0.5)); break;
    case 'zoom-out': if (t) t.webview.setZoomLevel((t.zoom -= 0.5)); break;
    case 'devtools': if (t) t.webview.isDevToolsOpened() ? t.webview.closeDevTools() : t.webview.openDevTools(); break;
  }
});

/* ------------------------------------------------------------------ */
/*  Find bar                                                           */
/* ------------------------------------------------------------------ */
const findBar = $('#find-bar');
const findInput = $('#find-input');
function openFind() { findBar.classList.remove('hidden'); findInput.focus(); findInput.select(); }
function closeFind() {
  findBar.classList.add('hidden');
  const t = activeTab();
  if (t) try { t.webview.stopFindInPage('clearSelection'); } catch {}
}
findInput.addEventListener('input', () => {
  const t = activeTab();
  if (t && findInput.value) t.webview.findInPage(findInput.value);
  else $('#find-status').textContent = '';
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const t = activeTab(); if (t && findInput.value) t.webview.findInPage(findInput.value, { findNext: true, forward: !e.shiftKey }); }
  if (e.key === 'Escape') closeFind();
});
$('#find-next').addEventListener('click', () => { const t = activeTab(); if (t) t.webview.findInPage(findInput.value, { findNext: true, forward: true }); });
$('#find-prev').addEventListener('click', () => { const t = activeTab(); if (t) t.webview.findInPage(findInput.value, { findNext: true, forward: false }); });
$('#find-close').addEventListener('click', closeFind);

/* ------------------------------------------------------------------ */
/*  Toolbar wiring                                                     */
/* ------------------------------------------------------------------ */
$('#new-tab').addEventListener('click', () => createTab(HOME));
$('#menu-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
$('#nav-back').addEventListener('click', () => { const t = activeTab(); if (t && t.canBack) t.webview.goBack(); });
$('#nav-forward').addEventListener('click', () => { const t = activeTab(); if (t && t.canForward) t.webview.goForward(); });
$('#nav-reload').addEventListener('click', () => {
  const t = activeTab(); if (!t) return;
  t.loading ? t.webview.stop() : t.webview.reload();
});
$('#nav-home').addEventListener('click', () => navigate(state.settings.homepage || HOME));
$('#downloads-btn').addEventListener('click', () => openPanel('downloads'));

$('#shield-btn').addEventListener('click', async () => {
  const s = await window.browser.adblockStats();
  if (!s.available) return;
  state.settings = await window.browser.setSettings({ adblock: !s.enabled });
  refreshShield();
  const t = activeTab(); if (t) t.webview.reload();
});

$('#star-btn').addEventListener('click', async () => {
  const t = activeTab();
  if (!t || !t.url || t.url === HOME) return;
  await window.browser.toggleBookmark({ url: t.url, title: t.title });
  state.bookmarks = await window.browser.getBookmarks();
  renderBookmarksBar();
  syncChrome();
});

omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigate(omnibox.value); omnibox.blur(); }
  if (e.key === 'Escape') { syncChrome(); omnibox.blur(); }
});
omnibox.addEventListener('focus', () => omnibox.select());

$('#panel-close').addEventListener('click', closePanel);
panelOverlay.addEventListener('click', closePanel);

document.addEventListener('click', (e) => {
  if (!menu.classList.contains('hidden') && !e.target.closest('#menu-dropdown, #menu-btn')) closeMenu();
});

/* ------------------------------------------------------------------ */
/*  Shortcuts from main process                                        */
/* ------------------------------------------------------------------ */
const zoomBy = (d) => { const t = activeTab(); if (t) t.webview.setZoomLevel((t.zoom += d)); };

const shortcuts = {
  'shortcut:new-tab': () => createTab(HOME),
  'shortcut:close-tab': () => state.activeId && closeTab(state.activeId),
  'shortcut:reopen-tab': () => { const u = state.closed.pop(); if (u) createTab(u); },
  'shortcut:reload': () => { const t = activeTab(); if (t) t.webview.reload(); },
  'shortcut:hard-reload': () => { const t = activeTab(); if (t) t.webview.reloadIgnoringCache(); },
  'shortcut:stop': () => { const t = activeTab(); if (t) t.webview.stop(); if (!findBar.classList.contains('hidden')) closeFind(); },
  'shortcut:back': () => { const t = activeTab(); if (t && t.canBack) t.webview.goBack(); },
  'shortcut:forward': () => { const t = activeTab(); if (t && t.canForward) t.webview.goForward(); },
  'shortcut:home': () => navigate(state.settings.homepage || HOME),
  'shortcut:focus-omnibox': () => { omnibox.focus(); omnibox.select(); },
  'shortcut:find': openFind,
  'shortcut:bookmark': () => $('#star-btn').click(),
  'shortcut:devtools': () => { const t = activeTab(); if (t) t.webview.isDevToolsOpened() ? t.webview.closeDevTools() : t.webview.openDevTools(); },
  'shortcut:zoom-in': () => zoomBy(0.5),
  'shortcut:zoom-out': () => zoomBy(-0.5),
  'shortcut:zoom-reset': () => { const t = activeTab(); if (t) t.webview.setZoomLevel((t.zoom = 0)); },
  'shortcut:next-tab': () => cycleTab(1),
  'shortcut:prev-tab': () => cycleTab(-1),
  'panel:history': () => openPanel('history'),
  'panel:downloads': () => openPanel('downloads'),
  'panel:bookmarks': () => openPanel('bookmarks'),
  'panel:settings': () => openPanel('settings'),
};
for (const [ch, fn] of Object.entries(shortcuts)) window.browser.on(ch, fn);

window.browser.on('shortcut:goto-tab', (i) => {
  const target = i === -1 ? state.tabs[state.tabs.length - 1] : state.tabs[i];
  if (target) activateTab(target.id);
});
window.browser.on('tab:open', (url) => createTab(url, { background: false }));
window.browser.on('session:collect', () => saveSessionNow());

function cycleTab(dir) {
  if (state.tabs.length < 2) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = state.tabs[(idx + dir + state.tabs.length) % state.tabs.length];
  activateTab(next.id);
}

/* ------------------------------------------------------------------ */
/*  Downloads live events                                              */
/* ------------------------------------------------------------------ */
function onDownload(kind) {
  return (d) => {
    state.downloadsLive.set(d.id, d);
    if (kind === 'started') { openPanel('downloads'); return; }
    if (kind === 'done') {
      // Persisted record now exists in main; pull it in, then drop the live entry.
      refreshDownloadsHistory();
      setTimeout(() => {
        state.downloadsLive.delete(d.id);
        if (isPanelOpen('Downloads')) renderDownloadsPanel($('#panel-body'), $('#panel-toolbar'));
      }, 8000);
    }
    if (isPanelOpen('Downloads')) renderDownloadsPanel($('#panel-body'), $('#panel-toolbar'));
  };
}
window.browser.on('download:started', onDownload('started'));
window.browser.on('download:updated', onDownload('updated'));
window.browser.on('download:done', onDownload('done'));

/* ------------------------------------------------------------------ */
/*  Session persistence                                                */
/* ------------------------------------------------------------------ */
let sessionTimer = null;
function scheduleSessionSave() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 1000);
}
function saveSessionNow() {
  const tabs = state.tabs.map((t) => t.url).filter((u) => u && u !== 'about:blank');
  const active = Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId));
  window.browser.saveSession({ tabs, active });
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */
async function boot() {
  const st = await window.browser.getState();
  state.settings = st.settings;
  state.bookmarks = st.bookmarks;
  omnibox.placeholder = `Search ${st.settings.searchEngineName || 'the web'} or type a URL`;

  renderBookmarksBar();

  const sess = st.session || { tabs: [], active: 0 };
  if (st.settings.restoreSession && sess.tabs && sess.tabs.length) {
    sess.tabs.forEach((url, i) => createTab(url, { activate: i === (sess.active || 0), background: i !== (sess.active || 0) }));
    const target = state.tabs[sess.active] || state.tabs[0];
    if (target) activateTab(target.id);
  } else {
    createTab(HOME);
  }

  refreshShield();
  setInterval(refreshShield, 4000);
}

boot();
