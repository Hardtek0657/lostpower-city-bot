import { basicStrategy } from './strategy-table.js';

const SYSTEM = `You are the decision engine for a blackjack bot playing a real table. Choose the
action for the current hand; the bot clicks it.

TABLE RULES
6 decks, dealer stands on soft 17, blackjack pays 3:2, double after split allowed, split up to
4 hands, no surrender. allowed_actions lists what the table accepts right now. Never choose an
action outside that list.

BASIC STRATEGY — authoritative for these rules, apply it exactly.
Columns are the dealer upcard: 2 3 4 5 6 7 8 9 T A

HARD TOTALS
17+        S S S S S S S S S S
13-16      S S S S S H H H H H
12         H H S S S H H H H H
11         D D D D D D D D D H
10         D D D D D D D D H H
9          H D D D D H H H H H
8 or less  H

SOFT TOTALS (ace counted as 11)
12         H H H H H H H H H H (A,A only when split is unavailable)
19+        S S S S S S S S S S
18         S D D D D S S H H H
17         H D D D D H H H H H
15-16      H H D D D H H H H H
13-14      H H H D D H H H H H

PAIRS (split only on these exact ranks)
A,A        P P P P P P P P P P
10,10      S S S S S S S S S S
9,9        P P P P P S P P S S
8,8        P P P P P P P P P P
7,7        P P P P P P H H H H
6,6        P P P P P H H H H H
5,5        never split — play as hard 10
4,4        H H H P P H H H H H
3,3        P P P P P P H H H H
2,2        P P P P P P H H H H

PRIORITY: pair rule (only when split is allowed) > soft total > hard total.
If the chart action is not allowed: double becomes hit (soft 18 becomes stand), split falls back
to the total.

Do not invent deviations. Base every answer on the chart above.

Reply with JSON only, no markdown:
{"action":"hit|stand|double|split","confidence":0.0-1.0,"reason":"<=12 words"}`;

const stripFences = (s) =>
  String(s ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

const usageOf = (u) =>
  u
    ? {
        prompt: u.prompt_tokens ?? 0,
        completion: u.completion_tokens ?? 0,
        total: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      }
    : null;

export function describeHand(state) {
  const hand = state.hands?.find((h) => h.active) ?? state.hands?.[0];
  if (!hand) return 'no hand';
  const cards = hand.cards.map((c) => `${c.rank}${c.suit}`).join(' ');
  const up = state.dealer?.cards?.[0];
  return `${cards} (${hand.total}${hand.soft ? ' soft' : ''}) vs ${up ? `${up.rank}${up.suit}` : '?'}`;
}

export async function strategize(state, { settings, signal } = {}) {
  const cfg = settings?.features?.blackjack ?? {};
  const fallback = (note) => ({ ...basicStrategy(state), note });

  if (!Array.isArray(state.actions) || state.actions.length === 0) {
    throw new Error('no legal actions available');
  }

  // Deterministic mode: no network, no model.
  if (cfg.decisionMode === 'table') {
    return { ...basicStrategy(state), confidence: 1, source: 'table', model: null, usage: null };
  }

  const base = settings?.router?.baseUrl ?? 'http://127.0.0.1:20128/v1';
  const key = settings?.router?.apiKey ?? '';
  const model = settings?.models?.decision ?? 'ds/deepseek-chat';

  const hand = state.hands?.find((h) => h.active) ?? state.hands?.[0];
  const payload = {
    dealer_up: state.dealer?.cards?.[0] ? `${state.dealer.cards[0].rank}${state.dealer.cards[0].suit}` : null,
    dealer_total: state.dealer?.total,
    hole_hidden: state.dealer?.holeHidden,
    hand: hand ? {
      cards: hand.cards.map((c) => `${c.rank}${c.suit}`),
      total: hand.total,
      soft: hand.soft,
      wager: hand.wager,
    } : null,
    other_hands: state.hands?.filter((h) => h !== hand).map((h) => ({
      cards: h.cards.map((c) => `${c.rank}${c.suit}`), total: h.total, done: !h.active,
    })),
    allowed_actions: state.actions,
  };

  let usage = null;
  try {
    const timeout = AbortSignal.timeout(8000);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: sig,
    });
    if (!res.ok) throw new Error(`router ${res.status}`);

    // 9router appends an SSE terminator even on non-streaming requests.
    const raw = (await res.text()).replace(/\s*data:\s*\[DONE\]\s*$/i, '').trim();
    const body = JSON.parse(raw);
    const content = stripFences(body.choices?.[0]?.message?.content);
    const out = JSON.parse(content);
    usage = usageOf(body.usage);

    if (!state.actions.includes(out.action)) {
      throw new Error(`illegal action "${out.action}"`);
    }
    if (!Number.isFinite(out.confidence) || out.confidence < 0.6 || out.confidence > 1) {
      throw new Error(`invalid or low confidence ${out.confidence}`);
    }
    return {
      action: out.action,
      reason: String(out.reason ?? '').slice(0, 120),
      confidence: out.confidence,
      source: 'llm',
      model: body.model ?? model,
      usage,
    };
  } catch (err) {
    if (cfg.allowTableFallback === false) throw err;
    return { ...fallback(String(err?.message ?? err)), usage };
  }
}
