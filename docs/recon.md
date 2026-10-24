# Lost Power City — Recon Notes

Captured 2026-10-22 against the live site with a throwaway test account
(Chrome 156 headless, 1360×900, 100% scale). Raw dumps in `recon/*.json`,
screenshots in `recon/*.png`.

## Account / app shape

- Angular SPA, hash routes: `/#/login`, `/#/home`, `/#/city/playland-casino`.
- API on a separate origin: `https://lpc-api.lostpower.com` (cookie session,
  `GET /api/auth/me` bootstraps it).
- Login: `POST /api/auth/login` with the form body; the UI redirects to `/#/home`.
- The whole UI is DOM — no canvas anywhere (`document.querySelectorAll('canvas').length === 0`).
- Everything worth clicking has a `data-testid`. This is the contract the bot targets.

## Login

| Step | Selector |
|---|---|
| Username | `[data-testid="input-loginUsername"]` (also `#username`) |
| Password | `[data-testid="input-loginPassword"]` (also `#password`) |
| Submit | `[data-testid="button-loginSubmit"]` |
| Google button | iframe `accounts.google.com/gsi/button` — ignored |

Angular reactive forms: set `.value`, dispatch `input` + `change`, then click submit.
Redirect to `/#/home` is the success signal; the form staying on `/#/login` is the failure signal.

## Casino floor

Route: `https://lostpower.com/#/city/playland-casino`

| Element | Testid |
|---|---|
| Page section | `section-casino` |
| Blackjack card | `card-casinoGame-blackjack` ("BLACKJACK PIT · $10-$5,000 · Back Room Blackjack") |
| **Play now** | `button-openCasinoGame-blackjack` |
| Bankroll card | `card-casinoWallet` ("BANKROLL $625") |
| Cash wallet | `card-casinoCurrency` ("CASH WALLET $3,942") |

"PLAY NOW" opens a **modal**, the route does not change. That means the bot's flow is:
casino route → click `button-openCasinoGame-blackjack` → modal.

## Blackjack modal

Root: `[data-testid="modal-casinoBlackjack"]`

| Element | Testid | Notes |
|---|---|---|
| Credits | `badge-casinoModalCredits` | innerText `YOUR CREDITS\n625\nBANKED` |
| Close | `button-closeCasinoModal` | |
| Idle panel | `blackjackTableIdle` | "TABLE READY …" |
| Table | `blackjackTable` | appears once dealt |
| Result / status | `result-blackjack` | see phases below |
| Wager presets | `button-blackjackWager-10/20/50/100/200/500/1000/5000` | min 10, max 5,000 |
| Repeat bet | `button-blackjackSameBet` | "SAME 10" once a bet exists |
| Max bet | `button-blackjackMaxBet` | |
| **Deal** | `button-startBlackjack` | label "DEAL 10" / "DEAL <bet>" |
| Actions | `actions-blackjackActive` (container) | |
| Hit / Stand / Double / Split / Forfeit | `button-blackjackHit`, `button-blackjackStand`, `button-blackjackDouble`, `button-blackjackSplit`, `button-blackjackForfeit` | illegal ones render `disabled` (e.g. split on 5+6) |

### Phases (what the bot keys off)

1. **idle** — `blackjackTableIdle` present, `button-startBlackjack` enabled.
2. **in play** — `actions-blackjackActive` present, `result-blackjack` text starts `IN PLAY`
   ("Your move. Hit, stand, double, or split if the table allows."), hand total shown per hand.
3. **result** — `result-blackjack` shows `WIN` / `LOSE` / `PUSH` / `DEALER BUST` + `+N credits`;
   then the wager panel and `DEAL` return (next hand ready).

### Cards

Cards are spans with a stable testid **and** an `aria-label` holding rank+suit:

```html
<span class="casinoCard casinoCard--red" aria-label="5♥" data-testid="card-blackjackPlayer-0-0">
  <b class="casinoCard__rank">5</b><i class="casinoCard__suit">♥</i>
</span>
```

| Card | Testid pattern |
|---|---|
| Dealer upcard / draws | `card-blackjackDealer-<n>` |
| Dealer hole | `card-blackjackDealer-hole` (`aria-label` absent; text `?`) |
| Player hand `h`, card `i` | `card-blackjackPlayer-<h>-<i>` (h = 0..3 after splits) |

`aria-label` is the cheapest reliable source (`"5♥"`, `"10♠"`); rank text and suit element
are there if the label ever changes. Totals are rendered too (`blackjackHand-<h>` contains the
hand total, dealer rail shows the dealer total) but should be recomputed from cards, not trusted.

### Rules confirmed in the UI

- Dealer stands on 17 (S17).
- Blackjack pays 3:2.
- Split up to four hands.
- Double down and forfeit exist; no insurance UI.
- Bet range $10–$5,000, fixed presets only (no free-text bet input).

## Timing

| Step | Observed |
|---|---|
| Login → home | ~3–5 s |
| Casino route load | ~2 s |
| PLAY NOW → modal | <1 s |
| DEAL → cards + actions | ~1–2 s |
| Action click → result | ~1–2 s |

No turn timer was observed — the table waits for the player. That removes the latency pressure
from the LLM round trip (still budget ~3 s/action to be safe).

## Model check (9router, `http://127.0.0.1:20128/v1`)

24 models exposed with `ds/` prefix (not `deepseek/`):

- `ds/deepseek-chat` — 776 ms, works.
- `ds/deepseek-v4-flash-vision-exp` — **vision works**. On `recon/04-hand.png` it returned
  `{"dealer":["2♠","?"],"player":["5♥","6♠"],"actions":["hit","stand","double down","forfeit"],"state":"in_hand"}`
  in 2.2 s (1,199 prompt + 154 completion tokens). It correctly noticed SPLIT was disabled.

So both pipelines are available: DOM read (free, exact) or vision read (costs ~1.4k tokens,
2 s). The DOM path is strictly better for this game; vision is worth keeping as a fallback
and as a cross-check on the reader.

## Session notes

- The test account started with 625 credits (bankroll) / $3,942 cash wallet.
- One hand was played during recon (bet 10, stood on 11, dealer busted with 22): +10 credits,
  bankroll now 635.
- `Turns 6 / 100` and energy 93/104 are unrelated to the casino (no turn was consumed by dealing).
