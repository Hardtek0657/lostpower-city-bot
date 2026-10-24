import { app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { features, featureView } from './bot/registry.js';
import { readTable } from './bot/blackjack/reader.js';
import { SEL } from './bot/selectors.js';
import { loadConfig, patchConfig, publicConfig, resetConfigCache, configPath, getApiKey, setCredentials, getCredentials, clearCredentials, setProxySettings, getProxyPassword } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_TEST = process.argv.includes('--self-test');
const PANEL_W = 340;

if (SELF_TEST) {
  app.setPath('userData', path.join(app.getPath('temp'), 'lostpower-bot-selftest'));
}

const logRing = [];
const running = new Map();
let win = null;
let logWin = null;
let gameView = null;
let proxyAuth = null;

/**
 * Apply the proxy to the game session. Must run before the game URL is loaded so no request
 * ever leaves directly when a proxy is configured.
 */
async function applyProxy() {
  const s = session.fromPartition('persist:lostpower');
  const p = loadConfig().proxy ?? {};
  proxyAuth = null;
  if (!p.enabled || !p.host || !p.port) {
    await s.setProxy({ mode: 'direct' });
    log('app', 'info', 'proxy off — direct connection');
    return null;
  }
  const scheme = ['http', 'https', 'socks5'].includes(p.protocol) ? p.protocol : 'http';
  const rule = `${scheme}://${p.host}:${p.port}`;
  await s.setProxy({ proxyRules: rule, proxyBypassRules: '<-loopback>' });
  const password = await getProxyPassword();
  if (p.username) proxyAuth = { username: p.username, password };
  log('app', 'info', `proxy ${rule}${p.username ? ` · auth as ${p.username}` : ' · no auth'}`);
  return rule;
}

app.on('login', (event, _wc, _details, authInfo, callback) => {
  if (!authInfo?.isProxy) return;
  event.preventDefault();
  if (!proxyAuth) {
    callback('', '');
    return;
  }
  callback(proxyAuth.username, proxyAuth.password ?? '');
});
let status = { id: null, state: 'idle', detail: '' };
let stats = null;

function logFile() {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${day}.jsonl`);
}

function log(feature, level, msg, data) {
  const entry = { t: new Date().toISOString(), feature, level, msg, ...(data ? { data } : {}) };
  logRing.push(entry);
  if (logRing.length > 500) logRing.shift();
  fs.appendFile(logFile(), JSON.stringify(entry) + '\n', () => {});
  win?.webContents.send('log', entry);
  if (level === 'error') console.error(`[${feature}] ${msg}`, data ?? '');
}

function setStatus(id, state, detail = '') {
  status = { id, state, detail };
  win?.webContents.send('status', status);
}

function gameBounds() {
  const { width, height } = win.getContentBounds();
  return { x: 0, y: 0, width: Math.max(320, width - PANEL_W), height: Math.max(200, height) };
}

let lastAutoLoginAt = 0;

async function tryAutoLogin(reason) {
  if (!gameView) return;
  if (!loadConfig().game.autoLogin) return;
  if (Date.now() - lastAutoLoginAt < 15000) return;

  const wc = gameView.webContents;
  let hasForm = false;
  for (let i = 0; i < 12 && !hasForm; i += 1) {
    hasForm = await wc
      .executeJavaScript(`!!document.querySelector(${JSON.stringify(SEL.login.user)})`)
      .catch(() => false);
    if (!hasForm) await new Promise((r) => setTimeout(r, 250));
  }
  if (!hasForm) return;

  const { user, pass } = await getCredentials();
  if (!user || !pass) {
    log('app', 'warn', 'auto-login is on but no credentials are saved');
    return;
  }
  lastAutoLoginAt = Date.now();

  const js = `(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    if (!set(${JSON.stringify(SEL.login.user)}, ${JSON.stringify(user)})) return 'no-form';
    set(${JSON.stringify(SEL.login.pass)}, ${JSON.stringify(pass)});
    const b = document.querySelector(${JSON.stringify(SEL.login.submit)});
    if (!b || b.disabled) return 'no-submit';
    b.click();
    return 'submitted';
  })()`;

  const result = await wc.executeJavaScript(js).catch((e) => `error: ${e.message}`);
  log('app', 'info', `auto-login (${reason}): ${result}`);

  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const hash = await wc.executeJavaScript('location.hash').catch(() => '');
    if (hash && !hash.includes('login')) {
      log('app', 'info', 'auto-login: signed in');
      await leaveCasinoIfIdle(wc);
      return;
    }
  }
  log('app', 'warn', 'auto-login: still on the login page after 10s');
}

/** The game view belongs on the main page unless a casino feature is on. */
async function leaveCasinoIfIdle(wc) {
  const f = loadConfig().features;
  if (f.blackjack?.enabled || f['video-poker']?.enabled || running.size) return;
  const hash = await wc.executeJavaScript('location.hash').catch(() => '');
  if (!hash.includes('playland-casino')) return;
  await wc.executeJavaScript(`location.hash = '#/home'`).catch(() => {});
  log('app', 'info', 'left the casino page — no casino feature is on');
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#05080b',
    title: 'LostPower Bot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'panel', 'index.html'));

  const gameSession = session.fromPartition('persist:lostpower');
  gameSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  gameView = new WebContentsView({
    webPreferences: {
      session: gameSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.contentView.addChildView(gameView);
  gameView.setBounds(gameBounds());
  if (typeof gameView.setBackgroundColor === 'function') gameView.setBackgroundColor('#000000');

  const wc = gameView.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    if (!host.endsWith('lostpower.com')) {
      e.preventDefault();
      log('app', 'warn', `blocked navigation to ${url}`);
    }
  });
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(1);
    setTimeout(() => tryAutoLogin('load'), 800);
  });
  wc.on('did-navigate-in-page', (_e, url) => {
    if (url.includes('/login')) setTimeout(() => tryAutoLogin('login-page'), 300);
  });
  wc.on('render-process-gone', (_e, details) =>
    log('app', 'error', 'game renderer gone', details));

  // Proxy first: the game URL must never load over a direct connection when a proxy is set.
  await applyProxy();
  wc.loadURL(loadConfig().game.url);

  win.on('resize', () => gameView?.setBounds(gameBounds()));
  win.on('closed', () => {
    win = null;
    gameView = null;
    if (logWin && !logWin.isDestroyed()) logWin.close();
  });
}

async function startFeature(id) {
  if (running.has(id)) return;
  const feature = features.find((f) => f.id === id);
  if (!feature) return;
  // Only a toggled-on feature may run — and therefore navigate the game view.
  if (!loadConfig().features[id]?.enabled) {
    log(id, 'warn', 'not started — toggle it on first');
    return;
  }

  const ac = new AbortController();
  const ctx = {
    id,
    config: () => loadConfig().features[id] ?? {},
    settings: async () => {
      const c = loadConfig();
      return { ...c, router: { ...c.router, apiKey: await getApiKey() } };
    },
    signal: ac.signal,
    enabled: () => Boolean(loadConfig().features[id]?.enabled),
    game: gameView.webContents,
    eval: (js) => gameView.webContents.executeJavaScript(js),
    read: () => (feature.read ?? readTable)(gameView.webContents),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (level, msg, data) => log(id, level, msg, data),
    status: (state, detail) => setStatus(id, state, detail),
    report: (s) => {
      stats = { id, ...s };
      win?.webContents.send('stats', stats);
    },
    onEnd: (why) => {
      running.delete(id);
      patchConfig({ features: { [id]: { enabled: false } } });
      win?.webContents.send('features', featureView(loadConfig()));
      log(id, 'info', `run ended — ${why}`);
    },
  };

  stats = null;
  win?.webContents.send('stats', null);
  setStatus(id, 'starting', '');
  log(id, 'info', 'starting');
  try {
    const stop = await feature.start(ctx);
    running.set(id, { stop, ac });
    if (status.state === 'starting') setStatus(id, 'running', '');
  } catch (err) {
    log(id, 'error', String(err?.message ?? err));
    setStatus(id, 'error', String(err?.message ?? err));
  }
}

function stopFeature(id) {
  const r = running.get(id);
  running.delete(id);
  if (r) {
    try {
      r.ac.abort();
      r.stop?.();
    } catch (err) {
      log(id, 'warn', `stop threw: ${err?.message ?? err}`);
    }
    log(id, 'info', 'stopped');
  }
  if (status.id === id) setStatus(id, 'idle', 'stopped');
}

function killAll(reason) {
  log('app', 'warn', `kill switch (${reason})`);
  for (const id of [...running.keys()]) stopFeature(id);
  setStatus(null, 'idle', reason);
}

function sanitizePatch(patch) {
  const out = { features: {} };
  for (const [id, vals] of Object.entries(patch?.features ?? {})) {
    const feature = features.find((f) => f.id === id);
    if (!feature) continue;
    const defs = Object.fromEntries(feature.settings.map((s) => [s.key, s]));
    for (const [k, raw] of Object.entries(vals)) {
      if (k === 'enabled') {
        out.features[id] = { ...out.features[id], enabled: Boolean(raw) };
        continue;
      }
      const d = defs[k];
      if (!d) continue;
      let v = raw;
      if (d.type === 'number') {
        v = Number(v);
        if (!Number.isFinite(v)) continue;
        v = Math.min(d.max ?? 1e9, Math.max(d.min ?? 0, Math.round(v)));
      } else if (d.type === 'bool') {
        v = Boolean(v);
      } else if (d.type === 'select') {
        // HTML selects hand back strings; options may be numbers or {value,label}.
        const values = d.options.map((o) => (o && typeof o === 'object' ? o.value : o));
        const match = values.find((o) => String(o) === String(v));
        if (match === undefined) continue;
        v = match;
      }
      out.features[id] = { ...out.features[id], [k]: v };
    }
  }
  return out;
}

function registerIpc() {
  ipcMain.handle('log:get', () => logRing.slice(-500));

  ipcMain.handle('log:popout', () => {
    if (logWin && !logWin.isDestroyed()) {
      logWin.focus();
      return true;
    }
    logWin = new BrowserWindow({
      width: 980,
      height: 640,
      backgroundColor: '#05080b',
      title: 'LostPower Bot — Log',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    logWin.setMenuBarVisibility(false);
    logWin.loadFile(path.join(__dirname, 'panel', 'log.html'));
    logWin.on('closed', () => { logWin = null; });
    return true;
  });

  ipcMain.handle('state:get', () => ({
    config: publicConfig(),
    features: featureView(loadConfig()),
    status,
    stats,
    log: logRing.slice(-200),
  }));

  ipcMain.handle('config:patch', (_e, patch) => {
    patchConfig(sanitizePatch(patch));
    return { config: publicConfig(), features: featureView(loadConfig()) };
  });

  ipcMain.handle('feature:setEnabled', async (_e, id, on) => {
    if (!features.some((f) => f.id === id)) return { features: featureView(loadConfig()) };
    patchConfig({ features: { [id]: { enabled: Boolean(on) } } });
    if (on) await startFeature(id);
    else stopFeature(id);
    return { features: featureView(loadConfig()), status };
  });

  ipcMain.handle('auth:clear', () => {
    clearCredentials();
    log('app', 'info', 'auto-login credentials cleared');
    return { config: publicConfig() };
  });

  ipcMain.handle('proxy:save', async (_e, payload) => {
    const p = await setProxySettings(payload ?? {});
    const rule = await applyProxy();
    if (gameView) gameView.webContents.reload();
    log('app', 'info', p.enabled && p.host ? `proxy saved — reloading through ${p.host}:${p.port}` : 'proxy disabled — direct connection');
    return { config: publicConfig(), rule };
  });

  ipcMain.handle('auth:save', async (_e, payload = {}) => {
    const autoLogin = Boolean(payload.autoLogin);
    const username = String(payload.username ?? '').slice(0, 64);
    patchConfig({ game: { autoLogin, username } });
    if (typeof payload.password === 'string' && payload.password) {
      await setCredentials(username, payload.password);
    }
    log('app', 'info', `auto-login ${autoLogin ? 'on' : 'off'}${username ? ` for ${username}` : ''}`);
    return { config: publicConfig() };
  });
}

async function selfTest() {
  const checks = {};

  // Clear persisted login state so each self-test starts logged out.
  patchConfig({ game: { autoLogin: false } });
  await session.fromPartition('persist:lostpower').clearStorageData({ storages: ['cookies'] });
  gameView.webContents.reload();
  await new Promise((r) => setTimeout(r, 1500));

  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    const state = await gameView.webContents
      .executeJavaScript('document.readyState + "|" + location.href + "|" + !!document.querySelector(`[data-testid="input-loginUsername"]`)')
      .catch(() => '');
    if (state.startsWith('complete|https://lostpower.com') && state.endsWith('|true')) {
      checks.game = state;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  checks.game ??= 'timeout';

  checks.panel = await win.webContents
    .executeJavaScript('!!document.querySelector("#panel") && !!window.bot')
    .catch(() => false);
  checks.proxyUi = await win.webContents
    .executeJavaScript('["#proxyToggle","#proxyHost","#proxyPort","#proxyUser","#proxyPass","#saveProxy"].every((s) => !!document.querySelector(s))')
    .catch(() => false);

  patchConfig({ features: { blackjack: { enabled: true } } });
  resetConfigCache();
  checks.persist = loadConfig().features.blackjack.enabled === true;
  checks.betPatch =
    sanitizePatch({ features: { blackjack: { bet: '100' } } }).features.blackjack.bet === 100;

  // Round-trip the real IPC path the panel uses for the wager preset.
  await win.webContents
    .executeJavaScript(`window.bot.patch({ features: { blackjack: { bet: "50" } } })`)
    .catch(() => null);
  checks.betRoundTrip = loadConfig().features.blackjack.bet === 50;
  patchConfig({ features: { blackjack: { bet: 10 } } });
  patchConfig({ features: { blackjack: { enabled: false } } });

  checks.log = logRing.length > 0;
  checks.configPath = configPath();

  // Feature cards start collapsed; the disclosure opens and closes the settings.
  checks.fold = await win.webContents
    .executeJavaScript(`(() => {
      const card = () => document.querySelector('#features .feature');
      const settings = () => getComputedStyle(card().querySelector('.settings')).display;
      const closedStart = settings() === 'none';
      card().querySelector('.disclosure').click();
      const opened = settings() !== 'none' && card().classList.contains('open');
      card().querySelector('.disclosure').click();
      const closedAgain = settings() === 'none';
      return closedStart && opened && closedAgain;
    })()`)
    .catch(() => false);

  checks.accountFold = await win.webContents
    .executeJavaScript(`(() => {
      const body = () => getComputedStyle(document.querySelector('#acctBody')).display;
      const closedStart = body() === 'none';
      document.querySelector('#acctToggle').click();
      const opened = body() !== 'none' && document.querySelector('#account').classList.contains('open');
      document.querySelector('#acctToggle').click();
      return closedStart && opened && body() === 'none';
    })()`)
    .catch(() => false);

  checks.sorted = await win.webContents
    .executeJavaScript(`(() => {
      const names = [...document.querySelectorAll('#features .name')].map((n) => n.textContent);
      return JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b)));
    })()`)
    .catch(() => false);

  checks.authClear = await win.webContents
    .executeJavaScript(`(async () => {
      if (!document.querySelector('#clearAuth')) return false;
      await window.bot.saveAuth({ autoLogin: true, username: 'selftest', password: 'x' });
      const r = await window.bot.clearAuth();
      return !r.config.game.username && !r.config.game.hasPassword && !r.config.game.autoLogin;
    })()`)
    .catch(() => false);

  await win.webContents.executeJavaScript('window.bot.popoutLog()').catch(() => null);
  checks.logPopout = false;
  for (let i = 0; i < 20 && !checks.logPopout; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    const extra = BrowserWindow.getAllWindows().find((w) => w !== win);
    if (!extra) continue;
    const lines = await extra.webContents
      .executeJavaScript('document.querySelectorAll("#log li").length')
      .catch(() => 0);
    if (lines > 0) checks.logPopout = true;
  }
  for (const w of BrowserWindow.getAllWindows()) if (w !== win) w.close();

  // A feature that is toggled off must not start or move the game view.
  await startFeature('blackjack');
  checks.offGuard = !running.has('blackjack');
  checks.shortcut = globalShortcut.isRegistered('Control+Shift+X');

  patchConfig({ features: { blackjack: { enabled: true } } });
  await startFeature('blackjack');
  checks.started = running.has('blackjack');
  killAll('selftest');
  checks.killed = !running.has('blackjack') && status.state === 'idle';
  stopFeature('blackjack');
  checks.stopped = !running.has('blackjack');
  patchConfig({ features: { blackjack: { enabled: false } } });
  checks.shortcut = globalShortcut.isRegistered('Control+Shift+X');

  win.webContents.send('stats', {
    hands: 3, credits: 825, pl: 15, decisions: 43,
    tokens: { prompt: 40000, completion: 18234, total: 58234 },
    llm: 43, agree: 41,
    last: { hand: 'K♠ 9♦ (19) vs 3♥', action: 'STAND', source: 'llm', result: 'WIN +10' },
  });
  await new Promise((r) => setTimeout(r, 300));
  checks.statsRender = await win.webContents
    .executeJavaScript('document.querySelector("#st-tokens")?.textContent')
    .catch(() => null);
  checks.agreeRender = await win.webContents
    .executeJavaScript('document.querySelector("#st-agree")?.textContent')
    .catch(() => null);

  if (process.env.LPC_USER && process.env.LPC_PASS) {
    await setCredentials(process.env.LPC_USER, process.env.LPC_PASS);
    patchConfig({ game: { autoLogin: true } });
    gameView.webContents.reload();
    const end = Date.now() + 25_000;
    let signedIn = false;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 500));
      const hash = await gameView.webContents.executeJavaScript('location.hash').catch(() => '');
      if (hash && !hash.includes('login')) { signedIn = true; break; }
    }
    checks.autoLogin = signedIn;
    checks.secretHidden = !('passwordEnc' in publicConfig().game);
    patchConfig({ game: { autoLogin: false } });
  }

  // Feature wiring: every feature must expose a serializable view and its own reader.
  const vp = features.find((f) => f.id === 'video-poker');
  const gym = features.find((f) => f.id === 'gym');
  const vpView = featureView(loadConfig()).find((f) => f.id === 'video-poker');
  checks.vpReader = typeof vp?.read === 'function';
  checks.gymReader = typeof gym?.read === 'function';
  checks.vpView = !('read' in vpView) && !('start' in vpView);

  if (process.env.LPC_USER && checks.autoLogin) {
    patchConfig({ features: { gym: { enabled: true, dryRun: true } } });
    await startFeature('gym');
    await new Promise((r) => setTimeout(r, 8000));
    checks.gymOpen = logRing.some((e) => /gym: open/.test(e.msg));
    checks.gymDry = logRing.some((e) => /gym: finished — dry run/.test(e.msg));
    killAll('selftest');
    patchConfig({ features: { gym: { enabled: false } } });

    patchConfig({ features: { 'video-poker': { enabled: true } } });
    await startFeature('video-poker');
    await new Promise((r) => setTimeout(r, 20_000));
    checks.vpOpen = logRing.some((e) => /video poker: table open/.test(e.msg));
    checks.vpDry = logRing.some((e) => /video poker: finished — dry run/.test(e.msg));
    checks.vpBadVariant = logRing.some((e) => /variant stayed undefined/.test(e.msg));
    checks.vpBlocked = logRing.some((e) => /travel required/i.test(e.msg));
    killAll('selftest');
    patchConfig({ features: { 'video-poker': { enabled: false } } });
  }

  if (process.argv.includes('--shot')) {
    await win.webContents.executeJavaScript('document.querySelector("#acctToggle").click()').catch(() => {});
    const shot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(process.cwd(), 'recon', 'panel.png'), shot.toPNG());
    checks.shot = 'recon/panel.png';
  }

  // Proxy wiring: the game session must resolve through a configured proxy, and the panel must
  // never receive the proxy password.
  {
    const s = session.fromPartition('persist:lostpower');
    const saved = structuredClone(loadConfig().proxy);
    await s.setProxy({ proxyRules: 'http://127.0.0.1:9', proxyBypassRules: '<-loopback>' });
    const resolved = await s.resolveProxy('https://lostpower.com');
    checks.proxyResolve = /127\.0\.0\.1:9/.test(resolved);
    await setProxySettings({ ...saved, password: undefined });
    await applyProxy();
    checks.proxyHidden = !('passwordEnc' in publicConfig().proxy);
  }

  const ok =
    checks.game.startsWith('complete|') && checks.panel && checks.persist && checks.betPatch && checks.betRoundTrip &&
    checks.started && checks.stopped && checks.killed && checks.shortcut &&
    checks.statsRender === '58.2k' && checks.agreeRender === '95%' &&
    (checks.autoLogin === undefined || checks.autoLogin) &&
    (checks.secretHidden === undefined || checks.secretHidden) &&
    checks.vpReader && checks.vpView && checks.gymReader && checks.fold && checks.accountFold && checks.sorted && checks.authClear && checks.offGuard && checks.logPopout &&
    checks.proxyResolve && checks.proxyHidden && checks.proxyUi &&
    (checks.gymOpen === undefined || (checks.gymOpen && checks.gymDry)) &&
    (checks.vpOpen === undefined || checks.vpBlocked || (checks.vpOpen && checks.vpDry && !checks.vpBadVariant));
  console.log('SELFTEST ' + JSON.stringify({ ok, ...checks }));
  if (!ok) console.log('SELFTEST_LOG ' + JSON.stringify(logRing.slice(-15).map((e) => `${e.level} ${e.msg}`)));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  log('app', 'info', 'ready');

  const registered = globalShortcut.register('Control+Shift+X', () => killAll('ctrl+shift+x'));
  if (!registered) log('app', 'warn', 'Ctrl+Shift+X already taken by another app');

  if (SELF_TEST) await selfTest();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
