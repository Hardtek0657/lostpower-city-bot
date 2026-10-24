# Gym automation

Opens the City Gym, waits for full energy, then trains the chosen stat. No model and no image
reading: the page reports energy, the selected focus, the set cost and the estimated gain, and the
loop acts on those values.

## Route choice

- **Use private gym** off (default) → `#/city/gym` (Big Broly's Gym).
- **Use private gym** on → `#/city/private-gym` (Broly's Private Gym).

The private floor is reserved for active LPC Supporters. If the game shows the restricted banner the
run pauses with `private gym requires an active LPC Supporter` instead of clicking though it. The
choice, the stat and the set size are stored in the feature block of `config.json`, so they survive
restarts.

## Energy gate

- The loop waits until the HUD energy meter reads **100%** before starting a set. While waiting it
  polls every 30 s and logs each change (`gym: waiting for full energy (63%)`); the session cap
  applies to the wait.
- From full energy it trains with **Energy per set (%)**, then continues while the remaining energy
  still covers another set and `maxSets` has not been reached. With 25% per set that is four sets
  from one full bar; with 100% it is one.
- The estimated gain, energy cost, confidence cost, exp and turn cost are read from the preview
  before each click; the result is reported from the stat snapshot delta (e.g. `strength 14 → 15`).

## Settings

| Setting | Default | Notes |
|---|---|---|
| privateGym | off | use `#/city/private-gym`; requires an active Supporter |
| stat | strength | `strength`, `speed` or `guard` (the game calls defence "Guard") |
| energyPercent | 100 | 25, 50 or 100 percent of max energy per set |
| maxSets | 10 | |
| maxSessionMinutes | 240 | includes time spent waiting for energy |
| dryRun | on | prepares focus and set size, never trains |

## Observed

2026-10-23 on the test account: full energy 150/150, strength, 100% per set → one set, energy
150 → 0, 1 turn spent, preview `+51 – +61`. A dry run at 10% energy reports
`would wait for 100% then train strength` and spends nothing.

## Failure modes

- **Private floor restricted** — pauses with the Supporter message.
- **Not logged in** — pauses instead of clicking a login form.
- **Train disabled** — the preview/status text is surfaced (low confidence, busy, etc.).
- **Slider did not take** — the loop verifies the slider value and the set cost match the chosen
  percentage before training, otherwise it errors instead of spending the wrong amount.
- **Train did not register** — no energy change and no new stat snapshot within 12 s is an error.
