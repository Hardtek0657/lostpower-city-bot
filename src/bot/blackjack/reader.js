import { SEL } from './selectors.js';

// Runs in the game page without module scope; returns TableState or { phase: 'unknown', reason }.
function extract(sel) {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const text = (el) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const num = (s) => {
    const m = String(s).match(/(\d[\d,]*)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  const root = q(sel.table.modal);
  if (!root) return { phase: 'unknown', reason: 'no-table-modal' };

  // Credits and rules live in the modal header/footer, outside the blackjack section.
  const credits = num(text(q(sel.table.credits)));
  const idleEl = q(sel.table.idle, root);
  const resultEl = q(sel.table.result, root);
  const dealEl = q(sel.table.deal, root);

  const parseCard = (el) => {
    const label = el.getAttribute('aria-label') ?? '';
    const m = label.match(/^(.+?)\s*([♠♥♦♣])$/u);
    if (!m) return { rank: '?', suit: '?', id: el.getAttribute('data-testid') };
    return { rank: m[1].trim(), suit: m[2], id: el.getAttribute('data-testid') };
  };

  const value = (rank) => {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    const n = Number(rank);
    return Number.isFinite(n) ? n : 0;
  };

  const totals = (cards) => {
    let sum = 0;
    let aces = 0;
    for (const c of cards) {
      sum += value(c.rank);
      if (c.rank === 'A') aces += 1;
    }
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces -= 1;
    }
    return { total: sum, soft: aces > 0 };
  };

  const dealerCards = qa(`[data-testid^="${sel.card.dealerPrefix}"]`, root)
    .filter((el) => el.getAttribute('data-testid') !== 'card-blackjackDealer-hole')
    .sort((a, b) =>
      Number(a.getAttribute('data-testid').split('-').pop()) -
      Number(b.getAttribute('data-testid').split('-').pop()))
    .map(parseCard);

  const hands = qa(`[data-testid^="${sel.handPrefix}"]`, root).map((el) => {
    const idx = Number(el.getAttribute('data-testid').slice(sel.handPrefix.length));
    const cards = qa(`[data-testid^="${sel.card.playerPrefix}${idx}-"]`, root)
      .sort((a, b) =>
        Number(a.getAttribute('data-testid').split('-').pop()) -
        Number(b.getAttribute('data-testid').split('-').pop()))
      .map(parseCard);
    const t = totals(cards);
    return {
      index: idx,
      cards,
      ...t,
      active: /PLAY THIS HAND/i.test(el.innerText),
      wager: num((el.innerText.match(/([\d,]+)\s*CR\s*WAGER/i) ?? [])[1] ?? ''),
    };
  });

  // DEAL remains after settlement; the caller distinguishes first-deal from next-hand readiness.
  const resultText = text(resultEl);
  // A container with no enabled buttons is the hand-over state, not "your move".
  const enabledActions = Object.entries(sel.table.action)
    .filter(([, selector]) => {
      const b = q(selector, root);
      return b && !b.disabled;
    })
    .map(([key]) => key);

  const phase = enabledActions.length ? 'in_play' : dealEl || idleEl ? 'ready' : 'unknown';

  return {
    phase,
    credits,
    bet: num(text(dealEl)),
    dealer: {
      cards: dealerCards,
      holeHidden: Boolean(q(sel.card.hole, root)),
      ...totals(dealerCards),
    },
    hands: hands.sort((a, b) => a.index - b.index),
    actions: enabledActions,
    result: resultText || null,
    rules: text(q(sel.table.rules)) || null,
    seenAt: Date.now(),
  };
}

export const EXTRACT_JS = `(${extract.toString()})(${JSON.stringify(SEL)})`;

export async function readTable(webContents) {
  return webContents.executeJavaScript(EXTRACT_JS);
}
