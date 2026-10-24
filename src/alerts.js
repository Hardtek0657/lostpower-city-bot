import { loadConfig, getWebhook } from './config.js';

const COLORS = {
  gameAlert: 0xff4d4f,
  gameMail: 0x4d9bff,
  gym: 0x4dff88,
  gambling: 0xffc53d,
  session: 0x9aa7b1,
  test: 0x4d9bff,
};

// Gambling hands settle every couple of seconds; keep the webhook under Discord's rate limit.
const MIN_GAP = { gambling: 8000 };

let chain = Promise.resolve();
const lastSentAt = new Map();

const KINDS = {
  gameAlert: 'onAlerts',
  gameMail: 'onMail',
  gym: 'onGym',
  gambling: 'onGambling',
  session: 'onSession',
};

export function kindAllowed(kind) {
  const a = loadConfig().alerts ?? {};
  if (!a.enabled) return false;
  const key = KINDS[kind];
  return key ? Boolean(a[key]) : false;
}

/** Why a notification of this kind would be skipped, or null when it can be sent. */
export function whyNot(kind) {
  const a = loadConfig().alerts ?? {};
  if (!a.enabled) return 'alerts are off';
  const key = KINDS[kind];
  if (!key) return `unknown kind "${kind}"`;
  if (!a[key]) return `${kind} alerts are muted`;
  if (!a.webhookEnc) return 'no webhook saved';
  return null;
}

/** Queue a Discord notification. Returns false when the kind is disabled or nothing is configured. */
export async function notify(kind, title, body) {
  if (!kindAllowed(kind)) return false;
  const gap = MIN_GAP[kind] ?? 0;
  if (gap && Date.now() - (lastSentAt.get(kind) ?? 0) < gap) return false;
  lastSentAt.set(kind, Date.now());
  try {
    return await post(COLORS[kind] ?? 0x9aa7b1, title, body);
  } catch {
    return false;
  }
}

/** Send a test message regardless of the enabled toggle (the webhook must still be set). */
export async function sendTest() {
  try {
    return await post(COLORS.test, 'LostPower Bot test', 'This webhook is reachable. Alerts will arrive here.');
  } catch {
    return false;
  }
}

async function post(color, title, body) {
  const url = await getWebhook();
  if (!url) return false;
  const payload = {
    username: 'LostPower Bot',
    embeds: [{
      title: String(title ?? 'LostPower Bot').slice(0, 256),
      description: String(body ?? '').slice(0, 3800),
      color,
      timestamp: new Date().toISOString(),
    }],
  };
  let ok = false;
  chain = chain
    .then(async () => { ok = await send(url, payload); })
    .catch(() => {});
  await chain;
  return ok;
}

async function send(url, payload) {
  const body = JSON.stringify(payload);
  const opts = { method: 'POST', headers: { 'content-type': 'application/json' }, body };
  let res = await fetch(url, opts);
  if (res.status === 429) {
    const info = await res.json().catch(() => ({}));
    const wait = Math.min(10, Number(info.retry_after ?? 1)) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    res = await fetch(url, opts);
  }
  return res.ok;
}
