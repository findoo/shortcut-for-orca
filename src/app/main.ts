import { app, BrowserWindow, clipboard, ipcMain, Menu, shell, Tray } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Identity, RequestEvent } from '../server.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validatePort } from './settings.ts';
import { initialState, withIdentity, withProxy, withRequest, type AppState } from './state.ts';
import { startProxy, type RunningProxy } from './proxy.ts';

const SMOKE = process.env.SMOKE === '1';
const EXTERNAL = [/^https:\/\/app\.shortcut\.com\//, /^https:\/\/github\.com\/findoo\//];

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let proxy: RunningProxy | undefined; // the one proxy that has not been closed yet
let state: AppState;
let settingsFile: string;
let quitting = false;
let smokeDone = false;

function trayStatus(): string {
  const p = state.proxy;
  if (p.state === 'error') return `Not running: ${p.message}`;
  if (p.state !== 'running') return 'Starting…';
  return state.identity ? `Connected as ${state.identity.name}` : `Running on port ${p.port}`;
}

function updateTray(): void {
  if (!tray) return;
  tray.setTitle(state.proxy.state === 'error' ? '!' : ''); // the menu bar's version of a dock badge
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayStatus(), enabled: false },
      { type: 'separator' },
      { label: 'Open Shortcut for Orca…', click: showWindow },
      { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
    ]),
  );
}

function update(next: AppState): void {
  state = next;
  updateTray();
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', state);
}

// Hook callbacks run inside request handling: never let them throw into it.
function guard<A extends unknown[]>(fn: (...a: A) => void) {
  return (...a: A) => {
    try {
      fn(...a);
    } catch (err) {
      console.error('hook failed:', err);
    }
  };
}

const hooks = {
  onRequest: guard((e: RequestEvent) => update(withRequest(state, e))),
  onIdentity: guard((i: Identity) => update(withIdentity(state, i))),
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function applyPort(value: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const port = validatePort(value);
  if (typeof port === 'string') return { ok: false, error: port };
  if (proxy && proxy.port === port && state.proxy.state === 'running') return { ok: true };
  let next: RunningProxy;
  try {
    next = await startProxy(port, hooks);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  const old = proxy;
  proxy = next;
  update(withProxy(state, { state: 'running', port: next.port }));
  await old?.close().catch((err) => console.error('closing old proxy failed:', err));
  try {
    saveSettings(settingsFile, { port });
  } catch (err) {
    // The new proxy keeps running (it is what the user asked for); it just won't survive a restart.
    return { ok: false, error: `Proxy now on port ${port}, but saving the setting failed: ${message(err)}` };
  }
  return { ok: true };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 920,
    height: 680,
    title: 'Shortcut for Orca',
    // Launch at login starts quietly in the menu bar; the menu bar icon opens the window.
    show: !SMOKE && !app.getLoginItemSettings().wasOpenedAtLogin,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  const page = path.join(__dirname, 'index.html');
  // All external links go through window.app.openExternal; the window never navigates away from our page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== pathToFileURL(page).href) e.preventDefault();
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  void win.loadFile(page);
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return createWindow();
  win.show();
  app.focus({ steal: true }); // menu bar apps aren't activated by showing a window
  win.focus();
}

// Reads the hidden window's text (textContent, so inactive tabs count) and checks the expected copy is there.
async function checkWindow(w: BrowserWindow): Promise<boolean> {
  if (w.webContents.isLoading()) await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
  let text = '';
  for (let i = 0; i < 50 && !text; i++) {
    text = String(
      await w.webContents.executeJavaScript(`document.body.dataset.rendered === '1' ? document.body.textContent : ''`),
    );
    if (!text) await new Promise((r) => setTimeout(r, 100));
  }
  const expected = ['Setup', 'Status', 'JQL guide', 'Settings', 'http://localhost:8089', 'Jira site URL', 'Jira personal access token', 'Waiting for Orca to connect', 'How queries run'];
  let ok = true;
  for (const want of expected) {
    const found = text.includes(want);
    ok &&= found;
    console.log(`${found ? 'PASS' : 'FAIL'} window contains "${want}"`);
  }
  return ok;
}

async function smoke(): Promise<void> {
  if (state.proxy.state === 'running') {
    await fetch(`http://127.0.0.1:${state.proxy.port}/rest/api/2/myself`).catch(() => {});
  }
  const windowOk = win ? await checkWindow(win).catch((err) => (console.log('FAIL window check:', message(err)), false)) : false;
  smokeDone = true;
  console.log(JSON.stringify(state));
  app.exit(state.proxy.state === 'running' && state.log.length === 1 && windowOk ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    const p = proxy;
    proxy = undefined;
    void p?.close().catch(() => {});
  });
  app.on('window-all-closed', () => {}); // stay alive in the menu bar; the proxy keeps serving

  void app.whenReady().then(async () => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    const settings = SMOKE ? DEFAULT_SETTINGS : loadSettings(settingsFile);
    state = initialState(settings.port, app.getLoginItemSettings().openAtLogin);

    ipcMain.handle('state:get', () => state);
    ipcMain.handle('settings:port', (_e, port: unknown) => applyPort(port));
    ipcMain.handle('settings:login', (_e, on: unknown) => {
      app.setLoginItemSettings({ openAtLogin: on === true });
      update({ ...state, launchAtLogin: app.getLoginItemSettings().openAtLogin });
    });
    ipcMain.handle('clipboard:copy', (_e, text: unknown) => {
      if (typeof text === 'string') clipboard.writeText(text);
    });
    ipcMain.handle('open:external', async (_e, url: unknown) => {
      if (typeof url === 'string' && EXTERNAL.some((re) => re.test(url))) await shell.openExternal(url);
    });

    if (SMOKE) setTimeout(() => !smokeDone && app.exit(1), 15000).unref();
    app.dock?.hide(); // already hidden in the packaged app (LSUIElement); this covers `pnpm app`
    tray = new Tray(path.join(__dirname, 'trayTemplate.png'));
    tray.setToolTip('Shortcut for Orca');
    updateTray();
    createWindow();
    try {
      proxy = await startProxy(settings.port, hooks);
      update(withProxy(state, { state: 'running', port: proxy.port }));
    } catch (err) {
      update(withProxy(state, { state: 'error', port: settings.port, message: message(err) }));
    }
    if (SMOKE) await smoke();
  });
}
