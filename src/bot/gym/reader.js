import { SEL } from './selectors.js';

/**
 * Runs inside the game page. Self-contained: it may not reference module scope.
 */
function extract(sel) {
  const q = (s) => document.querySelector(s);
  const text = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const num = (s) => {
    const m = String(s ?? '').match(/(\d[\d,]*)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  const meter = q(sel.gym.playerEnergy);
  const meterText = text(meter);
  const pct = meterText.match(/(\d+)%/);
  const pair = meterText.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  const focus = ['strength', 'speed', 'guard'].find(
    (k) => q(sel.gym.focus[k])?.classList.contains('is-selected'),
  ) ?? null;
  const turnsText = text(q(sel.gym.turns));
  const turns = turnsText.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);

  return {
    route: location.hash,
    login: Boolean(q(sel.login.user)),
    page: Boolean(q(sel.gym.page)),
    restricted: /reserved for active LPC Supporters/i.test(document.body.innerText),
    status: text(q(sel.gym.status)),
    preview: text(q(sel.gym.preview)),
    impact: text(q(sel.gym.impact)),
    potential: text(q(sel.gym.potential)),
    trainLabel: text(q(sel.gym.train)),
    trainDisabled: Boolean(q(sel.gym.train)?.disabled),
    sliderValue: q(sel.gym.energy)?.value ?? null,
    energy: {
      percent: pct ? Number(pct[1]) : null,
      current: pair ? num(pair[1]) : null,
      max: pair ? num(pair[2]) : null,
    },
    turns: { current: turns ? num(turns[1]) : null, max: turns ? num(turns[2]) : null },
    focus,
    seenAt: Date.now(),
  };
}

export const EXTRACT_JS = `(${extract.toString()})(${JSON.stringify(SEL)})`;

/** Read the gym page from a webContents. */
export async function readGym(webContents) {
  return webContents.executeJavaScript(EXTRACT_JS);
}
