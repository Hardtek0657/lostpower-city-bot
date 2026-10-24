# Blackjack autopilot

Opens the Playland Casino blackjack table, reads each hand from the DOM and plays it. The live
table is the source of truth; the screen is never guessed from screenshots.

## How it decides

1. `src/bot/blackjack/reader.js` reads cards via `aria-label`, recomputes totals locally and returns
   the legal actions.
2. `table` mode (default): `src/bot/blackjack/strategy-table.js` (S17, DAS) decides immediately with
   no network use.
3. `audit` mode: the table decides; the model is sampled once every 20 decisions and any divergence
   is logged, never acted on.
4. `llm` mode: `src/bot/blackjack/strategy.js` sends the state and the strategy chart to the decision
   model (`cx/gpt-6-luna(max)` default, `ds/deepseek-chat` tested); the action must be legal and
   confidence ≥ 0.6, otherwise the table plays.
5. Every model action is scored against the table and reported as agreement in the panel.

## Strategy source

[Wizard of Odds basic-strategy calculator](https://wizardofodds.com/games/blackjack/strategy/calculator/).
The chart uses 4+ decks (six assumed), dealer stands on soft 17, double after split, no surrender and
dealer peek. The supplied calculator URL does not encode these settings.

Saved game evidence confirms stands on 17, 3:2 payout and four split hands. Still unverified: deck
count, double after split, peek/liability rules and the refund from Forfeit. Do not treat Forfeit as
half-bet surrender without confirming its payout.

Keep table mode for deterministic chart execution. The objective is expected credits per unit
wagered, not the percentage of rounds won; changing bet size does not improve the odds. When
splitting aces is unavailable, soft 12 hits rather than doubles — see the
[Wizard of Odds soft-12 expected returns](https://wizardofodds.com/games/blackjack/expected-return-infinite-deck/)
for the infinite-deck S17 comparison supporting that fallback.

## Settings

| Setting | Default | Notes |
|---|---|---|
| bet | 10 | snapped to a table preset, capped at 5% of credits |
| maxHands | 50 | |
| stopLoss | 100 | checked between hands |
| decisionMode | table | `table`, `audit` or `llm` |
| maxSessionMinutes | 60 | |
| dryRun | on | opens the table and picks the bet, never deals |
| allowTableFallback | on | model actions must pass table validation |

## Failure modes

- **Presence check** — the deal is refused and the page shows a "Quick table check"; the run pauses
  with an actionable message instead of answering it. See the README section.
- **Not in Playland** — the casino route answers with a travel prompt; the run pauses with
  `travel required`.
- **Unknown table state** — the reader returns `phase: unknown` and the loop retries with a budget
  instead of clicking blindly.
