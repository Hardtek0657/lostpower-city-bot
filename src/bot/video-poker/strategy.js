import { PAYTABLES, evaluate } from './cards.js';

// Average payouts over all draws from the 47 remaining cards: 32 hold patterns, 2,598,960 hands.
export function bestHold(cards, variant) {
  const table = PAYTABLES[variant];
  if (!table) throw new Error(`unknown variant ${variant}`);
  if (!Array.isArray(cards) || cards.length !== 5) throw new Error('bestHold needs 5 cards');

  const used = new Uint8Array(52);
  for (const c of cards) {
    if (c < 0 || c > 51) throw new Error(`bad card ${c}`);
    if (used[c]) throw new Error(`duplicate card ${c}`);
    used[c] = 1;
  }

  const deck = new Int32Array(47);
  let n = 0;
  for (let c = 0; c < 52; c += 1) if (!used[c]) deck[n++] = c;

  const hand = new Array(5).fill(0);
  let bestMask = 0;
  let bestEv = -1;

  for (let mask = 0; mask < 32; mask += 1) {
    let held = 0;
    for (let i = 0; i < 5; i += 1) if (mask & (1 << i)) hand[held++] = cards[i];
    const draw = 5 - held;
    let sum = 0;
    let count = 0;

    const rec = (start, depth) => {
      if (depth === draw) {
        sum += table[evaluate(hand, variant)] ?? 0;
        count += 1;
        return;
      }
      const slot = held + depth;
      for (let i = start; i < 47; i += 1) {
        hand[slot] = deck[i];
        rec(i + 1, depth + 1);
      }
    };
    rec(0, 0);

    const ev = sum / count;
    if (ev > bestEv) {
      bestEv = ev;
      bestMask = mask;
    }
  }

  return {
    hold: [0, 1, 2, 3, 4].map((i) => Boolean(bestMask & (1 << i))),
    mask: bestMask,
    ev: bestEv,
  };
}
