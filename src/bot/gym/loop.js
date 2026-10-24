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
  if (state.page && state.route === want && state.sliderValue != null && /ESTIMATED/i.test(state.preview)) {
    return state;
  }

  await ctx.eval(`location.hash = ${J(want)}`);
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    await ctx.sleep(250);
    state = await ctx.read();
    if (state.login) throw new Error('not logged in — log into the game in this window first');
    if (state.page && state.route === want && state.sliderValue != null && /ESTIMATED/i.test(state.preview)) {
      return state;
    }
  }
  throw new Error(`gym page did not load (${want})`);
}

function energyNeed(cfg, state) {
  const current = state.energy?.current;
  if (current == null) return null;
  // The game takes a percentage of the *current* bar, floored, with a minimum of 1.
  return Math.max(1, Math.floor((Number(cfg.energyPercent) / 100) * current));
}

function turnCount(state) {
  return state.turns?.current;
}

function requireTurn(state) {
  const turns = turnCount(state);
  if (turns != null && turns < 1) {
    throw new Error('no turns available — wait for a turn, then start the feature again');
  }
  return turns;
}

async function waitForEnergy(ctx, cfg, run) {
  let last = null;
  let state = await ctx.read();
  while (true) {
    if (run.stopped) return null;
    if (Date.now() - run.start >= cfg.maxSessionMinutes * 60_000) {
      throw new Error('session cap while waiting for energy');
    }
    if (!state.page) state = await ensurePage(ctx, cfg);
    const have = state.energy?.current;
    if (have == null) throw new Error('energy meter not readable');
    if (have >= 1) return state;
    if (have !== last) {
      ctx.log('info', `gym: waiting for energy (${have}/${state.energy?.max ?? '?'})`);
      last = have;
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
  const setSlider = (value) => ctx.eval(`(() => {
    const el = document.querySelector(${J(SEL.gym.energy)});
    if (!el) return false;
    el.value = String(${value});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  await setSlider(percent);
  const want = energyNeed(cfg, state);
  let after = await ctx.read();
  // The first synthetic change can be swallowed while Angular finishes wiring the slider,
  // so drive it until the published cost matches the chosen share.
  for (let i = 0; i < 24; i += 1) {
    const est = estimate(after.preview);
    if (est && est.cost === want && String(after.sliderValue) === String(percent)) break;
    await ctx.sleep(250);
    if (i % 4 === 3) {
      await setSlider(percent === 100 ? 99 : percent + 1);
      await ctx.sleep(150);
      await setSlider(percent);
    } else if (i % 2 === 1) {
      await setSlider(percent);
    }
    after = await ctx.read();
  }
  if (String(after.sliderValue) !== String(percent)) {
    throw new Error(`energy slider did not take ${percent}%`);
  }
  const est = estimate(after.preview);
  if (want != null && est && est.cost !== want) {
    throw new Error(`energy slider shows ${est.cost} instead of ${want} (${after.preview.slice(0, 80)})`);
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
  const label = `${stat} ${percent}%${est ? ` (${est.cost} energy, ${est.range})` : ''}`;

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
        `gym: open — energy ${state.energy?.current ?? '?'}/${state.energy?.max ?? '?'} · turns ${state.turns?.current ?? '?'} · ${cfg.stat} at ${cfg.energyPercent}% per set`,
      );

      if (cfg.dryRun) {
        const have = state.energy?.current;
        if (have == null) return 'dry run — energy meter not readable';
        if (have < 1) {
          return `dry run — energy ${have}/${state.energy?.max ?? '?'}, would wait for energy`;
        }
        state = await prepare(ctx, cfg, state);
        const est = estimate(state.preview);
        const turns = turnCount(state);
        const noTurn = turns != null && turns < 1 ? ' — no turns available' : '';
        return `dry run — would train ${cfg.stat}${est ? ` (${est.range}, ${est.cost} energy)` : ''}${state.trainDisabled ? ' — button currently disabled' : ''}${noTurn}`;
      }

      while (!run.stopped) {
        if (run.sets >= cfg.maxSets) return `max sets (${cfg.maxSets})`;
        state = await waitForEnergy(ctx, cfg, run);
        if (!state || run.stopped) return 'stopped';
        requireTurn(state);

        while (!run.stopped && run.sets < cfg.maxSets) {
          state = await prepare(ctx, cfg, state);
          if (state.trainDisabled) {
            return `train disabled — ${state.status || state.preview || 'the game blocked the set'}`;
          }
          const need = energyNeed(cfg, state);
          if ((state.energy?.current ?? 0) < (need ?? 1)) break;
          requireTurn(state);
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
    ctx.status(/error/i.test(why) ? 'error' : /dry run|supporter|not logged in|no turns/i.test(why) ? 'paused' : 'idle', why);
    ctx.onEnd?.(why);
  });

  return stop;
}
