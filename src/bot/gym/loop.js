import { SEL } from './selectors.js';
import { beforeClick, clickGap } from '../pacing.js';

const J = JSON.stringify;
const POLL_MS = 30_000;

async function click(ctx, selector) {
  return ctx.eval(`(() => {
    const el = document.querySelector(${J(selector)});
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);
}

async function clickOrThrow(ctx, selector, what) {
  if (!(await click(ctx, selector))) throw new Error(`gym: cannot click ${what}`);
}

function estimate(preview) {
  const m = /ESTIMATED\s+([A-Z]+)\s+(.+?)\s+ENERGY\s+(\d+)/.exec(preview || '');
  return m ? { stat: m[1], range: m[2].trim(), cost: Number(m[3]) } : null;
}

function report(ctx, run) {
  ctx.report?.({
    hands: run.sets,
    pl: 0,
    decisions: run.sets,
    tokens: { prompt: 0, completion: 0, total: 0 },
    llm: 0,
    agree: null,
    last: run.last,
  });
}

async function ensurePage(ctx, cfg) {
  const want = cfg.privateGym ? SEL.routes.privateGym : SEL.routes.gym;
  let state = await ctx.read();
  if (state.login) throw new Error('not logged in — log into the game in this window first');
  if (state.page && state.route === want) return state;

  await ctx.eval(`location.hash = ${J(want)}`);
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    await ctx.sleep(250);
    state = await ctx.read();
    if (state.login) throw new Error('not logged in — log into the game in this window first');
    if (state.page && state.route === want) return state;
  }
  throw new Error(`gym page did not load (${want})`);
}

async function waitForFullEnergy(ctx, cfg, run) {
  let last = null;
  let state = await ctx.read();
  while (true) {
    if (run.stopped) return null;
    if (Date.now() - run.start >= cfg.maxSessionMinutes * 60_000) {
      throw new Error('session cap while waiting for energy');
    }
    if (!state.page) state = await ensurePage(ctx, cfg);
    const pct = state.energy?.percent;
    if (pct == null) throw new Error('energy meter not readable');
    if (pct >= 100) return state;
    if (pct !== last) {
      ctx.log('info', `gym: waiting for full energy (${pct}%)`);
      last = pct;
    }
    for (let i = 0; i < POLL_MS / 1000 && !run.stopped; i += 1) await ctx.sleep(1000);
    if (run.stopped) return null;
    state = await ctx.read();
  }
}

async function prepare(ctx, cfg, state) {
  const stat = cfg.stat;
  if (state.focus !== stat) {
    await beforeClick(ctx);
    await clickOrThrow(ctx, SEL.gym.focus[stat], `focus ${stat}`);
    await ctx.sleep(250);
  }
  const percent = Number(cfg.energyPercent);
  const before = await ctx.read();
  await ctx.eval(`(() => {
    const el = document.querySelector(${J(SEL.gym.energy)});
    if (!el) return false;
    el.value = String(${percent});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  // The slider value updates first, the preview recalculation follows a frame later.
  let after = before;
  for (let i = 0; i < 15; i += 1) {
    await ctx.sleep(200);
    after = await ctx.read();
    if (String(after.sliderValue) === String(percent) && after.preview !== before.preview) break;
  }
  if (String(after.sliderValue) !== String(percent)) {
    throw new Error(`energy slider did not take ${percent}%`);
  }
  const est = estimate(after.preview);
  const max = after.energy?.max;
  const want = max ? Math.round((percent / 100) * max) : null;
  if (want != null && est && est.cost !== want) {
    throw new Error(`energy slider shows ${est.cost} instead of ${want}`);
  }
  await clickGap(ctx);
  return ctx.read();
}

function statValue(potential, stat) {
  const m = new RegExp(`${stat.toUpperCase()}\\s+(\\d[\\d,]*)`).exec(potential || '');
  return m ? m[1] : null;
}

async function trainOnce(ctx, cfg, run, state) {
  const stat = cfg.stat;
  const percent = Number(cfg.energyPercent);
  const est = estimate(state.preview);
  const before = state.energy?.percent;
  const beforePotential = state.potential;
  const label = `${stat} ${percent}%${est ? ` (${est.range})` : ''}`;

  await beforeClick(ctx);
  await clickOrThrow(ctx, SEL.gym.train, `train ${stat}`);

  const end = Date.now() + 12_000;
  let after = state;
  while (Date.now() < end) {
    await ctx.sleep(300);
    after = await ctx.read();
    if (after.energy?.percent !== before) break;
    if (after.impact && after.impact !== state.impact) break;
  }
  if (after.energy?.percent === before && after.impact === state.impact) {
    throw new Error('train did not register');
  }
  // Let the result banner settle, then prefer the stat snapshot delta over static explainers.
  await ctx.sleep(800);
  after = await ctx.read();
  const gained = statValue(after.potential, stat);
  const had = statValue(beforePotential, stat);
  const delta = gained && had && gained !== had ? `${stat} ${had} → ${gained}` : null;

  run.sets += 1;
  run.last = {
    hand: label,
    action: 'TRAIN',
    source: 'gym',
    result: delta || `energy ${before}% → ${after.energy?.percent ?? '?'}%`,
  };
  report(ctx, run);
  ctx.log(
    'info',
    `gym: set ${run.sets} — ${label}${delta ? ` · ${delta}` : ''} · energy ${before}% → ${after.energy?.percent ?? '?'}%`,
  );
  return after;
}

export async function startGym(ctx) {
  const cfg = ctx.config();
  const run = { stopped: false, sets: 0, start: Date.now(), startEnergy: null, last: null };

  const stop = () => { run.stopped = true; };

  (async () => {
    try {
      let state = await ensurePage(ctx, cfg);
      run.startEnergy = state.energy?.percent ?? null;
      if (cfg.privateGym && state.restricted) {
        throw new Error('private gym requires an active LPC Supporter — turn off "Use private gym"');
      }
      ctx.log(
        'info',
        `gym: open — energy ${state.energy?.percent ?? '?'}% · ${cfg.stat} at ${cfg.energyPercent}% per set`,
      );

      if (cfg.dryRun) {
        if ((state.energy?.percent ?? 0) < 100) {
          return `dry run — energy ${state.energy?.percent}%, would wait for 100% then train ${cfg.stat}`;
        }
        state = await prepare(ctx, cfg, state);
        const est = estimate(state.preview);
        return `dry run — would train ${cfg.stat}${est ? ` (${est.range})` : ''}${state.trainDisabled ? ' — button currently disabled' : ''}`;
      }

      while (!run.stopped) {
        if (run.sets >= cfg.maxSets) return `max sets (${cfg.maxSets})`;
        state = await waitForFullEnergy(ctx, cfg, run);
        if (!state || run.stopped) return 'stopped';

        while (!run.stopped && run.sets < cfg.maxSets) {
          state = await prepare(ctx, cfg, state);
          if (state.trainDisabled) {
            return `train disabled — ${state.status || state.preview || 'the game blocked the set'}`;
          }
          if ((state.energy?.percent ?? 0) < Number(cfg.energyPercent)) break;
          state = await trainOnce(ctx, cfg, run, state);
        }
      }
      return 'stopped';
    } catch (e) {
      return `error: ${e.message}`;
    }
  })().then((why) => {
    if (run.stopped) return;
    report(ctx, run);
    ctx.log('info', `gym: finished — ${why} · ${run.sets} sets`);
    ctx.status(/error/i.test(why) ? 'error' : /dry run|supporter|not logged in/i.test(why) ? 'paused' : 'idle', why);
    ctx.onEnd?.(why);
  });

  return stop;
}
