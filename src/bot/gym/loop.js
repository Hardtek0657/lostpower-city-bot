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

async function readSettled(ctx, tries = 15) {
  let state = await ctx.read();
  for (let i = 0; i < tries && state.energy?.percent == null; i += 1) {
    await ctx.sleep(300);
    state = await ctx.read();
  }
  return state;
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

function needPct(cfg) {
  return Number(cfg.energyPercent);
}

/**
 * The game's slider is a percentage of the *current* bar. To spend `need` percentage points of the
 * bar while holding `havePct`, move the slider to need/havePct of what is there.
 */
function sliderForPct(need, havePct) {
  if (!havePct) return null;
  return Math.min(100, Math.max(1, Math.round((need / havePct) * 100)));
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

async function reload(ctx) {
  await ctx.eval('location.reload()');
  for (let i = 0; i < 40; i += 1) {
    await ctx.sleep(200);
    try {
      if (await ctx.eval('document.readyState') === 'complete') break;
    } catch {
      // Navigation tears down the execution context; retry on the next tick.
    }
  }
  await ctx.sleep(500);
}

async function waitForEnergy(ctx, cfg, run) {
  let last = null;
  let state = await readSettled(ctx);
  while (true) {
    if (run.stopped) return null;
    if (!state.page) state = await ensurePage(ctx, cfg);
    const need = needPct(cfg);
    const have = state.energy?.percent;
    if (have == null) {
      // The meter can disappear for a moment while the page re-renders after a set.
      if (last !== 'unreadable') {
        ctx.log('warn', 'gym: energy meter unavailable, retrying');
        last = 'unreadable';
      }
    } else if (have >= need) {
      return state;
    } else if (String(have) !== last) {
      ctx.log('info', `gym: waiting for energy (${have}% · need ${need}%)`);
      last = String(have);
    }
    for (let i = 0; i < POLL_MS / 1000 && !run.stopped; i += 1) await ctx.sleep(1000);
    if (run.stopped) return null;
    // The header is a server snapshot and does not tick, so force a fresh page every poll.
    ctx.log('info', 'gym: refreshing page to read energy');
    await reload(ctx);
    state = await ensurePage(ctx, cfg);
  }
}

async function selectFocus(ctx, stat, state) {
  const wanted = stat.toUpperCase();
  const ok = (s) => s.focus === stat && estimate(s.preview)?.stat === wanted;
  if (ok(state)) return state;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await beforeClick(ctx);
    await clickOrThrow(ctx, SEL.gym.focus[stat], `focus ${stat}`);
    for (let i = 0; i < 10; i += 1) {
      await ctx.sleep(150);
      state = await ctx.read();
      if (ok(state)) {
        ctx.log('info', `gym: focus ${stat}`);
        return state;
      }
    }
  }
  throw new Error(
    `could not select ${stat} (focus ${state.focus ?? 'none'}, preview ${estimate(state.preview)?.stat ?? '?'})`,
  );
}

async function prepare(ctx, cfg, state) {
  const stat = cfg.stat;
  state = await selectFocus(ctx, stat, state);
  const need = needPct(cfg);
  let havePct = state.energy?.percent;
  if (havePct == null) {
    state = await readSettled(ctx);
    havePct = state.energy?.percent;
  }
  const current = state.energy?.current ?? null;
  const sliderPct = sliderForPct(need, havePct);
  if (sliderPct == null) throw new Error('energy meter not readable');
  const expected = current ? Math.max(1, Math.floor((current * sliderPct) / 100)) : null;
  const setSlider = (value) => ctx.eval(`(() => {
    const el = document.querySelector(${J(SEL.gym.energy)});
    if (!el) return false;
    el.value = String(${value});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  await setSlider(sliderPct);
  let after = await ctx.read();
  // The first synthetic change can be swallowed while Angular finishes wiring the slider,
  // so drive it until the published cost matches the requested amount.
  for (let i = 0; i < 24; i += 1) {
    const est = estimate(after.preview);
    const costOk = expected == null || !est || Math.abs(est.cost - expected) <= 1;
    if (costOk && String(after.sliderValue) === String(sliderPct)) break;
    await ctx.sleep(250);
    if (i % 4 === 3) {
      await setSlider(sliderPct === 100 ? 99 : sliderPct + 1);
      await ctx.sleep(150);
      await setSlider(sliderPct);
    } else if (i % 2 === 1) {
      await setSlider(sliderPct);
    }
    after = await ctx.read();
  }
  if (String(after.sliderValue) !== String(sliderPct)) {
    throw new Error(`energy slider did not take ${sliderPct}%`);
  }
  const est = estimate(after.preview);
  if (expected != null && est && Math.abs(est.cost - expected) > 1) {
    throw new Error(`energy slider shows ${est.cost} instead of ~${expected} (${after.preview.slice(0, 80)})`);
  }
  const done = await ctx.read();
  if (done.focus !== stat) {
    throw new Error(`focus is ${done.focus ?? 'unset'}, expected ${stat}`);
  }
  const pending = estimate(done.preview);
  if (pending && pending.stat !== stat.toUpperCase()) {
    throw new Error(`preview is for ${pending.stat}, expected ${stat.toUpperCase()}`);
  }
  await clickGap(ctx);
  return done;
}

async function waitForEnabled(ctx, run, state, ms = 45_000) {
  const end = Date.now() + ms;
  while (!run.stopped && Date.now() < end) {
    if (!state.trainDisabled) return state;
    await ctx.sleep(1000);
    state = await ctx.read();
  }
  return run.stopped ? null : state;
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
        `gym: open — energy ${state.energy?.percent ?? '?'}% · turns ${state.turns?.current ?? '?'} · ${cfg.stat} at ${cfg.energyPercent}% per set`,
      );

      if (cfg.dryRun) {
        const need = needPct(cfg);
        const have = state.energy?.percent;
        if (have == null) return 'dry run — energy meter not readable';
        if (have < need) {
          return `dry run — energy ${have}% (need ${need}%), would wait`;
        }
        state = await prepare(ctx, cfg, state);
        const est = estimate(state.preview);
        const turns = turnCount(state);
        const noTurn = turns != null && turns < 1 ? ' — no turns available' : '';
        return `dry run — would train ${cfg.stat}${est ? ` (${est.range}, ${est.cost} energy)` : ''}${state.trainDisabled ? ' — button currently disabled' : ''}${noTurn}`;
      }

      while (!run.stopped) {
        state = await waitForEnergy(ctx, cfg, run);
        if (!state || run.stopped) return 'stopped';
        requireTurn(state);

        while (!run.stopped) {
          state = await prepare(ctx, cfg, state);
          if (state.trainDisabled) {
            // The table cools down for a few seconds between sets.
            state = await waitForEnabled(ctx, run, state);
            if (!state) return 'stopped';
            if (state.trainDisabled) {
              return `train disabled — ${state.status || state.preview || 'the game blocked the set'}`;
            }
            state = await prepare(ctx, cfg, state);
          }
          const need = needPct(cfg);
          if ((state.energy?.percent ?? 0) < need) break;
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
