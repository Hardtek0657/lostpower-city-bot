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

## Energy and turns

- **Energy per set** is a share of the *current* bar, exactly like the game's slider: the set costs
  `max(1, floor(share × current energy))`. On a 150 bar, 25% spends 37 when full but 3 when the bar
  is down to 15.
- The loop polls the energy meter and waits while the bar is empty; it trains as soon as there is
  energy for the chosen share. It keeps training while the remaining bar still covers another set,
  so with 25% per set it works a full bar down to zero before waiting for regeneration.
- There is **no set limit and no session cap**: the feature runs until you stop it, the kill switch,
  or a real blocker (no turns, restricted gym, unreadable page).
- Each set costs a turn, so the loop also checks the header turn counter and refuses to start a set
  at zero turns, pausing with `no turns available` instead of clicking into a blocked action.
- The estimated gain, energy cost, confidence cost, exp and turn cost are read from the preview
  before each click; the result is reported from the stat snapshot delta (e.g. `strength 14 → 15`).

## Settings

| Setting | Default | Notes |
|---|---|---|
| privateGym | off | use `#/city/private-gym`; requires an active Supporter |
| stat | strength | `strength`, `speed` or `guard` (the game calls defence "Guard") |
| energyPercent | 25 | 5, 10, 25, 50 or 100 percent of current energy per set |
| dryRun | on | prepares focus and set size, never trains |

## Observed

2026-10-23 on the test account: full energy 150/150, strength, 100% per set → one set, energy
150 → 0, 1 turn spent, preview `+51 – +61`. With a 30-energy bar: 5% → 1 energy (`+1`), 100% → 30
energy (`+8 – +10`). A dry run on an empty bar reports `would wait for energy` and spends nothing.

## Failure modes

- **Private floor restricted** — pauses with the Supporter message.
- **Not logged in** — pauses instead of clicking a login form.
- **No turns** — pauses with `no turns available` before wasting a click.
- **Train disabled** — the preview/status text is surfaced (low confidence, busy, etc.).
- **Slider did not take** — the loop verifies the slider value and the set cost match the chosen
  percentage before training, otherwise it errors instead of spending the wrong amount.
- **Train did not register** — no energy change and no new stat snapshot within 12 s is an error.
