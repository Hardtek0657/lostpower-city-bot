# Proxy

Routes the game view through an HTTP, HTTPS or SOCKS5 proxy. The setting is applied to the
`persist:lostpower` session **before the game URL is loaded**, so a configured proxy never lets a
request leave over the direct connection.

## Settings

| Field | Notes |
|---|---|
| Use proxy | off by default |
| Protocol | `http`, `https` or `socks5` |
| Host | IP or hostname, e.g. `127.0.0.1` |
| Port | 1–65535 |
| Username / Password | optional; leave both blank for IP-allowlist proxies |

Save applies the proxy, stores the password encrypted with the OS keystore (`safeStorage`/DPAPI) and
reloads the game view so the new route takes effect immediately. The panel never receives the saved
password back — it shows `•••• saved`.

## Ordering

- Startup: `applyProxy()` runs in `createWindow()` before `webContents.loadURL()`. With the proxy
  enabled the session is set first; with it disabled the session is explicitly put in `direct` mode.
- Invalid config (enabled but missing host/port) falls back to a direct connection and logs
  `proxy off — direct connection` instead of failing silently.
- Loopback bypass is disabled (`<-loopback>`), so localhost targets also go through the proxy.

## Authentication

- Username + password: the app answers Electron's proxy `login` challenge with the stored
  credentials. A wrong password simply fails the load — nothing is retried in a loop.
- Blank username and password: no `Proxy-Authorization` is sent, which is what IP-allowlist proxies
  expect.
- **Blank password on save keeps the stored one** — so editing host/port doesn't wipe auth. Use
  **clear auth** on the proxy card to remove the username and password explicitly.
- SOCKS5 uses the `socks5://` scheme, so hostnames are resolved by the proxy rather than locally.

## Persistence

`enabled`, `protocol`, `host`, `port`, `username` and the encrypted password live in `config.json`.
On every launch `applyProxy()` runs before `loadURL()`, so the saved state decides the route:

- enabled → the session is proxied first; if the proxy is unreachable the load fails with
  `ERR_PROXY_CONNECTION_FAILED` and nothing is fetched directly (fail-closed, no silent fallback).
- disabled → the session is explicitly put in `direct` mode before the game loads.

## Verification

Exercised against a local CONNECT proxy that demands `Basic` auth: Electron receives the `407`,
the app's `login` handler supplies the credentials, the tunnel opens and `lostpower.com` loads
(`407 → login-challenge → auth-ok`). A direct (no-proxy) tunnel was verified the same way.

## Scope

Only the game session is proxied. The panel is a local `file://` page and never leaves the machine.
Changing the proxy while a feature is running reloads the game view, which stops that run.
