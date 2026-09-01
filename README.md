# Truthful

A minimal Chromium-based desktop web browser, built with Electron. Real browsing
engine (Blink/V8 via Electron's bundled Chromium) wrapped in a custom UI —
tabs, an omnibox, history, bookmarks, downloads, settings, and built-in
ad / tracker blocking.

## Run

```bash
npm install
npm start        # or: npm run dev  (opens with DevTools)
```

> The launcher (`scripts/launch.js`) strips `ELECTRON_RUN_AS_NODE` before
> starting Electron, so `npm start` works even if that variable is set in your
> shell.

## Features

| Area | What you get |
|------|--------------|
| **Browsing** | Multiple tabs, omnibox (URL or search), back / forward / reload / stop / home, per-tab zoom, find-in-page, popups open as tabs, right-click context menu, DevTools. Plays video (YouTube etc.). |
| **History** | Persistent, searchable, grouped by day, per-entry delete + clear all. |
| **Bookmarks** | Star button in the omnibox, a bookmarks bar (middle-click = open in new tab, right-click = remove), and a searchable manager. |
| **Downloads** | Download panel with live progress, pause / resume / cancel, open file, reveal in folder. Optional "ask where to save". |
| **Ad / tracker blocking** | Network-level blocking with `@ghostery/adblocker` (EasyList + EasyPrivacy, prebuilt lists, cached to disk). Toolbar shield shows the blocked count and toggles it. |
| **Settings** | Search engine (Google / DuckDuckGo / Bing / Brave / Startpage / custom), homepage, ad-block toggle, download prompt, session restore. |
| **Session** | Reopens your tabs on the next launch (toggle in Settings). `Ctrl+Shift+T` reopens a closed tab. |

## Keyboard shortcuts

`Ctrl+T` new tab · `Ctrl+W` close · `Ctrl+Shift+T` reopen · `Ctrl+L` focus omnibox ·
`Ctrl+R` reload · `Ctrl+F` find · `Alt+←/→` back/forward · `Ctrl+D` bookmark ·
`Ctrl+H` history · `Ctrl+J` downloads · `Ctrl+,` settings · `Ctrl+Tab` next tab ·
`Ctrl+1..9` switch tab · `Ctrl+±/0` zoom.

## Project layout

```
src/main/
  main.js        Electron main process: window, menu, internal protocol,
                 downloads, IPC, per-webview wiring
  preload.js     contextBridge API exposed to the browser UI
  store.js       JSON persistence (history / bookmarks / downloads / settings / session)
  adblocker.js   @ghostery/adblocker engine + webRequest network blocking
src/renderer/
  index.html     browser chrome (tab strip, toolbar, panels)
  renderer.js    tab management, navigation, panels, shortcuts
  styles.css
  internal/
    newtab.html  browser://newtab start page
```

Pages render inside `<webview>` tags on the app's default (persistent) session,
so cookies, logins, cache, and downloads all persist between runs.

## Package into a .exe

```bash
npm run dist            # NSIS installer + portable .exe  → dist/
npm run dist:portable   # just the single-file portable .exe
npm run pack            # unpacked app folder (dist/win-unpacked/), no installer
```

Produces (~77 MB each, x64):

| File | What it is |
|------|-----------|
| `dist/Truthful-<ver>-x64.exe` | Installer (NSIS) — lets the user pick a folder, adds Start-menu + desktop shortcuts, registers an uninstaller. |
| `dist/Truthful-<ver>-portable.exe` | Single self-contained executable — double-click to run, no install. |
| `dist/win-unpacked/Truthful.exe` | The raw app directory (from `npm run pack`). |

The build is unsigned, so SmartScreen will show a "Windows protected your PC"
warning on first run (More info → Run anyway). Add a code-signing certificate via
the `win.certificateFile` / `CSC_LINK` options to remove it. To add an app icon,
drop a 256×256 `build/icon.ico` and rebuild.

## Notes / limitations

- Not affiliated with Google Chrome or Brave. No Chrome Web Store / extension support.
- No profile switching, sync, or private-window mode yet.
- Cosmetic ad-filtering (hiding leftover empty boxes) is not applied — only
  network requests are blocked.
- Tabs can't be drag-reordered yet.

## License

MIT
