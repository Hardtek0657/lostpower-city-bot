const rand = (min, max) => min + Math.random() * (max - min);

export async function humanPause(ctx, min, max, { idleChance = 0.06, idleMin = 250, idleMax = 900 } = {}) {
  let ms = rand(min, max);
  if (Math.random() < idleChance) ms += rand(idleMin, idleMax);
  await ctx.sleep(Math.round(ms));
}

/** Between two clicks on the same screen. */
export const clickGap = (ctx) => humanPause(ctx, 70, 160, { idleChance: 0.05, idleMin: 120, idleMax: 300 });

export const beforeClick = (ctx) => humanPause(ctx, 170, 360, { idleChance: 0.08, idleMin: 150, idleMax: 400 });

export const beforeDeal = (ctx) => humanPause(ctx, 170, 360, { idleChance: 0.08, idleMin: 150, idleMax: 400 });

export const betweenHands = (ctx) => humanPause(ctx, 220, 450, { idleChance: 0.15, idleMin: 180, idleMax: 450 });
