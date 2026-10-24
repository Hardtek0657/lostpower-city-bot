import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { features } from './bot/registry.js';

const featureDefaults = Object.fromEntries(
  features.map((f) => [
    f.id,
    { enabled: false, ...Object.fromEntries(f.settings.map((s) => [s.key, s.default])) },
  ]),
);

const DEFAULTS = {
  router: { baseUrl: 'http://127.0.0.1:20128/v1', apiKeyEnc: '' },
  models: { decision: 'cx/gpt-6-luna(max)', vision: 'ds/deepseek-v4-flash-vision-exp' },
  game: { url: 'https://lostpower.com/', autoLogin: false, username: '' },
  proxy: { enabled: false, protocol: 'http', host: '', port: 0, username: '', passwordEnc: '' },
  alerts: {
    enabled: false,
    webhookEnc: '',
    pollSeconds: 60,
    onAlerts: true,
    onMail: true,
    onGym: true,
    onGambling: true,
    onSession: true,
    lastSeen: { alerts: 0, mail: 0, alertId: null },
  },
  features: featureDefaults,
};

let cached = null;

export const configPath = () => path.join(app.getPath('userData'), 'config.json');

function merge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = merge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function loadConfig() {
  if (cached) return cached;
  try {
    cached = merge(DEFAULTS, JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {
    cached = structuredClone(DEFAULTS);
  }
  return cached;
}

export function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cached, null, 2));
}

export function patchConfig(patch) {
  cached = merge(loadConfig(), patch);
  saveConfig();
  return cached;
}

/** Drop the secrets before anything reaches the renderer. */
export function publicConfig() {
  const c = loadConfig();
  const { passwordEnc, ...game } = c.game;
  const { passwordEnc: proxyPass, ...proxy } = c.proxy;
  const { webhookEnc, ...alerts } = c.alerts;
  return {
    ...c,
    game: { ...game, hasPassword: Boolean(passwordEnc) },
    proxy: { ...proxy, hasPassword: Boolean(proxyPass) },
    alerts: { ...alerts, hasWebhook: Boolean(webhookEnc) },
    router: { baseUrl: c.router.baseUrl, hasApiKey: Boolean(c.router.apiKeyEnc) },
  };
}

export async function setCredentials(user, pass) {
  const c = loadConfig();
  c.game.username = String(user ?? '').slice(0, 64);
  c.game.passwordEnc = '';
  if (pass) {
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        c.game.passwordEnc = (await safeStorage.encryptStringAsync(pass)).toString('base64');
      }
    } catch {
      c.game.passwordEnc = '';
    }
  }
  saveConfig();
}

export function clearCredentials() {
  const c = loadConfig();
  c.game.username = '';
  c.game.passwordEnc = '';
  c.game.autoLogin = false;
  saveConfig();
}

async function decryptValue(enc) {
  const out = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'));
  return typeof out === 'string'
    ? { value: out, reencrypt: false }
    : { value: out?.result ?? '', reencrypt: Boolean(out?.shouldReEncrypt) };
}

export async function getCredentials() {
  const c = loadConfig();
  const enc = c.game.passwordEnc;
  if (!enc) return { user: c.game.username, pass: '' };
  try {
    const { value, reencrypt } = await decryptValue(enc);
    if (reencrypt && value) await setCredentials(c.game.username, value);
    return { user: c.game.username, pass: value };
  } catch {
    return { user: c.game.username, pass: '' };
  }
}

export async function setProxySettings({ enabled, protocol, host, port, username, password }) {
  const c = loadConfig();
  c.proxy.enabled = Boolean(enabled);
  c.proxy.protocol = ['http', 'https', 'socks5'].includes(protocol) ? protocol : 'http';
  c.proxy.host = String(host ?? '').trim().slice(0, 255);
  const n = Number(port);
  c.proxy.port = Number.isFinite(n) ? Math.min(65535, Math.max(0, Math.round(n))) : 0;
  c.proxy.username = String(username ?? '').trim().slice(0, 128);
  if (password !== undefined) {
    c.proxy.passwordEnc = '';
    if (password) {
      try {
        if (await safeStorage.isAsyncEncryptionAvailable()) {
          c.proxy.passwordEnc = (await safeStorage.encryptStringAsync(String(password))).toString('base64');
        }
      } catch {
        c.proxy.passwordEnc = '';
      }
    }
  }
  saveConfig();
  return c.proxy;
}

export function clearProxyAuth() {
  const c = loadConfig();
  c.proxy.username = '';
  c.proxy.passwordEnc = '';
  saveConfig();
  return c.proxy;
}

export async function getProxyPassword() {
  const enc = loadConfig().proxy.passwordEnc;
  if (!enc) return '';
  try {
    const { value, reencrypt } = await decryptValue(enc);
    if (reencrypt && value) {
      const c = loadConfig();
      c.proxy.passwordEnc = (await safeStorage.encryptStringAsync(value)).toString('base64');
      saveConfig();
    }
    return value;
  } catch {
    return '';
  }
}

const DISCORD_HOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+(?:\?\S*)?\/?$/i;
const LOOPBACK_HOOK = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/\S*$/i;

export async function setAlertSettings({
  enabled, pollSeconds, onAlerts, onMail, onGym, onGambling, onSession, webhook,
}) {
  const c = loadConfig();
  const a = c.alerts;
  if (enabled !== undefined) a.enabled = Boolean(enabled);
  if (pollSeconds !== undefined) {
    const n = Number(pollSeconds);
    if (!Number.isFinite(n)) throw new Error('poll interval must be a number');
    a.pollSeconds = Math.min(600, Math.max(15, Math.round(n)));
  }
  if (onAlerts !== undefined) a.onAlerts = Boolean(onAlerts);
  if (onMail !== undefined) a.onMail = Boolean(onMail);
  if (onGym !== undefined) a.onGym = Boolean(onGym);
  if (onGambling !== undefined) a.onGambling = Boolean(onGambling);
  if (onSession !== undefined) a.onSession = Boolean(onSession);
  if (webhook !== undefined) {
    const url = String(webhook ?? '').trim();
    if (url && !DISCORD_HOOK.test(url) && !LOOPBACK_HOOK.test(url)) {
      throw new Error('webhook must be a Discord webhook URL');
    }
    a.webhookEnc = '';
    if (url) {
      try {
        if (await safeStorage.isAsyncEncryptionAvailable()) {
          a.webhookEnc = (await safeStorage.encryptStringAsync(url)).toString('base64');
        }
      } catch {
        a.webhookEnc = '';
      }
    }
  }
  saveConfig();
  return { ok: true, enabled: a.enabled };
}

export async function getWebhook() {
  const enc = loadConfig().alerts.webhookEnc;
  if (!enc) return '';
  try {
    const { value } = await decryptValue(enc);
    return value;
  } catch {
    return '';
  }
}

export async function setApiKey(key) {
  const c = loadConfig();
  c.router.apiKeyEnc = '';
  if (key) {
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        c.router.apiKeyEnc = (await safeStorage.encryptStringAsync(key)).toString('base64');
      }
    } catch {
      c.router.apiKeyEnc = '';
    }
  }
  saveConfig();
}

export async function getApiKey() {
  const enc = loadConfig().router.apiKeyEnc;
  if (!enc) return '';
  try {
    const { value, reencrypt } = await decryptValue(enc);
    if (reencrypt && value) await setApiKey(value);
    return value;
  } catch {
    return '';
  }
}

/** Test hook: forget the cache so a fresh read hits disk. */
export function resetConfigCache() {
  cached = null;
}
