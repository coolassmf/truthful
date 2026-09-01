const { app, BrowserWindow, session, ipcMain, shell, Menu, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { Adblocker } = require('./adblocker');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const INTERNAL_DIR = path.join(RENDERER_DIR, 'internal');
const isDev = process.argv.includes('--dev');

let store;
let adblocker;
let mainWindow;

// ---------------------------------------------------------------------------
// Custom internal protocol:  browser://newtab , browser://api/<name>
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'browser', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function registerInternalProtocol() {
  protocol.handle('browser', async (request) => {
    const url = new URL(request.url);
    const host = url.hostname || 'newtab';

    if (host === 'api') {
      const name = url.pathname.replace(/^\/+/, '') || 'newtab';
      let body = {};
      if (name === 'newtab') {
        body = {
          settings: store.settings,
          bookmarks: store.data.bookmarks.slice(0, 24),
          history: store.data.history.slice(0, 12),
        };
      }
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }

    let file = path.join(INTERNAL_DIR, host + url.pathname);
    if (!path.extname(file)) file += '.html';
    const resolved = path.normalize(file);
    if (!resolved.startsWith(INTERNAL_DIR)) return new Response('Forbidden', { status: 403 });
    try {
      const buf = await fs.promises.readFile(resolved);
      return new Response(buf, { headers: { 'content-type': MIME[path.extname(resolved)] || 'text/plain' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
const downloads = new Map();
let downloadSeq = 0;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function uniquePath(dir, name) {
  let target = path.join(dir, name);
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let i = 1;
  while (fs.existsSync(target)) target = path.join(dir, `${base} (${i++})${ext}`);
  return target;
}

function setupDownloads(ses) {
  ses.on('will-download', (event, item) => {
    const id = ++downloadSeq;
    downloads.set(id, item);

    if (!store.settings.askWhereToSaveDownloads) {
      const dir = app.getPath('downloads');
      item.setSavePath(uniquePath(dir, item.getFilename()));
    }

    const snapshot = () => ({
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: item.getReceivedBytes(),
      state: item.getState(),
      paused: item.isPaused(),
      canResume: item.canResume(),
      startTime: item.getStartTime(),
    });

    send('download:started', snapshot());
    item.on('updated', () => send('download:updated', snapshot()));
    item.once('done', (e, state) => {
      const snap = snapshot();
      snap.state = state;
      send('download:done', snap);
      store.addDownloadRecord({
        id: `${Date.now()}-${id}`,
        filename: snap.filename,
        url: snap.url,
        savePath: snap.savePath,
        totalBytes: snap.totalBytes,
        state,
        ts: Date.now(),
      });
      downloads.delete(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 680,
    minHeight: 420,
    backgroundColor: '#202124',
    title: 'Truthful',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(RENDERER_DIR, 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', () => {
    try {
      mainWindow.webContents.send('session:collect');
    } catch { /* ignore */ }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Per-webview wiring: popups become tabs, sensible permission handling.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    send('tab:open', url);
    return { action: 'deny' };
  });

  contents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({ label: 'Open Link in New Tab', click: () => send('tab:open', params.linkURL) });
      items.push({ label: 'Copy Link Address', click: () => require('electron').clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
      items.push({
        label: `Search for "${params.selectionText.slice(0, 24)}"`,
        click: () => send('tab:open', store.settings.searchEngine.replace('%s', encodeURIComponent(params.selectionText))),
      });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Back', click: () => contents.navigationHistory.goBack() });
    items.push({ label: 'Forward', click: () => contents.navigationHistory.goForward() });
    items.push({ label: 'Reload', click: () => contents.reload() });
    items.push({ type: 'separator' });
    items.push({ label: 'Inspect Element', click: () => contents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup();
  });
});

// ---------------------------------------------------------------------------
// Application menu / keyboard shortcuts
// ---------------------------------------------------------------------------
function relay(channel) {
  return () => send(channel);
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: relay('shortcut:new-tab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: relay('shortcut:close-tab') },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: relay('shortcut:reopen-tab') },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: relay('shortcut:find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: relay('shortcut:reload') },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: relay('shortcut:hard-reload') },
        { label: 'Stop', accelerator: 'Esc', click: relay('shortcut:stop') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: relay('shortcut:zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: relay('shortcut:zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: relay('shortcut:zoom-reset') },
        { type: 'separator' },
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: relay('shortcut:devtools') },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: relay('shortcut:back') },
        { label: 'Forward', accelerator: 'Alt+Right', click: relay('shortcut:forward') },
        { label: 'Home', accelerator: 'Alt+Home', click: relay('shortcut:home') },
        { type: 'separator' },
        { label: 'Show Full History', accelerator: 'CmdOrCtrl+H', click: relay('panel:history') },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Tab', accelerator: 'CmdOrCtrl+D', click: relay('shortcut:bookmark') },
        { label: 'Show All Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: relay('panel:bookmarks') },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: relay('panel:downloads') },
        { label: 'Settings', accelerator: process.platform === 'darwin' ? 'Cmd+,' : 'Ctrl+,', click: relay('panel:settings') },
        { type: 'separator' },
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: relay('shortcut:focus-omnibox') },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: relay('shortcut:next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: relay('shortcut:prev-tab') },
      ],
    },
  ];

  for (let i = 1; i <= 8; i++) {
    template[template.length - 1].submenu.push({
      label: `Switch to Tab ${i}`, accelerator: `CmdOrCtrl+${i}`, visible: false,
      click: () => send('shortcut:goto-tab', i - 1),
    });
  }
  template[template.length - 1].submenu.push({
    label: 'Switch to Last Tab', accelerator: 'CmdOrCtrl+9', visible: false,
    click: () => send('shortcut:goto-tab', -1),
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('state:get', () => ({
    history: store.data.history,
    bookmarks: store.data.bookmarks,
    downloads: store.data.downloads,
    settings: store.settings,
    session: store.data.session,
    adblock: adblocker.stats(),
  }));

  ipcMain.handle('history:add', (_e, entry) => { store.addHistory(entry); });
  ipcMain.handle('history:remove', (_e, id) => { store.removeHistory(id); return store.data.history; });
  ipcMain.handle('history:clear', () => { store.clearHistory(); return []; });

  ipcMain.handle('bookmarks:toggle', (_e, bm) => store.toggleBookmark(bm));
  ipcMain.handle('bookmarks:remove', (_e, id) => { store.removeBookmark(id); return store.data.bookmarks; });
  ipcMain.handle('bookmarks:is', (_e, url) => store.isBookmarked(url));
  ipcMain.handle('bookmarks:get', () => store.data.bookmarks);

  ipcMain.handle('settings:get', () => store.settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.setSettings(patch);
    if ('adblock' in patch) adblocker.set(!!patch.adblock);
    return s;
  });

  ipcMain.handle('adblock:stats', () => adblocker.stats());

  ipcMain.on('download:action', (_e, { id, action }) => {
    const item = downloads.get(id);
    if (!item) return;
    if (action === 'pause') item.pause();
    else if (action === 'resume') item.resume();
    else if (action === 'cancel') item.cancel();
  });
  ipcMain.on('download:open', (_e, p) => { shell.openPath(p); });
  ipcMain.on('download:reveal', (_e, p) => { shell.showItemInFolder(p); });
  ipcMain.handle('downloads:clear', () => { store.clearDownloads(); return []; });

  ipcMain.on('session:save', (_e, sess) => store.saveSession(sess));

  ipcMain.on('window:new', () => createWindow());

  ipcMain.handle('dialog:downloadPath', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  store = new Store();
  registerInternalProtocol();

  adblocker = new Adblocker();
  await adblocker.init(session.defaultSession);
  if (store.settings.adblock) adblocker.enable();

  // A more browser-like user agent (strip Electron/app tokens).
  const ua = session.defaultSession.getUserAgent()
    .replace(/ Truthful\/[^ ]+/i, '')
    .replace(/ Electron\/[^ ]+/i, '');
  session.defaultSession.setUserAgent(ua);

  setupDownloads(session.defaultSession);
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
