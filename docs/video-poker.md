# Video poker

Plays Playland Casino's three draw-poker games: Jacks or Better 9/6, Bonus Poker 8/5 (80/40/25
quads) and Deuces Wild (100/20/12/8/4/3/2/2/1). The paytable shown in the game is what the bot
scores against.

There is no model and no chart lookup: every decision enumerates all 32 hold patterns and every draw
from the remaining 47 cards — 2,598,960 five-card hands — and keeps the pattern with the highest
expected payout. That is exact optimal play for the posted paytable, at about 0.5 s per decision.

- **Game** picks the variant; the bot switches the machine and verifies the active paytable.
- **Bet** is a table preset (5–5000); a hand's net is payout minus stake, so a single pair (1×) is a
  push, not a win.
- Results are scored from the final five cards, not the wallet, because the credits badge updates
  lazily.

## Settings

| Setting | Default | Notes |
|---|---|---|
| variant | jacks-or-better | `jacks-or-better`, `bonus-poker`, `deuces-wild` |
| bet | 5 | one of 5, 10, 25, 50, 100, 250, 1000, 5000 |
| maxHands | 50 | |
| stopLoss | 100 | checked between hands |
| maxSessionMinutes | 60 | |
| dryRun | on | opens the game and selects the variant, never deals |

## Validation

- Hand EVs match hand calculation: four to a royal 19.7, pair of jacks 1.54, four-flush 1.21.
- The evaluator reproduces the exact 5-card category counts (royal 4, straight flush 36, quads 624,
  full house 3,744, flush 5,108, straight 10,200, trips 54,912, two pair 123,552).
- Average payout of a random hand is 0.3342 against the theoretical 0.3369.
- The overall return is the noisy part: per-hand best EV has sd ≈ 0.94, so a few hundred hands
  cannot confirm 99.5% — per-decision EVs are the check.

## Failure modes

- **Not in Playland** — the casino route answers with a travel prompt; the run pauses with
  `travel required`.
- **Unreadable or duplicate cards** — the loop stops with an error rather than scoring a bad read.
- **Draw did not settle** — if the table is still in hand after the draw, the hand is never scored.
