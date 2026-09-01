const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

function on(channel, cb) {
  const wrapped = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  listeners.set(cb, { channel, wrapped });
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(cb);
  };
}

contextBridge.exposeInMainWorld('browser', {
  // state
  getState: () => ipcRenderer.invoke('state:get'),

  // history
  addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
  removeHistory: (id) => ipcRenderer.invoke('history:remove', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),

  // bookmarks
  toggleBookmark: (bm) => ipcRenderer.invoke('bookmarks:toggle', bm),
  removeBookmark: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:is', url),
  getBookmarks: () => ipcRenderer.invoke('bookmarks:get'),

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickDownloadPath: () => ipcRenderer.invoke('dialog:downloadPath'),

  // adblock
  adblockStats: () => ipcRenderer.invoke('adblock:stats'),

  // downloads
  downloadAction: (id, action) => ipcRenderer.send('download:action', { id, action }),
  openDownload: (p) => ipcRenderer.send('download:open', p),
  revealDownload: (p) => ipcRenderer.send('download:reveal', p),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

  // session
  saveSession: (sess) => ipcRenderer.send('session:save', sess),
  newWindow: () => ipcRenderer.send('window:new'),

  // events from main
  on,
});
