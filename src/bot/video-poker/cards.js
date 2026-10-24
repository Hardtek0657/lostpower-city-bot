// Card encoding: (rank - 2) * 4 + suit, rank 2..14, suit 0..3.
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const rankOf = (c) => (c >> 2) + 2;
export const suitOf = (c) => c & 3;
export const cardText = (c) => `${RANK_CHARS[rankOf(c) - 2]}${SUITS[suitOf(c)]}`;

export function parseCard(text) {
  const m = String(text).match(/^(10|[2-9JQKA])\s*([♠♥♦♣])/);
  if (!m) return null;
  const rank = m[1] === '10' ? 10 : m[1] === 'J' ? 11 : m[1] === 'Q' ? 12 : m[1] === 'K' ? 13 : m[1] === 'A' ? 14 : Number(m[1]);
  return (rank - 2) * 4 + SUITS.indexOf(m[2]);
}

export const VARIANTS = ['jacks-or-better', 'bonus-poker', 'deuces-wild'];

export const VARIANT_LABEL = {
  'jacks-or-better': 'Jacks or Better 9/6',
  'bonus-poker': 'Bonus Poker 8/5',
  'deuces-wild': 'Deuces Wild',
};

// Multipliers per credit wagered, taken from the live paytables.
export const PAYTABLES = {
  'jacks-or-better': {
    royal: 800, straight_flush: 50, four: 25, full_house: 9, flush: 6,
    straight: 4, three: 3, two_pair: 2, jacks: 1,
  },
  'bonus-poker': {
    royal: 800, straight_flush: 50, four_aces: 80, four_low: 40, four_high: 25,
    full_house: 8, flush: 5, straight: 4, three: 3, two_pair: 2, jacks: 1,
  },
  'deuces-wild': {
    natural_royal: 800, four_deuces: 100, wild_royal: 20, five_kind: 12,
    straight_flush: 8, four: 4, full_house: 3, flush: 2, straight: 2, three: 1,
  },
};

const DEUCE = 2;
const cnt = new Uint8Array(15);

function flushOf(cards) {
  const s = suitOf(cards[0]);
  for (let i = 1; i < 5; i += 1) if (suitOf(cards[i]) !== s) return false;
  return true;
}

/** Every rank present in `cnt` fits one 5-card straight window (aces low allowed). */
function naturalsFitStraight() {
  for (let s = 2; s <= 10; s += 1) {
    let ok = true;
    for (let r = 2; r <= 14; r += 1) {
      if (cnt[r] === 0) continue;
      if (r < s || r > s + 4) { ok = false; break; }
    }
    if (ok) return true;
  }
  for (let r = 2; r <= 14; r += 1) {
    if (cnt[r] === 0) continue;
    if (r !== 14 && r !== 2 && r !== 3 && r !== 4 && r !== 5) return false;
  }
  return true;
}

function naturalKey(cards) {
  cnt.fill(0);
  let distinct = 0;
  let min = 99;
  let max = 0;
  let quad = -1;
  let trips = -1;
  let pairs = 0;
  let pairRank = -1;

  for (let i = 0; i < 5; i += 1) {
    const r = rankOf(cards[i]);
    if (cnt[r] === 0) {
      distinct += 1;
      if (r < min) min = r;
      if (r > max) max = r;
    }
    cnt[r] += 1;
  }
  for (let r = 2; r <= 14; r += 1) {
    if (cnt[r] === 4) quad = r;
    else if (cnt[r] === 3) trips = r;
    else if (cnt[r] === 2) { pairs += 1; pairRank = r; }
  }

  const flush = flushOf(cards);
  const straight = distinct === 5 && naturalsFitStraight();

  if (flush && straight && min === 10) return 'royal';
  if (flush && straight) return 'straight_flush';
  if (quad >= 0) return 'four';
  if (trips >= 0 && pairs >= 1) return 'full_house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (trips >= 0) return 'three';
  if (pairs >= 2) return 'two_pair';
  if (pairs === 1) return pairRank >= 11 ? 'jacks' : 'low_pair';
  return 'none';
}

function quadRank(cards) {
  for (let i = 0; i < 5; i += 1) {
    const r = rankOf(cards[i]);
    let n = 0;
    for (let j = 0; j < 5; j += 1) if (rankOf(cards[j]) === r) n += 1;
    if (n === 4) return r;
  }
  return -1;
}

function deucesKey(cards) {
  let wilds = 0;
  for (let i = 0; i < 5; i += 1) if (rankOf(cards[i]) === DEUCE) wilds += 1;
  const nat = 5 - wilds;

  if (wilds === 4) return 'four_deuces';

  cnt.fill(0);
  let distinct = 0;
  let min = 99;
  let max = 0;
  let sameSuit = true;
  let s0 = -1;

  for (let i = 0; i < 5; i += 1) {
    const c = cards[i];
    const r = rankOf(c);
    if (r === DEUCE) continue;
    if (s0 < 0) s0 = suitOf(c);
    else if (suitOf(c) !== s0) sameSuit = false;
    if (cnt[r] === 0) {
      distinct += 1;
      if (r < min) min = r;
      if (r > max) max = r;
    }
    cnt[r] += 1;
  }

  if (wilds === 0) {
    const key = naturalKey(cards);
    if (key === 'royal') return 'natural_royal';
    return key === 'two_pair' || key === 'jacks' || key === 'low_pair' ? 'none' : key;
  }

  let five = false;
  let four = false;
  let three = false;
  for (let r = 2; r <= 14; r += 1) {
    if (r === DEUCE) continue;
    if (cnt[r] + wilds >= 5) five = true;
    if (cnt[r] + wilds >= 4) four = true;
    if (cnt[r] + wilds >= 3) three = true;
  }

  if (sameSuit && distinct === nat && nat >= 1 && min >= 10 && max <= 14) return 'wild_royal';
  if (five) return 'five_kind';

  const straight = distinct === nat && nat >= 1 && naturalsFitStraight();
  if (sameSuit && straight) return 'straight_flush';
  if (four) return 'four';

  let a = -1;
  let b = -1;
  let seen = 0;
  for (let r = 2; r <= 14; r += 1) {
    if (r === DEUCE || cnt[r] === 0) continue;
    seen += 1;
    if (a < 0) a = r;
    else b = r;
  }
  if (seen === 2 && cnt[a] + cnt[b] + wilds === 5) {
    for (let x = 0; x <= wilds; x += 1) {
      if ((cnt[a] + x >= 3 && cnt[b] + (wilds - x) >= 2)
        || (cnt[b] + x >= 3 && cnt[a] + (wilds - x) >= 2)) return 'full_house';
    }
  }

  if (sameSuit) return 'flush';
  if (straight) return 'straight';
  if (three) return 'three';
  return 'none';
}

export function evaluate(cards, variant) {
  if (cards.length !== 5) throw new Error(`evaluate needs 5 cards, got ${cards.length}`);
  if (variant === 'deuces-wild') return deucesKey(cards);
  const key = naturalKey(cards);
  if (variant !== 'bonus-poker' || key !== 'four') return key;
  const q = quadRank(cards);
  return q === 14 ? 'four_aces' : q >= 2 && q <= 4 ? 'four_low' : 'four_high';
}

export function payout(cards, variant) {
  const table = PAYTABLES[variant];
  if (!table) throw new Error(`unknown variant ${variant}`);
  return table[evaluate(cards, variant)] ?? 0;
}
