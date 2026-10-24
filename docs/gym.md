# Gym automation

Opens the City Gym, waits for full energy, then trains the chosen stat. No model and no image
reading: the page reports energy, the selected focus, the set cost and the estimated gain, and the
loop acts on those values.

## Route choice

- **Use private gym** off (default) â†’ `#/city/gym` (Big Broly's Gym).
- **Use private gym** on â†’ `#/city/private-gym` (Broly's Private Gym).

The private floor is reserved for active LPC Supporters. If the game shows the restricted banner the
run pauses with `private gym requires an active LPC Supporter` instead of clicking though it. The
choice, the stat and the set size are stored in the feature block of `config.json`, so they survive
restarts.

## Energy and turns

- Everything is in **bar percentage**, the number the player HUD already shows, so a change to max
  energy does not affect the logic. **Energy per set** is how many percentage points to spend: 25%
  waits for the bar to read at least 25% and then trains on a quarter of the bar; 100% waits for a
  full bar.
- The game's own slider is a percentage of whatever is in the bar, so the bot converts: holding 40%
  and spending 10 points sets the slider to 25%; holding 100% and spending 25 points sets 25%. The
  preview cost is verified before the click (rounded to the nearest whole energy).
- It keeps training while the bar still covers the chosen points, then waits for regeneration.
- There is **no set limit and no session cap**: the feature runs until you stop it, the kill switch,
  or a real blocker (no turns, restricted gym, unreadable page).
- Each set costs a turn, so the loop also checks the header turn counter and refuses to start a set
  at zero turns, pausing with `no turns available` instead of clicking into a blocked action.
- The chosen stat is confirmed twice before a click: the focus card must carry `is-selected` **and**
  the preview must read `ESTIMATED <STAT>` for that stat.
- The estimated gain, energy cost, confidence cost, exp and turn cost are read from the preview
  before each click; the result is reported from the stat snapshot delta (e.g. `strength 14 â†’ 15`).

## Settings

| Setting | Default | Notes |
|---|---|---|
| privateGym | off | use `#/city/private-gym`; requires an active Supporter |
| stat | strength | `strength`, `speed` or `guard` (the game calls defence "Guard") |
| energyPercent | 25 | 5, 10, 25, 50 or 100 percentage points of the bar per set |
| dryRun | on | prepares focus and set size, never trains |

## Observed

2026-10-23 on the test account: at a 10% bar with 5% per set â†’ two sets (7 and 8 energy), strength
77 â†’ 81, bar 10% â†’ 0%. With 100% per set at a 10% bar the run waits (`energy 10% (need 100%)`) and
spends nothing; at a 0% bar it waits as well.

## Failure modes

- **Private floor restricted** â€” pauses with the Supporter message.
- **Not logged in** â€” pauses instead of clicking a login form.
- **No turns** â€” pauses with `no turns available` before wasting a click.
- **Focus not confirmed** â€” the click is retried until both the card and the preview name the chosen
  stat; a stubborn mismatch errors instead of training the wrong stat.
- **Cooldown** â€” between sets the game disables the button (`COOLING DOWN Next set in 3s`); the loop
  waits for it to re-enable, then re-reads the preview before clicking.
- **Train disabled** â€” the preview/status text is surfaced (low confidence, busy, etc.).
- **Slider did not take** â€” the loop verifies the slider value and the set cost match the chosen
  percentage before training, otherwise it errors instead of spending the wrong amount.
- **Train did not register** â€” no energy change and no new stat snapshot within 12 s is an error.

