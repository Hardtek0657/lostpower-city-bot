# LostPower Bot — Build Plan

Status: v3 (feature modules + proxy + alerts) · Target: Windows desktop · Game: https://lostpower.com ("Lost Power City")
Recon details: [docs/recon.md](docs/recon.md) · Feature docs: [docs/](docs/)

---

## 1. Goal

An Electron app that hosts the game in a persistent session and exposes a side panel where
features are toggles. Each feature is a module in `src/bot/registry.js` with its own settings,
dry run and stop conditions; the panel builds itself from that registry.

Shipped modules: Playland blackjack, Playland video poker, City Gym training. Platform-level
features: an optional proxy (applied before the game loads) and Discord alerts for in-game
alerts/e-mail plus feature events.

## 2. Scope

**v1 (in)**
- Game window with persistent login (log in by hand once; cookies survive restarts).
- Side panel: feature toggles, per-feature settings, live log, status, emergency stop.
- Blackjack loop end to end: open table → bet → deal → read → decide → act → repeat.
- Video poker: three variants, exact EV over all hold patterns.
- Gym: public/private floor, stat choice, percentage-of-bar energy gate, turn check.
- Reader: DOM via `data-testid` (vision deferred).
- Decision: strategy table by default; optional model via 9router, validated, with fallback.
- Guardrails: max hands, stop-loss, max bet, dry-run, kill switch, session minutes.
- Session stats in the panel: hands, P/L, tokens used; per-session token total in the finish log.
- Proxy: HTTP/HTTPS/SOCKS5 with optional auth, applied before the first game request, fail-closed.
- Discord alerts: unread alerts/mail watcher, gym sets, gambling hands, session summaries.
- JSONL logs + last hand kept in memory for debugging.

**v1 (out)**
- Automatic travel between districts, multi-account, parallel sessions, evasion, CAPTCHA solving,
  cloud sync, auto-update, installer polish.
- Real money. This is in-game credits only.

## 3. Key decisions

| Area | Decision | Why |
|---|---|---|
| Shell | Electron 3x, one `BrowserWindow` (panel) + `WebContentsView` (game) | Panel and game side by side; clean `capturePage` target |
| Language | Modern JS (ESM) + JSDoc, no bundler, no runtime deps | `electron .` runs as-is; fast iteration |
| HTTP | Node built-in `fetch` | No SDK |
| **Reader** | **DOM via `data-testid`** (vision deferred) | Recon: the table is text DOM with per-card `aria-label` — exact, free, no hallucination. Vision verified working but costs 2 s + ~1.4k tokens per read |
| Decision | Deterministic table by default; `cx/gpt-6-luna(max)` optional via `decisionMode` | The table is exact and instant; the model measured 98% agreement, so it is opt-in, not the default |
| Actions | Click the real DOM buttons | Table has stable testids for every control |
| Persistence | `userData/config.json`, `logs/*.jsonl`; API keys/passwords via `safeStorage` | Zero deps, secrets encrypted |
| Security | `contextIsolation`, `sandbox`, narrow preload, navigation locked to lostpower.com | Remote untrusted page |
| Features | Registry modules; the panel renders whatever is in `features` | Adding a feature = one folder + one entry + one doc |
| Gym gate | Percentage of the bar (never absolute energy), plus a turn check | Max-energy changes don't break it; matches what the HUD shows |
| Proxy | Applied to the game session before `loadURL`; dead proxy fails closed | No request may escape over the real IP |
| Alerts | Discord webhook, per-kind toggles, URL encrypted | Notification without watching the window |

Model ids: `cx/gpt-6-luna(max)` (default decision model) and `ds/deepseek-chat` (alternative).
Measured agreement with the strategy table: 98% for luna over 132 decisions, 90% for
`ds/deepseek-chat` over 389. Both were smoke-tested through 9router.

## 4. Architecture

```
┌──────────────────────────── BrowserWindow ─────────────────────────────┐
│ ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│ │ WebContentsView              │  │ Panel (local HTML, no framework) │ │
│ │ lostpower.com                │  │ toggles · limits · log · STOP    │ │
│ │ session: persist:lostpower   │  │                                  │ │
│ └───────────────┬──────────────┘  └────────────────▲─────────────────┘ │
└─────────────────┼──────────────────────────────────┼───────────────────┘
                  │ capturePage · debugger · sendInputEvent
          ┌───────▼─────────┐                  IPC (preload bridge)
          │ Bot engine      │                          │
          │ (main process)  │──────────────────────────┘
          │ registry        │
          │ feature loops   │        ┌──────────────────────────┐
          └───────┬─────────┘───────▶│ 9router 127.0.0.1:20128  │
                  │                  │ ds/deepseek-chat         │
                  │ JSONL            │ (+ vision model)         │
                  ▼                  └──────────────────────────┘
           userData/logs/
```

Platform plumbing sits outside the feature loops: `applyProxy()` configures the game session
before `loadURL()`, and the alert watcher (a timer in the main process) reads the header counters
and posts to the Discord webhook. Neither path goes through the panel renderer.

## 5. Repo layout

See [Project structure in README.md](README.md#project-structure) for the current file layout.
Each feature owns its loop, reader, strategy and selectors under `src/bot/<id>/`; `src/bot/` holds
shared utilities, `src/alerts.js` the webhook queue, and `src/config.js` the encrypted secrets.
Feature docs live in `docs/<id>.md` (see §16b).

## 6. Feature registry

```js
export const features = [
  {
    id: 'blackjack',
    label: 'Blackjack autopilot',
    description: 'Plays the Playland Casino blackjack table.',
    enabled: false,
    settings: [
      { key: 'bet',       label: 'Bet per hand', type: 'select', options: [10,20,50,100,200,500,1000,5000], default: 10 },
      { key: 'maxHands',  label: 'Max hands',    type: 'number', default: 50,   min: 1, max: 5000 },
      { key: 'stopLoss',  label: 'Stop after loss', type: 'number', default: 100, min: 1, max: 100000 },
      { key: 'dryRun',    label: 'Dry run (no deal)', type: 'bool', default: true },
      { key: 'maxSessionMinutes', label: 'Session cap (min)', type: 'number', default: 60, min: 1, max: 720 },
      { key: 'allowTableFallback', label: 'Fallback to basic strategy', type: 'bool', default: true },
    ],
    start(ctx) { return startBlackjack(ctx) },   // returns stop()
  },
  {
    id: 'gym',
    label: 'Gym automation',
    description: 'City Gym. Trains the chosen stat once the bar covers the chosen share.',
    settings: [
      { key: 'privateGym',    label: 'Use private gym (supporters)', type: 'bool',   default: false },
      { key: 'stat',          label: 'Train',      type: 'select', options: [
          { value: 'strength', label: 'Strength' }, { value: 'speed', label: 'Speed' },
          { value: 'guard', label: 'Guard' }], default: 'strength' },
      { key: 'energyPercent', label: 'Energy per set', type: 'select', options: [5, 10, 25, 50, 100], default: 25 },
      { key: 'dryRun',        label: 'Dry run (no train)', type: 'bool', default: true },
    ],
    start(ctx) { return startGym(ctx) },
  },
];
```

Feature order in the panel is alphabetical by label. Each feature may expose `read(webContents)`
for its DOM reader; the panel never receives `start`/`read` (stripped by `featureView`).

## 7. Panel + IPC

Panel (≈340 px, right): status dot, feature toggles, per-feature settings, Start/Stop,
live log tail, session strip (hands, P/L, LLM/table agreement, tokens, last hand), plus the
collapsible ACCOUNT, PROXY and ALERTS cards.

```
invoke  state:get
invoke  config:patch / feature:setEnabled(id, on)
invoke  auth:save / auth:clear
invoke  proxy:save / proxy:clearAuth
invoke  alerts:save / alerts:test
invoke  log:get / log:popout
on      status ({id, state, detail})
on      log ({id, level, msg, data})
on      stats ({hands, pl, agree, tokens, last})
on      features (serializable feature list)
```

## 8. Game flow (verified selectors)

1. `https://lostpower.com/#/login` → fill login → wait for `#/home`.
2. `https://lostpower.com/#/city/playland-casino` → wait `[data-testid="button-openCasinoGame-blackjack"]`.
3. Click it → modal `[data-testid="modal-casinoBlackjack"]` (route does not change).
4. Credits: `badge-casinoModalCredits` (`YOUR CREDITS\n625\nBANKED`).
5. Bet: click `button-blackjackWager-<preset>`; presets 10…5000, min 10.
6. Deal: `button-startBlackjack` ("DEAL 10").
7. In hand: `actions-blackjackActive` + `button-blackjack{Hit,Stand,Double,Split,Forfeit}`;
   illegal actions are `disabled`.
8. Result: `result-blackjack` (`WIN`/`LOSE`/`PUSH`/`DEALER BUST` + `+N credits`), then idle again.

Cards: `card-blackjackDealer-<n>`, `card-blackjackDealer-hole`, `card-blackjackPlayer-<hand>-<i>`,
each with `aria-label="5♥"`. Hands: `blackjackHand-<h>`; the active hand contains `PLAY THIS HAND.`

Bet handling: the game only accepts presets, so a configured bet is snapped down to the nearest
preset ≤ it, clamped to 10…5000, and additionally to ≤5% of the current credits.

## 9. Blackjack state machine

| State | Action | Exit when | Guard |
|---|---|---|---|
| `ENSURE_TABLE` | open casino route, click PLAY NOW | modal + deal button present | 15 s |
| `READY` | if `awaitingSettle`: settle the finished hand. Then pick bet, click DEAL | actions appear, or a new outcome / credit change (blackjack) | 8 s |
| `IN_PLAY` | read state → strategy → click action | fingerprint changes (cards, actions, phase) | 9 s |
| `SETTLE` | log hand, bump counters, check stop-loss | back to `READY` | — |
| `STOP` | feature off, kill switch, any limit | — | — |

The result screen keeps the DEAL button, so "result" is not a distinct DOM phase. The loop tracks
`awaitingSettle` itself: a hand starts when DEAL is clicked and ends when the actions disappear.

Checked every transition: `maxHands`, `stopLoss`, `maxSessionMinutes`, `stopSignal`, credits
floor, 12 consecutive unreadable reads. Unknown phase → stop, never blind-click.

Splits: after `button-blackjackSplit`, the reader returns all hands and the active index;
`IN_PLAY` repeats per hand until the actions disappear.

## 10. Reader — `TableState`

```ts
{
  phase: 'ready' | 'in_play' | 'unknown',
  credits: 625,
  bet: 10,
  dealer: { cards: ['2♠'], holeHidden: true, total: 2 },
  hands: [{ cards: ['5♥','6♠'], total: 11, soft: false, active: true, wager: 10 }],
  actions: ['hit','stand','double'],   // enabled buttons only
  result: null | "WIN … +10 credits"
}
```

DOM reader: `aria-label` → rank/suit, recompute totals locally (aces 1/11), never trust the
rendered totals. Read budget <5 ms.

Vision reader — deferred. The hook is a second `readTable()` implementation behind the same
`TableState`; the prompt and model (`ds/deepseek-v4-flash-vision-exp`) were verified on a real
screenshot, so it can be added without touching the loop.

## 11. Decision — `strategize(state, ctx)`

Prompt: rules (S17, BJ 3:2, split to 4, DAS), the `TableState`, bet, credits, session P/L.
Output: `{"action":"hit","confidence":0.9,"reason":"11 vs 2 — double if allowed, else hit"}`.
Accept only if `action ∈ state.actions` and confidence ≥ 0.6; otherwise use the local table.
Timeouts, non-JSON, or a 5xx all fall through to the local table (config `allowTableFallback`,
default true). Every decision stores `source: "llm" | "table"` in the log.

Local table: hard/soft/pairs with S17 + DAS, no surrender (FORFEIT ignored in v1). It recomputes
totals from the cards, validates the state, and only ever returns an action from `state.actions`.
Hard 11 vs Ace is a hit (simulated: EV −0.209 hit vs −0.232 double).

Every LLM decision is also checked against the local table; the run tracks the agreement rate and
logs each divergence. `decisionMode` is `table` (deterministic, no network), `audit` (table decides,
model sampled 1-in-20 for comparison only) or `llm` (model decides, table validates and falls back).

## 12. Actions and pacing

- Click the testid button with `Runtime.evaluate` → `.click()`; verify the phase changed;
  retry once, then stop.
- Randomised 70–450 ms gaps (occasionally longer) before each action; no actions while a phase
  transition is in flight.
- One bot instance per window; a second Start is a no-op.

## 13. Safety

- **Kill switch** `Ctrl+Shift+X` (global + in-app) → sets `stopSignal`, aborts after the current click.
- **Auto login**: stored username + DPAPI-encrypted password; fills and submits the login form on
  startup and whenever the app lands on `/#/login`. Off by default, toggled in the ACCOUNT block.
- Presence check (`CASINO_PRESENCE_REQUIRED`) → pause, disable the feature, show the prompt. Never
  answered by the bot; the human clears it and restarts.
- Dry run default: opens the table and picks the bet, never deals.
- Caps: max hands, stop-loss, bet ≤ 5% credits, max session minutes, 12 unreadable reads.
- Gym: energy gate uses the bar percentage (not absolute energy) plus a header turn check; no set or
  session cap, so the feature runs until stopped.
- Proxy: applied to the game session before `loadURL`; loopback bypass disabled; an unreachable
  proxy fails the load (`ERR_PROXY_CONNECTION_FAILED`) instead of falling back to the real IP.
- Alerts: webhook URL encrypted with `safeStorage`, never returned to the renderer, restricted to
  Discord webhook URLs; each notification kind has its own toggle.
- Stop on: unknown phase, missing modal, credits below 10, login lost.
- Vision, when added, captures only the modal region; nothing else leaves the machine.

## 14. Config

```json
{
  "router": { "baseUrl": "http://127.0.0.1:20128/v1", "apiKeyEnc": "…" },
  "models": { "decision": "cx/gpt-6-luna(max)", "vision": "ds/deepseek-v4-flash-vision-exp" },
  "game": { "url": "https://lostpower.com/", "autoLogin": false, "username": "" },
  "proxy": { "enabled": false, "protocol": "http", "host": "", "port": 8080,
             "username": "", "passwordEnc": "" },
  "alerts": { "enabled": false, "webhookEnc": "", "pollSeconds": 60,
              "onAlerts": true, "onMail": true, "onGym": true,
              "onGambling": true, "onSession": true },
  "features": {
    "blackjack": { "enabled": true, "bet": 10, "maxHands": 50, "stopLoss": 100,
                   "dryRun": true, "maxSessionMinutes": 60, "allowTableFallback": true,
                   "decisionMode": "table" },
    "video-poker": { "enabled": false, "variant": "jacks-or-better", "bet": 5,
                     "maxHands": 50, "stopLoss": 100, "dryRun": true, "maxSessionMinutes": 60 },
    "gym": { "enabled": false, "privateGym": false, "stat": "strength",
             "energyPercent": 25, "dryRun": true }
  }
}
```

`publicConfig()` strips `passwordEnc`, `apiKeyEnc` and `webhookEnc`, exposing only `hasPassword` /
`hasApiKey` / `hasWebhook` to the renderer.

Shared login, casino and credit-badge selectors live in `src/bot/selectors.js`.
Game-specific selectors live in `src/bot/blackjack/selectors.js` and
`src/bot/video-poker/selectors.js`.

## 15. Milestones

| # | Deliverable | Acceptance | Status |
|---|---|---|---|
| M0 | Shell: window + view + panel + registry + config + log tail | boots, toggles persist, log streams | **done** |
| M1 | Recon: login, casino, table, rules, models | docs/recon.md | **done** |
| M2 | Reader (`src/bot/blackjack/reader.js`) + live verification | exact cards/actions/result on real hands | **done** (3 hands) |
| M3 | Strategy + loop | legal play end to end, limits respected | **done** (10 live hands, incl. dealer BJ, push, split) |
| M4 | Live burn-in | 50 hands unattended at min bet | **done** (40 hands / 94 s, 0 errors; +10 earlier) |
| M5 | Guardrails + packaging | kill switch <1 action; portable `.exe` | kill switch **verified** (12 s abort, 0 hands after); packaging deferred |
| M6 | Video poker | exact EV play on all three variants | **done** (JoB 6 live hands, Deuces 4; engine tests) |
| M7 | Gym automation | energy/turn gating, stat choice, private floor, no caps | **done** (live sets, stat deltas verified, self-test `gymOpen/gymDry`) |
| M8 | Proxy | applied before load, optional auth, fail-closed | **done** (authenticating CONNECT proxy: 407 → login → tunnel; dead proxy blocks the load) |
| M9 | Discord alerts | alert/mail watcher, feature hooks, encrypted webhook | **done** (self-test delivers to a loopback webhook) |

## 15b. Video poker

Three machines in one modal: Jacks or Better 9/6, Bonus Poker 8/5 (80/40/25), Deuces Wild
(100/20/12/8/4/3/2/2/1). Paytables are read from the DOM and matched by row label, so a paytable
change is a data change, not a code change.

`src/bot/video-poker/`:

- `cards.js` — card encoding, category evaluator (including Deuces wilds), paytables.
- `strategy.js` — exact EV: all 32 hold patterns, every draw from the remaining 47 cards
  (2,598,960 hands per decision, ~0.5 s).
- `reader.js` — variant (from the active paytable), phase, five cards, held flags, wager, credits.
- `loop.js` — opens the game, selects the variant, sets the wager, deals, holds, draws, settles.
- `selectors.js` — video poker controls, importing the shared credit-badge selector.

Results are scored from the final five cards against the paytable, not from the credits badge
(which updates lazily). Validation lives in `test/video-poker.test.js`.

## 16. Testing

- `test/mock-table.html` (deferred) — would mirror the testid/aria-label contract for offline
  runs. Replaced for now by `recon/loop-harness.mjs`, which drives the real loop against the live
  table through CDP and asserts the hand count and final status.
- `test/strategy.test.js` — assert-based fixture checks for the fallback table (hard/soft/pairs).
- `test/blackjack.test.js` — offline session-loop regression checks.
- `test/llm.test.js` — mocked model-response validation.
- `test/video-poker.test.js` — hand-category and hold-strategy checks.
- `recon/gym-harness.mjs` — drives the real gym loop (dry and live). Covers the percentage gate,
  focus verification, the set cooldown and the post-set wait.
- `recon/proxy-test.mjs` — local CONNECT proxy that requires Basic auth; asserts `407 → login →
  tunnel` and that the game loads. `recon/proxy-noauth.mjs` covers the plain tunnel and
  `recon/proxy-config-test.mjs` the blank-password/keep semantics.
- `npm run self-test` — app boot, panel, IPC, config, credential store, feature wiring, proxy
  (`resolveProxy` + hidden secret + UI) and a real alert delivery to a loopback webhook.
- `recon/*.png` + `recon/hand.json` are the seed regression set for the vision prompt.
- `recon/loop-harness.mjs` writes `recon/burnin.log` and `recon/burnin-summary.json` per run;
  `KILL_AFTER_MS` aborts mid-run and asserts zero hands settle afterwards.
- The offline `test/*.test.js` suite stays private (it embeds account data); `npm run self-test` is
  the public entry point.
- M2–M4 acceptance runs are the integration test.

## 16b. Documentation

- `README.md` covers the platform: install/run, safety rails, config and the shared casino
  mechanics. Keep feature detail out of it.
- Each feature owns one file in `docs/`, named after its registry id (`docs/blackjack.md`,
  `docs/video-poker.md`). It documents how the feature reads the game, how it decides, its settings
  and its validation status.
- Registering a new feature means shipping that document and a row in the README Features table
  that links to it, in the same change. No feature sections in the README.

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Game update renames testids | Loop stalls | Shared and per-game selector files; unknown phase → stop, never blind-click |
| LLM proposes an illegal action | Bad click | Legal-action filter + disabled-button check + table fallback |
| DeepSeek misreads the hand | Wrong play | Reader is DOM; LLM sees only the parsed state, not an image |
| Credits drain | Lost in-game money | Min bet 10, stop-loss, 5% cap, dry-run first |
| Automation against the game's rules | Account action | Test account, human pacing, caps, stop on challenge; accept the risk explicitly |
| Casino presence check after sustained play | Run stops | Detected (`CASINO_PRESENCE_REQUIRED`), bot stops and asks for a human instead of answering it |
| Proxy misconfigured or down | Game unreachable | Fail-closed on purpose: no direct fallback; startup log names the proxy, panel shows the failed load |
| Alerts/mail API unavailable (auth or schema change) | Missed alert notifications | Watcher falls back to the header counters; persisted lastSeen still reports unread on the next poll |
| Discord rate limits | Dropped notifications | Serialized queue, `429` `retry_after` retry, 8 s throttle for gambling hands |
| Max energy changes | Gym gate drift | Gate and spend use percentages of the bar, never absolute energy |
| 9router down / key rotated | No decisions | Table fallback keeps playing legally; banner in panel |

## 18. Open questions

1. Keep `allowTableFallback` on? It means the bot keeps playing if 9router dies.
2. Bet size and stop-loss defaults for this account — currently 10 and 100.
3. Add the vision reader later as a cross-check once the loop has a few hundred hands?
4. Auto-travel to Playland (and other districts) when a feature needs it — deferred by the owner.
5. Presence-check trigger cadence: one observation (`sustained_play`) so far; is it time-based?
6. ~~Should the alert watcher force a page reload?~~ Resolved: it reads lpc-api alerts/mail
   endpoints from inside the page, so counters refresh without a visible reload.
7. Gambling alerts: is one message per hand (8 s throttle) useful, or should it be wins/big wins only?

## 19. Definition of done (v1)

Launch → log in once → optionally set the proxy and Discord webhook → toggle a feature. The bot opens
the right page, reads the live DOM, acts legally, and stops on its own limits or `Ctrl+Shift+X`.
Gym trains the chosen stat only when the bar covers the chosen share and a turn exists; blackjack and
video poker play their strategy and report P/L; alerts post to Discord as alerts/mail arrive and when
feature milestones happen. Every decision and stop reason is in the panel and the log.
