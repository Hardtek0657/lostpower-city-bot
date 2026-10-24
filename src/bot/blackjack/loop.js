import { SEL } from './selectors.js';
import { beforeClick, beforeDeal, betweenHands, clickGap, humanPause } from '../pacing.js';
import { strategize, describeHand } from './strategy.js';
import { basicStrategy } from './strategy-table.js';

const J = JSON.stringify;
const rand = (min, max) => min + Math.random() * (max - min);
const WAGERS = [10, 20, 50, 100, 200, 500, 1000, 5000];
const hasOutcome = (s) => /(WIN|LOSS|LOSE|PUSH|BUST|BLACKJACK|PAID)/i.test(s.result ?? '');

const fingerprint = (s) =>
  J([s.phase, s.dealer?.cards, s.hands?.map((h) => [h.cards, h.active]), s.actions]);

function snapBet(configBet, credits) {
  let bet = Number(configBet) || 10;
  if (credits != null) {
    const cap = Math.max(10, Math.floor((credits * 0.05) / 10) * 10);
    bet = Math.min(bet, cap);
  }
  return [...WAGERS].reverse().find((w) => w <= bet) ?? 10;
}

async function ev(ctx, js) {
  return ctx.eval(js);
}

async function click(ctx, selector) {
  return ev(ctx, `(() => {
    const el = document.querySelector(${J(selector)});
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
}

async function clickOrThrow(ctx, selector, what) {
  if (!(await click(ctx, selector))) throw new Error(`cannot click ${what} (${selector})`);
}

async function waitFor(ctx, selector, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ev(ctx, `!!document.querySelector(${J(selector)})`)) return;
    await ctx.sleep(200);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

async function waitUntil(ctx, ms, predicate) {
  const end = Date.now() + ms;
  let state;
  while (Date.now() < end) {
    state = await ctx.read();
    if (predicate(state)) return state;
    await ctx.sleep(200);
  }
  throw new Error(`table did not reach the expected state within ${ms}ms`);
}

async function ensureTable(ctx) {
  let page;
  for (let i = 0; i < 40; i++) {
    page = await ev(ctx, `({
      ready: document.readyState,
      login: !!document.querySelector(${J(SEL.login.user)}),
      modal: !!document.querySelector(${J(SEL.table.modal)}),
      url: location.href,
    })`);
    if (page.login) throw new Error('not logged in — log into the game in this window first');
    if (page.modal) return;
    if (page.ready === 'complete' && page.url.includes('lostpower.com')) break;
    await ctx.sleep(500);
  }

  if (ctx.enabled && !ctx.enabled()) throw new Error('feature is off');
  await ev(ctx, `location.hash = '#/city/playland-casino'`);
  try {
    await waitFor(ctx, SEL.casino.playNow, 15000);
  } catch {
    const travel = await ev(ctx, `!!document.querySelector('[data-testid="section-location-travel-prompt"]')`);
    if (travel) throw new Error('travel required — Playland Casino is only available in Playland');
    const login = await ev(ctx, `!!document.querySelector(${J(SEL.login.user)})`);
    throw new Error(login ? 'not logged in — log into the game in this window first' : 'casino did not load');
  }
  await clickOrThrow(ctx, SEL.casino.playNow, 'PLAY NOW');
  await waitFor(ctx, SEL.table.modal, 10000);
  // Let Angular finish mounting the controls before the first click.
  await waitFor(ctx, SEL.table.idle, 4000).catch(() => {});
  await ctx.sleep(250);
  ctx.log('info', 'blackjack: table open');
}

async function prepareBet(ctx, cfg, state) {
  if (state.credits != null && state.credits < 10) {
    throw new Error(`out of credits (${state.credits})`);
  }
  const bet = snapBet(cfg.bet, state.credits);
  if (bet !== Number(cfg.bet)) {
    ctx.log('warn', `blackjack: bet ${cfg.bet} reduced to ${bet} (5% bankroll cap)`);
  }
  if (state.bet !== bet) {
    await clickOrThrow(ctx, SEL.table.wager(bet), `wager ${bet}`);
    await clickGap(ctx);
    const after = await ctx.read();
    if (after.bet !== bet) throw new Error(`bet did not stick (wanted ${bet}, saw ${after.bet})`);
  }
  return bet;
}

function report(ctx, run) {
  ctx.report?.({
    hands: run.hands,
    credits: run.credits,
    pl: run.credits != null && run.startCredits != null ? run.credits - run.startCredits : null,
    decisions: run.decisions,
    tokens: run.tokens,
    llm: run.llm,
    agree: run.agree,
    last: run.last,
  });
}

async function act(ctx, cfg, settings, run, state) {
  if (!state.actions?.length) {
    // Buttons vanished between the read and the click; let the loop re-read.
    await ctx.sleep(200);
    return;
  }

  const table = basicStrategy(state);
  const mode = cfg.decisionMode ?? 'table';
  run.decisions += 1;

  // Audit samples every 20th decision, starting at one; only the table's action is played.
  const audit = mode === 'audit' && run.decisions % 20 === 1;
  let decision = table;

  if (mode === 'llm' || audit) {
    const llm = await strategize(state, { settings, signal: ctx.signal });
    if (ctx.signal?.aborted) return; // killed while waiting on the model

    run.tokens.prompt += llm.usage?.prompt ?? 0;
    run.tokens.completion += llm.usage?.completion ?? 0;
    run.tokens.total += llm.usage?.total ?? 0;

    if (llm.source === 'llm') {
      run.llm += 1;
      if (llm.action === table.action) {
        run.agree += 1;
      } else {
        run.disagreements.push({
          hand: describeHand(state),
          llm: llm.action,
          table: table.action,
          reason: llm.reason,
        });
        if (run.disagreements.length > 25) run.disagreements.shift();
        ctx.log('warn', `blackjack: ${audit ? 'audit' : 'LLM'} ≠ table — ${describeHand(state)}: llm ${llm.action}, table ${table.action}`);
      }
      if (!audit) decision = llm;
    } else if (llm.note) {
      ctx.log('warn', `blackjack: strategy fallback — ${llm.note}`);
    }
  }

  run.last = {
    hand: describeHand(state),
    action: decision.action.toUpperCase(),
    source: decision.source,
    result: null,
  };
  report(ctx, run);

  const tag = decision.source === 'llm' ? 'llm' : 'table';
  ctx.log('info', `blackjack: ${describeHand(state)} → ${decision.action.toUpperCase()} [${tag}] ${decision.reason ?? ''}`);
  if (decision.note) ctx.log('warn', `blackjack: strategy fallback — ${decision.note}`);

  const before = fingerprint(state);
  await beforeClick(ctx);
  await clickOrThrow(ctx, SEL.table.action[decision.action], decision.action);
  await waitUntil(ctx, 9000, (s) => fingerprint(s) !== before);
  await clickGap(ctx);
}

async function settle(ctx, cfg, run, state) {
  // Result text and credits can lag behind the action buttons disappearing.
  let s = state;
  const end = Date.now() + 6000;
  while (!hasOutcome(s) && Date.now() < end) {
    await ctx.sleep(250);
    s = await ctx.read();
  }
  if (!hasOutcome(s) || !Number.isFinite(s.credits)) {
    throw new Error('settlement not confirmed; stopping before another bet');
  }

  run.hands += 1;
  run.credits = s.credits;
  if (run.last) run.last.result = s.result;
  const pl = (s.credits ?? 0) - (run.startCredits ?? s.credits ?? 0);
  ctx.log('info', `blackjack: hand ${run.hands} — ${s.result ?? 'no result'} | credits ${s.credits ?? '?'} (${pl >= 0 ? '+' : ''}${pl})`);
  if (run.hands > 1) {
    ctx.notify?.('gambling', `Blackjack ${s.result ?? 'hand'}`, `credits ${pl >= 0 ? '+' : ''}${pl} · ${run.hands} hands this run`);
  }
  report(ctx, run);
  if (pl <= -Math.abs(cfg.stopLoss)) {
    run.stopped = true;
    ctx.status('idle', `stop loss ${pl}`);
  }
  return s;
}

async function runLoop(ctx, cfg, settings, run) {
  await ensureTable(ctx);
  const first = await ctx.read();
  run.startCredits = first.credits;
  run.credits = first.credits;
  report(ctx, run);
  ctx.log('info', `blackjack: ready — ${first.credits ?? '?'} credits, bet ${cfg.bet}, ${cfg.dryRun ? 'dry run' : 'live'}`);
  if (cfg.dryRun) {
    ctx.log('warn', 'blackjack: dry run is ON — stopping before the first deal');
  }

  while (!run.stopped) {
    if (Date.now() - run.startedAt > cfg.maxSessionMinutes * 60_000) return 'session cap';

    let state = await ctx.read();

    if (state.phase === 'in_play') {
      await act(ctx, cfg, settings, run, state);
      continue;
    }

    if (state.phase === 'ready') {
      run.unknown = 0;

      if (run.awaitingSettle) {
        state = await settle(ctx, cfg, run, state);
        run.awaitingSettle = false;
        if (run.stopped) return 'stopped';
        if (run.hands >= cfg.maxHands) return `max hands (${run.hands})`;
        await betweenHands(ctx);
      }

      if (run.hands >= cfg.maxHands) return `max hands (${run.hands})`;

      const bet = await prepareBet(ctx, cfg, state);
      if (cfg.dryRun) return `dry run — turn off Dry run to deal ${bet}`;
      if (ctx.signal?.aborted) return 'stopped';

      const prev = { result: state.result, credits: state.credits };
      const handStarted = (s) =>
        s.phase === 'in_play' ||
        (hasOutcome(s) && (s.result !== prev.result || s.credits !== prev.credits));

      const dealOnce = async () => {
        await beforeDeal(ctx);
        await clickOrThrow(ctx, SEL.table.deal, `deal ${bet}`);
        await humanPause(ctx, 450, 850, { idleChance: 0.05, idleMin: 200, idleMax: 600 });
        try {
          return await waitUntil(ctx, 6000, handStarted);
        } catch {
          return null;
        }
      };

      run.awaitingSettle = true;
      let started = await dealOnce();
      if (!started) {
        // A presence check ("Quick table check") blocks the deal and is meant for a human.
        const challenged = await ctx.eval(
          `/table check|tap LPC|presence required/i.test(document.body.innerText)`,
        );
        if (challenged) {
          ctx.log('warn', 'blackjack: casino presence check — stopping for a human');
          return 'human check required — clear it in the game window';
        }

        const now = await ctx.read();
        const unchanged =
          now.phase === 'ready' && now.credits === prev.credits && now.result === prev.result;
        if (unchanged) {
          ctx.log('warn', 'blackjack: deal click did not register, retrying once');
          started = await dealOnce();
        } else {
          started = now; // it did start; we just missed the transition window
        }
      }
      if (!started) throw new Error('deal did not register');
      continue;
    }

    run.unknown = (run.unknown ?? 0) + 1;
    if (run.unknown > 12) throw new Error(`unreadable table (${state.reason ?? 'no reason'})`);
    await ctx.sleep(400);
  }
  return 'stopped';
}

export async function startBlackjack(ctx) {
  const cfg = ctx.config();
  const settings = await ctx.settings();
  const run = { stopped: false, hands: 0, startCredits: null, startedAt: Date.now(), awaitingSettle: false, credits: null, decisions: 0, tokens: { prompt: 0, completion: 0, total: 0 }, llm: 0, agree: 0, disagreements: [], last: null };

  const stop = () => { run.stopped = true; };
  ctx.signal?.addEventListener('abort', stop);

  runLoop(ctx, cfg, settings, run)
    .then((why) => {
      if (run.stopped) return;
      const agree = run.llm ? Math.round((run.agree / run.llm) * 100) : null;
      ctx.log('info', `blackjack: finished — ${why} · ${run.hands} hands · ${run.tokens.total} tokens / ${run.decisions} decisions · ${agree == null ? 'n/a' : `${agree}%`} agree (${run.agree}/${run.llm})`);
      ctx.status(/human check|dry run/i.test(why) ? 'paused' : 'idle', why);
      ctx.onEnd?.(why);
    })
    .catch((err) => {
      if (run.stopped) return;
      const msg = String(err?.message ?? err);
      const soft = /travel required|human check|not logged in|no credentials/i.test(msg);
      ctx.log(soft ? 'warn' : 'error', `blackjack: ${msg}`);
      ctx.status(soft ? 'paused' : 'error', msg);
      ctx.onEnd?.(msg);
    });

  return stop;
}
