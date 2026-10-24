# Alerts

Sends Discord webhook messages so you get a ping without watching the game window.

## What it watches

| Source | Trigger | Default |
|---|---|---|
| In-game alerts | unread alert count increases | on |
| In-game e-mail | unread mail count increases | on |
| Gym sets | one message per completed training set, with stat delta | on |
| Gambling hands | one message per blackjack / video-poker hand with its result | on |
| Session summary | a feature ends: hands played, P/L and why it stopped | on |

The watcher reads the game's own JSON API from inside the page (session cookies included), so it
does not need a page refresh:

- `https://lpc-api.lostpower.com/api/alerts?limit=3&offset=0` → `unreadCount` + the newest alert's
  title and message.
- `https://lpc-api.lostpower.com/api/mail/summary` → `unreadCount`.

If either call fails the watcher falls back to the header counters (`Alerts (n)`, `E-Mail (n)`),
reading both the side nav text and the mobile `aria-label`.

The last seen counts **and the last alert id** are persisted in `config.json`, so:

- an alert that arrived while the app was closed is reported on the next launch (once);
- restarting does not re-report the same alert;
- a new alert is detected even when an older one is still unread (same count, new id).

## Setup

1. Discord → Server Settings → Integrations → Webhooks → New Webhook → Copy URL.
2. Panel → **ALERTS** → paste the URL, tick **Discord alerts**, Save.
3. **test** sends a one-off message to confirm the webhook works.

The webhook URL is stored encrypted with the OS keystore (`safeStorage`/DPAPI) and is never sent
back to the panel — it shows `•••• saved`. Only `https://discord.com/api/webhooks/<id>/<token>` (plus
`canary.`/`ptb.` and loopback URLs for tests) is accepted.

## Behaviour

- Notification kinds are independent toggles, so you can keep session summaries while muting
  per-hand spam, or the reverse.
- Gambling hand messages are throttled to one per 8 seconds; session summaries and gym sets are not
  throttled (a gym set is at most once every few seconds).
- Messages are queued and sent sequentially. A Discord `429` is honoured via `retry_after` and
  retried once.
- The watcher keeps running while the app is open, whether or not a feature is active; it stops
  when alerts are off or the game view is gone.

## Payload

```json
{"username":"LostPower Bot","embeds":[{
  "title":"Gym set complete",
  "description":"strength 25% (37 energy, +17 – +21) · strength 77 → 94 · energy 60% → 35%",
  "color": 5111656, "timestamp": "…"}]}
```

In-game alerts include the alert itself:

```json
{"title":"New in-game alert",
 "description":"Mining Shift Complete: Old Iron Shaft has finished. Your sealed shift report is waiting at the Mining District for collection."}
```
