// Six-deck, S17, DAS, no surrender. Returns an action guaranteed to be in state.actions.
const value = (rank) => {
  if (rank === 'A') return 11;
  if (rank === '10' || rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  const n = Number(rank);
  if (!Number.isFinite(n) || n < 2 || n > 10) throw new Error(`strategy: bad card rank "${rank}"`);
  return n;
};

function totals(cards) {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += value(c.rank);
    if (c.rank === 'A') aces += 1;
  }
  while (sum > 21 && aces) {
    sum -= 10;
    aces -= 1;
  }
  return { total: sum, soft: aces > 0 };
}

const ORDER = ['stand', 'hit', 'double', 'split', 'forfeit'];

function choose(hand, up, total, soft, actions) {
  const can = (a) => actions.includes(a);

  const pick = (action, why) => {
    if (can(action)) return { action, reason: why, source: 'table' };
    if (action === 'double') {
      return pick(soft && total === 18 ? 'stand' : 'hit', `${why} — no double`);
    }
    if (action === 'split') {
      // Split illegal: re-decide the hand as an ordinary total.
      return choose(hand, up, total, soft, actions.filter((a) => a !== 'split'));
    }
    const alt = ORDER.find(can);
    if (!alt) throw new Error('strategy: no usable legal action');
    return { action: alt, reason: `${why} — forced ${alt}`, source: 'table' };
  };

  const pair = hand.cards.length === 2 && value(hand.cards[0].rank) === value(hand.cards[1].rank);
  const pairRank = pair ? value(hand.cards[0].rank) : 0;

  if (pair && can('split')) {
    if (pairRank === 11) return pick('split', 'A,A');
    if (pairRank === 10) return pick('stand', '10,10');
    if (pairRank === 9) {
      return up === 7 || up === 10 || up === 11 ? pick('stand', '9,9 vs 7/10/A') : pick('split', '9,9');
    }
    if (pairRank === 8) return pick('split', '8,8');
    if (pairRank === 7) return up <= 7 ? pick('split', '7,7 vs 2-7') : pick('hit', '7,7 vs 8+');
    if (pairRank === 6) return up <= 6 ? pick('split', '6,6 vs 2-6') : pick('hit', '6,6 vs 7+');
    if (pairRank === 4) return up === 5 || up === 6 ? pick('split', '4,4 vs 5-6') : pick('hit', '4,4');
    if (pairRank === 3 || pairRank === 2) return up <= 7 ? pick('split', 'low pair vs 2-7') : pick('hit', 'low pair vs 8+');
    // 5,5 is never split: fall through as hard 10.
  }

  if (soft) {
    if (total === 12) return pick('hit', 'A,A without split');
    if (total >= 19) return pick('stand', 'soft 19+');
    if (total === 18) {
      if (up >= 3 && up <= 6) return pick('double', 'soft 18 vs 3-6');
      if (up === 2 || up === 7 || up === 8) return pick('stand', 'soft 18 vs 2/7/8');
      return pick('hit', 'soft 18 vs 9+');
    }
    if (total === 17) return up >= 3 && up <= 6 ? pick('double', 'soft 17 vs 3-6') : pick('hit', 'soft 17');
    if (total === 16 || total === 15) {
      return up >= 4 && up <= 6 ? pick('double', 'soft 15/16 vs 4-6') : pick('hit', 'soft 15/16');
    }
    return up >= 5 && up <= 6 ? pick('double', 'soft 13/14 vs 5-6') : pick('hit', 'soft 13/14');
  }

  if (total >= 17) return pick('stand', 'hard 17+');
  if (total >= 13) return up <= 6 ? pick('stand', 'stiff vs 2-6') : pick('hit', 'stiff vs 7+');
  if (total === 12) return up >= 4 && up <= 6 ? pick('stand', '12 vs 4-6') : pick('hit', '12 vs 2-3/7+');
  if (total === 11) return up === 11 ? pick('hit', '11 vs A') : pick('double', '11 vs 2-10');
  if (total === 10) return up <= 9 ? pick('double', '10 vs 2-9') : pick('hit', '10 vs 10/A');
  if (total === 9) return up >= 3 && up <= 6 ? pick('double', '9 vs 3-6') : pick('hit', '9');
  return pick('hit', 'hard 8 or less');
}

export function basicStrategy(state) {
  const upCard = state?.dealer?.cards?.[0];
  if (!upCard?.rank) throw new Error('strategy: missing dealer upcard');

  const actions = state?.actions;
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('strategy: no legal actions');

  const hand = state.hands?.find((h) => h.active) ?? state.hands?.[0];
  if (!hand?.cards?.length) throw new Error('strategy: no active hand');

  const up = value(upCard.rank);
  const { total, soft } = totals(hand.cards);
  return choose(hand, up, total, soft, actions);
}
