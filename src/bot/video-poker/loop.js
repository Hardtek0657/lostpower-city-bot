import { SEL } from './selectors.js';
import { beforeClick, beforeDeal, betweenHands, clickGap } from '../pacing.js';
import { bestHold } from './strategy.js';
import { parseCard, evaluate, PAYTABLES, VARIANT_LABEL } from './cards.js';
import { EXTRACT_JS } from './reader.js';

const J = JSON.stringify;

async function click(ctx, selector) {
  return ctx.eval(`(() => {
    const el = document.querySelector(${J(selector)});
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
}

async function clickOrThrow(ctx, selector, what) {
  if (!(await click(ctx, selector))) throw new Error(`video poker: cannot click ${what}`);
}

async function waitFor(ctx, selector, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ctx.eval(`!!document.querySelector(${J(selector)})`)) return;
    await ctx.sleep(200);
  }
  throw new Error(`video poker: timeout waiting for ${selector}`);
}

async function ensureOpen(ctx) {
  const state = await ctx.read();
  if (state.open) return state;

  let opened = await click(ctx, SEL.videoPoker.open);
  if (!opened) {
    if (ctx.enabled && !ctx.enabled()) throw new Error('feature is off');
    await ctx.eval(`location.hash = '#/city/playland-casino'`);
    // The casino floor mounts after the hash change; wait for the tile instead of a fixed guess.
    for (let i = 0; i < 75; i += 1) {
      if (await ctx.eval(`!!document.querySelector(${J(SEL.videoPoker.open)})`)) break;
      await ctx.sleep(200);
    }
    opened = await click(ctx, SEL.videoPoker.open);
  }
  if (!opened) {
    const travel = await ctx
      .eval(`!!document.querySelector('[data-testid="section-location-travel-prompt"]')`)
      .catch(() => false);
    if (travel) throw new Error('travel required — Playland Casino is only available in Playland');
    const where = await ctx
      .eval(`JSON.stringify({
        hash: location.hash,
        login: !!document.querySelector('[data-testid="input-loginUsername"]'),
        tiles: [...document.querySelectorAll('[data-testid^="button-openCasinoGame"]')].map((e) => e.dataset.testid),
        text: document.body.innerText.slice(0, 160),
      })`)
      .catch(() => 'unknown');
    throw new Error(`video poker: game tile not found on the casino floor — ${where}`);
  }
  await waitFor(ctx, SEL.videoPoker.modal, 8000);
  return ctx.read();
}

async function prepareVariant(ctx, variant) {
  let state = await ctx.read();
  if (state.variant === variant) return state;
  await clickOrThrow(ctx, SEL.videoPoker.variant(variant), `variant ${variant}`);
  await ctx.sleep(600);
  state = await ctx.read();
  if (state.variant !== variant) throw new Error(`video poker: variant stayed ${state.variant}`);
  return state;
}

async function prepareBet(ctx, bet) {
  let state = await ctx.read();
  if (state.phase === 'in_hand') return state;
  if (state.bet !== bet) {
    await clickOrThrow(ctx, SEL.videoPoker.wager(bet), `wager ${bet}`);
    await ctx.sleep(250);
    state = await ctx.read();
  }
  return state;
}

async function settle(ctx) {
  const end = Date.now() + 10_000;
  while (Date.now() < end) {
    const state = await ctx.read();
    if (state.open && state.phase !== 'in_hand') return state;
    await ctx.sleep(200);
  }
  return ctx.read();
}

function readable(state) {
  return state.cards?.length === 5 && state.cards.every((c) => c.rank && c.suit);
}

function readCards(state) {
  if (!state.cards || state.cards.length !== 5) throw new Error('video poker: expected 5 cards');
  const cards = state.cards.map((c) => {
    const card = parseCard(`${c.rank ?? ''}${c.suit ?? ''}`);
    if (card == null) throw new Error(`video poker: unreadable card "${c.rank}${c.suit}"`);
    return card;
  });
  if (new Set(cards).size !== 5) throw new Error('video poker: duplicate cards on screen');
  return cards;
}

async function presenceCheck(ctx) {
  return ctx.eval(`/table check|tap LPC|presence required/i.test(document.body.innerText)`);
}

async function playHand(ctx, cfg, run, state) {
  for (let i = 0; i < 10 && !readable(state); i += 1) {
    await ctx.sleep(200);
    state = await ctx.read();
  }
  const cards = readCards(state);
  const { hold, ev } = bestHold(cards, cfg.variant);
  const want = hold.map((h, i) => (h ? i : -1)).filter((i) => i >= 0);

  await beforeClick(ctx);
  for (const [i, card] of state.cards.entries()) {
    if (Boolean(card.held) !== Boolean(hold[i])) {
      await clickOrThrow(ctx, SEL.videoPoker.hold(i), `hold ${i}`);
      await clickGap(ctx);
    }
  }

  run.decisions += 1;
  run.last = {
    hand: state.cards.map((c) => `${c.rank}${c.suit}`).join(' '),
    action: want.length === 5 ? 'HOLD ALL' : want.length ? `HOLD ${want.join(',')}` : 'DRAW 5',
    source: 'ev',
    result: null,
    ev: Math.round(ev * 100) / 100,
  };
  report(ctx, run);
  ctx.log('info', `video poker: ${run.last.hand} → ${run.last.action} [ev ${run.last.ev}]`);

  const before = state.credits;
  await beforeClick(ctx);
  await clickOrThrow(ctx, SEL.videoPoker.draw, 'draw');
  const after = await settle(ctx);

  // A presence check can swallow the draw too; never score a hand that did not settle.
  if (after.phase === 'in_hand') {
    if (await presenceCheck(ctx)) return 'human check required — clear it in the game window';
    throw new Error('video poker: draw did not settle');
  }

  // Score the hand from the five final cards; the wallet badge updates lazily.
  let key = null;
  let payout = null;
  try {
    if (readable(after)) key = evaluate(readCards(after), cfg.variant);
  } catch { /* fall back to the wallet */ }
  if (key) payout = (PAYTABLES[cfg.variant][key] ?? 0) * cfg.bet;
  else if (Number.isFinite(after.credits) && Number.isFinite(before)) payout = after.credits - before + cfg.bet;

  const net = payout == null ? null : payout - cfg.bet;
  run.credits = after.credits;
  run.hands += 1;
  if (net != null && net > 0) run.wins += 1;
  else if (net != null && net < 0) run.losses += 1;

  const label = net == null ? 'UNSCORED' : net > 0 ? `WIN +${net}` : net < 0 ? `LOSS ${net}` : 'PUSH';
  run.last = { ...run.last, result: label, made: key };
  report(ctx, run);
  ctx.log('info', `video poker: hand ${run.hands} — ${label}${key ? ` (${key})` : ''} · credits ${after.credits}`);
  if (net != null) {
    ctx.notify?.('gambling', `Video poker ${label}`, `${VARIANT_LABEL[cfg.variant]} · credits ${after.credits ?? '?'} · ${run.wins}W/${run.losses}L`);
  }
  await betweenHands(ctx);
  return null;
}

function report(ctx, run) {
  ctx.report?.({
    hands: run.hands,
    wins: run.wins,
    losses: run.losses,
    credits: run.credits,
    pl: run.credits != null && run.startCredits != null ? run.credits - run.startCredits : null,
    decisions: run.decisions,
    tokens: run.tokens,
    llm: 0,
    agree: 0,
    last: run.last,
  });
}

export async function startVideoPoker(ctx) {
  const cfg = ctx.config();
  const run = {
    stopped: false,
    hands: 0,
    wins: 0,
    losses: 0,
    decisions: 0,
    startCredits: null,
    credits: null,
    start: Date.now(),
    tokens: { prompt: 0, completion: 0, total: 0 },
    last: null,
  };

  const stop = () => { run.stopped = true; };

  (async () => {
    try {
      const opened = await ensureOpen(ctx);
      run.startCredits = opened.credits ?? null;
      run.credits = opened.credits ?? null;
      report(ctx, run);
      ctx.log('info', `video poker: table open — ${opened.credits ?? '?'} credits, ${VARIANT_LABEL[cfg.variant]}, bet ${cfg.bet}`);

      await prepareVariant(ctx, cfg.variant);
      if (cfg.dryRun) return `dry run — turn off Dry run to deal ${cfg.bet}`;

      while (!run.stopped) {
        if (Date.now() - run.start > cfg.maxSessionMinutes * 60_000) return 'session cap';
        if (run.hands >= cfg.maxHands) return `max hands (${cfg.maxHands})`;
        if (run.startCredits != null && run.credits != null && run.startCredits - run.credits >= cfg.stopLoss) {
          return `stop loss ${run.credits - run.startCredits}`;
        }

        let state = await ctx.read();
        if (!state.open) {
          state = await ensureOpen(ctx);
          await prepareVariant(ctx, cfg.variant);
          continue;
        }

        if (state.phase === 'in_hand') {
          const halt = await playHand(ctx, cfg, run, state);
          if (halt) return halt;
          continue;
        }

        if (state.phase === 'ready') {
          if (state.bet !== cfg.bet) {
            await prepareBet(ctx, cfg.bet);
            state = await ctx.read();
            if (state.phase !== 'ready') continue;
          }
          // Pause before betting into an already-open presence check.
          if (await presenceCheck(ctx)) return 'human check required — clear it in the game window';
          await beforeDeal(ctx);
          await clickOrThrow(ctx, SEL.videoPoker.deal, 'deal');
          const started = await (async () => {
            const end = Date.now() + 8000;
            while (Date.now() < end) {
              const s = await ctx.read();
              if (s.phase === 'in_hand' && readable(s)) return s;
              if (s.phase === 'result') return s;
              await ctx.sleep(200);
            }
            return null;
          })();
          if (!started) {
            if (await presenceCheck(ctx)) return 'human check required — clear it in the game window';
            throw new Error('video poker: deal did not start a hand');
          }
          if (started.phase === 'in_hand') {
            const halt = await playHand(ctx, cfg, run, started);
            if (halt) return halt;
          }
          continue;
        }

        await ctx.sleep(300);
      }
      return 'stopped';
    } catch (e) {
      return `error: ${e.message}`;
    }
  })().then((why) => {
    if (run.stopped) return;
    report(ctx, run);
    ctx.log('info', `video poker: finished — ${why} · ${run.hands} hands · ${run.wins}W/${run.losses}L · credits ${run.credits ?? '?'}`);
    ctx.status(/human check|dry run|travel required/i.test(why) ? 'paused' : /error/i.test(why) ? 'error' : 'idle', why);
    ctx.onEnd?.(why);
  });

  return stop;
}
