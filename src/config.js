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
  return {
    ...c,
    game: { ...game, hasPassword: Boolean(passwordEnc) },
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
