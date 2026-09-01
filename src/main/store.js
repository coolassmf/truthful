const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  searchEngine: 'https://www.google.com/search?q=%s',
  searchEngineName: 'Google',
  homepage: 'browser://newtab',
  adblock: true,
  askWhereToSaveDownloads: true,
  restoreSession: true,
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'truthful-data.json');
    this.data = {
      history: [],
      bookmarks: [],
      downloads: [],
      session: { tabs: [], active: 0 },
      settings: { ...DEFAULTS },
    };
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data,
        ...loaded,
        settings: { ...DEFAULTS, ...(loaded.settings || {}) },
      };
    } catch { /* first run */ }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      fs.writeFile(this.file, JSON.stringify(this.data, null, 2), () => {});
    }, 200);
  }

  get settings() { return this.data.settings; }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  // ---- history ----
  addHistory({ url, title }) {
    if (!url || url.startsWith('browser://') || url === 'about:blank') return;
    const now = Date.now();
    const last = this.data.history[0];
    if (last && last.url === url) {
      last.ts = now;
      if (title) last.title = title;
    } else {
      this.data.history.unshift({ id: `${now}-${Math.random().toString(16).slice(2, 8)}`, url, title: title || url, ts: now });
    }
    if (this.data.history.length > 8000) this.data.history.length = 8000;
    this.save();
  }
  removeHistory(id) {
    this.data.history = this.data.history.filter((h) => h.id !== id);
    this.save();
  }
  clearHistory() { this.data.history = []; this.save(); }

  // ---- bookmarks ----
  toggleBookmark({ url, title }) {
    if (!url) return false;
    const idx = this.data.bookmarks.findIndex((b) => b.url === url);
    if (idx >= 0) {
      this.data.bookmarks.splice(idx, 1);
      this.save();
      return false;
    }
    this.data.bookmarks.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, url, title: title || url, ts: Date.now() });
    this.save();
    return true;
  }
  removeBookmark(id) {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    this.save();
  }
  isBookmarked(url) { return this.data.bookmarks.some((b) => b.url === url); }

  // ---- downloads ----
  addDownloadRecord(rec) {
    this.data.downloads.unshift(rec);
    if (this.data.downloads.length > 500) this.data.downloads.length = 500;
    this.save();
  }
  clearDownloads() { this.data.downloads = []; this.save(); }

  // ---- session ----
  saveSession(sess) { this.data.session = sess; this.save(); }
}

module.exports = { Store, DEFAULTS };
