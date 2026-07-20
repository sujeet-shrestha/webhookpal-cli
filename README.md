# @webhookpal/cli (Beta)

> Stream webhook events from Webhook Pal to a server running on your laptop.

The CLI subscribes to a private Realtime channel for one of your Webhook Pal
sites and forwards every new event to a `http://localhost:...` URL of your
choosing — with the exact raw body, method, safe headers and original query.
Webhook Pal always ACKs the original provider itself, so a crashed local
server never causes a delivery failure with Stripe, GitHub, or anyone else.

## Requirements

- Node.js 20 or later
- A Webhook Pal account and at least one site
- A CLI token (create one on the Local Forwarding page)
- The beta CLI source checkout

## Install

Beta install from the public CLI repo (cross-platform, no sudo / no admin):

```bash
git clone https://github.com/sujeet-shrestha/webhookpal-cli.git
cd webhookpal-cli
node scripts/install.mjs
webhookpal --version
```

The installer configures a user-local npm prefix (`~/.npm-global` on
macOS/Linux, `%APPDATA%\npm` on Windows), adds it to your PATH, then runs
`npm install`, `npm run build`, and `npm link`. If npm still reports a
permissions error it prints step-by-step remediation for your OS. Never run
it with `sudo` / from an elevated shell.

The npm package is not published during beta, so `npx @webhookpal/cli ...`
will return `404 Not Found`. Use the installed `webhookpal` command instead.


## Login

```bash
webhookpal login --token whp_cli_xxxxxxxxxxxx
```

For CI shells and password-manager pastes, prefer the env var:

```bash
export WEBHOOKPAL_TOKEN=whp_cli_xxxxxxxxxxxx
webhookpal listen --endpoint <site-id> --port 3000
```

The token is stored in your OS keychain when available (macOS Keychain,
Windows Credential Vault, libsecret). Otherwise it falls back to a
`~/.config/webhookpal/credentials.json` file with `0600` permissions.

## Listen

```bash
webhookpal listen \
  --endpoint <site-id> \
  --forward-to http://localhost:3000/webhooks
```

Shortcut form:

```bash
webhookpal listen --endpoint <site-id> --port 3000 --path /webhooks
```

Options:

| Flag                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `--endpoint <id>`   | Site (endpoint) UUID to subscribe to. Required.               |
| `--forward-to <url>`| Absolute `http://localhost` URL.                              |
| `--port <n>`        | Shortcut for `http://localhost:<n>`.                          |
| `--path </p>`       | Path appended when `--port` is used. Defaults to `/`.         |
| `--device-name <s>` | Label shown in the dashboard. Defaults to the OS hostname.    |
| `--timeout <s>`     | Local request timeout. Default 10, max 60.                    |
| `--verbose`         | Log each request and response.                                |

The command runs until you press `Ctrl+C`. On exit it best-effort disconnects
its session so the dashboard reflects reality immediately.

Every CLI line is prefixed with a local timestamp such as
`[2026-07-19 14:03:22.481]` so output correlates cleanly with your local
server logs and the event drawer in the app.


## Status

```bash
webhookpal status
```

Prints whether a token is stored and the account it belongs to.

## Logout

```bash
webhookpal logout
```

Removes the stored credential.

## What is forwarded

- Exact raw body bytes — no JSON re-serialization.
- Original HTTP method and raw query string (merged with your target's query).
- All safe headers, with hop-by-hop headers removed (`connection`, `host`,
  `content-length`, `transfer-encoding`, `upgrade`, etc.).
- Extra Webhook Pal metadata headers:
  - `WebhookPal-Event-Id`
  - `WebhookPal-Delivery-Attempt-Id`
  - `WebhookPal-Delivery-Source: live | manual_replay`
  - `WebhookPal-Original-Received-At`

## Security

- Only `http://localhost`, `http://127.0.0.1`, and `http://[::1]` targets are
  accepted. No LAN, no public URLs, no HTTPS local targets in the beta.
- Response cookies, `authorization`, and `proxy-authorization` headers are
  redacted before Webhook Pal stores them.
- Response bodies larger than 64 KB are truncated.
- Token revocation kicks live sessions immediately.

## Beta

This CLI is in beta. Command shapes may change in a future release. Report
issues at support@tech-o.dev.
