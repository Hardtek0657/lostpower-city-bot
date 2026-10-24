# Lost Power City Bot

Desktop automation panel for [Lost Power City](https://lostpower.com). The app embeds the game
in a window and puts a control panel next to it: each feature is a toggle with its own settings,
session stats and status. Features read the live page, act at a human pace, and stop on their own
limits or on anything that needs a person — no blind clicking.

The first two features automate the Playland Casino; gym automation handles the City Gym. New
features are added as modules in `src/bot/registry.js` and show up in the panel automatically, with
their own settings, dry run and kill-switch behaviour.

Automation is very likely against the game's rules — use a throwaway account.

## Features

| Feature | What it does | How it decides |
|---|---|---|
| [Blackjack autopilot](docs/blackjack.md) | Opens the Playland Casino blackjack table, reads each hand and plays it | Basic-strategy table by default (S17, DAS); optional model cross-check or full model play |
| [Gym automation](docs/gym.md) | City Gym: trains Strength, Speed or Guard at a chosen share of max energy (private gym optional) | Deterministic energy and turn checks; no model |
| [Video poker](docs/video-poker.md) | Plays Jacks or Better 9/6, Bonus Poker 8/5 and Deuces Wild | Exact expected value over all 32 hold patterns for the posted paytable |

Both support dry run (open and prepare, never commit a bet), max hands, stop loss, a session time
cap, human-paced clicking and a global kill switch.

Feature detail lives in its own document — `docs/blackjack.md` and `docs/video-poker.md` above. New
features must add a `docs/<feature>.md` and link it from this table; see the documentation
convention in [Plan.md](Plan.md#16b-documentation).

## Project structure

```text
src/
  main.js                   Electron lifecycle, game view, IPC and feature control
  config.js                 Settings persistence and encrypted credentials
  preload.cjs               Panel-to-main-process bridge
  panel/
    index.html              Feature controls and session display
    panel.js                Panel events and rendering
    panel.css               Panel styles
  bot/
    registry.js             Feature definitions, settings and entry points
    pacing.js               Shared human-paced action delays
    selectors.js            Shared login, casino and credit-badge selectors
    blackjack/
      loop.js               Table navigation, actions, limits and presence checks
      reader.js             DOM-to-hand-state extraction
      selectors.js          Blackjack-specific DOM selectors
      strategy-table.js     Deterministic basic strategy
      strategy.js           Optional model decisions and table fallback
    video-poker/
      loop.js               Game selection, holds, draws and session limits
      reader.js             DOM-to-hand-state extraction
      selectors.js          Video-poker-specific DOM selectors
      cards.js              Card encoding, hand evaluation and paytables
      strategy.js           Expected-payout calculation for all hold patterns
    gym/
      loop.js               Route choice, energy gate, focus and training sets
      reader.js             Gym state, energy meter and set preview
      selectors.js          Gym-specific DOM selectors
docs/
  recon.md                  Recorded DOM contract and rule observations
  blackjack.md              Feature doc: blackjack autopilot
  gym.md                    Feature doc: gym automation
  video-poker.md            Feature doc: video poker
Plan.md                     Design notes and implementation history
package.json                Dependencies and scripts
```

The offline test suite and the live recon harnesses are intentionally not published: they contain
a test account's credentials and captured account data. `docs/recon.md` documents the DOM contract
they verified.

Keep game-specific code inside its feature folder. Shared bot utilities belong in `src/bot/`;
application-wide code belongs directly in `src/`.

## Requirements

- Windows, Node 20+
- For blackjack `audit` or `llm` mode only: 9router (`http://127.0.0.1:20128/v1`) with the configured model available
- A game account (the bot does not create one)

## Run

```bash
npm install
npm start
```

1. The game window opens on the left, the panel on the right.
2. Log in **once** in the game window. The session is stored in the `persist:lostpower` partition.
   Or fill in the **ACCOUNT** block and enable **Auto login** to sign in on every launch.
3. Expand a feature, set its options, turn off **Dry run**, flip the toggle.

`Ctrl+Shift+X` stops everything. Dry run opens the game and prepares the next action but never
commits a bet. The panel's session strip shows hands played, session P/L, model/table agreement and
tokens spent; the finish log line carries the same totals.

The session strip is shared across features, so it always describes whichever feature is running.
**Pop out** opens the log in its own window.

### Auto login

The ACCOUNT block stores a username and password and fills the login form automatically when the app
starts or lands on `/#/login` again (session expiry). The password is encrypted with the OS keystore
(`safeStorage`/DPAPI) and is never sent back to the panel — it only shows "saved". **Clear** removes
the stored username and password.

Leave it off to sign in by hand; the persistent session still keeps you logged in between launches
until the cookie expires.

### Where the bot is allowed to go

The game view stays where the game redirected it after login. A feature only navigates when it is
toggled on, and only starts at all if its toggle is on. The casino additionally requires the
character to be in Playland; if the game answers with a travel prompt the feature pauses with
`travel required` rather than guessing. Automatic travel is a future feature.

## Safety rails

- **Kill switch** — `Ctrl+Shift+X` aborts the running feature immediately, including mid-decision.
- **Dry run** — default on; opens and prepares but never commits a bet.
- **Caps** — max hands, stop loss and a session time limit are checked between hands.
- **Human pacing** — jittered delays with occasional longer beats, not fixed-interval clicking.
- **Pause, don't guess** — presence checks, required travel and unexpected table states stop the run
  with an actionable message instead of retrying blindly.

## Casino presence checks

After sustained play the casino can ask for a presence check. It is **not an image CAPTCHA**: the
API refuses the deal and returns a challenge the page renders as a "Quick table check":

```json
{"message":"CASINO_PRESENCE_REQUIRED","challenge":{
  "token":"0bceea5b…","prompt":"Quick table check: tap LPC to continue.",
  "options":["SEVEN","CHERRY","LPC","LEMON"],
  "expiresAt":"2026-10-22T21:06:36.000Z","reason":"sustained_play"}}
```

Observed 2026-10-22 (one occurrence):

| Detail | Observation |
|---|---|
| Trigger | `reason: "sustained_play"` |
| Where it blocks | the next `POST /blackjack/start`; the DEAL click just does nothing |
| Form | tap the option named in the prompt (`LPC` in the sample) in the game window |
| Lifetime | the token expired in about 2 minutes |

When a deal is refused the loop checks the page for the challenge text, logs
`casino presence check`, sets the status to **PAUSED** (amber) with
`presence check clear it in the game window`, clears the running slot and turns the feature off.
Clear the check in the game window, then flip the feature back on. If the prompt disappears before
you reach it, the token expired and the next start deals normally.

Two consequences worth knowing: detection keys off the refused deal, so one deal click is spent
before the bot notices, and the trigger cadence is not mapped yet, so it may be time-based.

## Config

`%APPDATA%\lostpower-bot\config.json` — router URL, model ids, feature settings. The API key
(when set) is encrypted with Windows DPAPI via Electron `safeStorage`. Feature defaults are listed
in each feature's document ([blackjack](docs/blackjack.md), [video poker](docs/video-poker.md)).

## Tests

`npm run self-test` boots the app headlessly and checks the panel, IPC, config persistence, the
feature toggles, the log window and the credential store. It is the only test entry point in this
repository — the offline suite and live harnesses are kept private because they embed account
credentials.
