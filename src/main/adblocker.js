const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let FiltersEngine = null;
let Request = null;
try {
  ({ FiltersEngine, Request } = require('@ghostery/adblocker'));
} catch (e) {
  // adblocker optional
}

let fetchImpl = global.fetch;
try { fetchImpl = require('cross-fetch').fetch || fetchImpl; } catch { /* ignore */ }

const TYPE_MAP = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xhr',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
};

class Adblocker {
  constructor() {
    this.engine = null;
    this.enabled = false;
    this.session = null;
    this.blockedCount = 0;
    this.available = !!FiltersEngine;
    this._handler = null;
  }

  async init(session) {
    this.session = session;
    if (!this.available) return;
    const cachePath = path.join(app.getPath('userData'), 'adblocker-engine.bin');
    try {
      this.engine = await FiltersEngine.fromPrebuiltAdsAndTracking(fetchImpl, {
        path: cachePath,
        read: fs.promises.readFile,
        write: fs.promises.writeFile,
      });
    } catch (err) {
      console.error('[adblock] failed to build engine:', err.message);
      this.available = false;
    }
  }

  enable() {
    if (!this.engine || !this.session || this.enabled) return;
    this._handler = (details, callback) => {
      try {
        if (details.resourceType === 'mainFrame' || !details.url.startsWith('http')) {
          return callback({ cancel: false });
        }
        const request = Request.fromRawDetails({
          url: details.url,
          type: TYPE_MAP[details.resourceType] || 'other',
          sourceUrl: details.referrer || undefined,
        });
        const { match } = this.engine.match(request);
        if (match) this.blockedCount += 1;
        callback({ cancel: !!match });
      } catch {
        callback({ cancel: false });
      }
    };
    this.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, this._handler);
    this.enabled = true;
  }

  disable() {
    if (!this.session || !this.enabled) return;
    this.session.webRequest.onBeforeRequest(null);
    this._handler = null;
    this.enabled = false;
  }

  set(on) { on ? this.enable() : this.disable(); }

  stats() {
    return { available: this.available, enabled: this.enabled, blocked: this.blockedCount };
  }
}

module.exports = { Adblocker };
