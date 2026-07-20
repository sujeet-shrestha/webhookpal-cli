# Webhook Pal CLI (Beta)

Stream webhook events from [Webhook Pal](https://webhookpal.maplestack.com.au)
to a server running on your computer.

The CLI subscribes to a private Realtime channel for one of your Webhook Pal
sites and forwards every new event to a `http://localhost:...` URL. It preserves
the exact raw body, original query string, HTTP method, and safe headers.
Webhook Pal acknowledges the original provider itself, so a stopped local
server does not cause a delivery failure with Stripe, GitHub, or another
provider.

## Requirements

- A Webhook Pal account at <https://webhookpal.maplestack.com.au>
- At least one site (webhook endpoint) in the app
- Node.js 20 or later
- Git and terminal access
- A CLI token created in **Local Forwarding (CLI)** in the app

The beta CLI is installed from this repository. It is not currently published
to npm, so `npx @webhookpal/cli` will return `404 Not Found`.

## Install

The bundled installer works on macOS, Windows, and Linux without `sudo` or an
administrator shell:

```bash
git clone https://github.com/sujeet-shrestha/webhookpal-cli.git
cd webhookpal-cli
node scripts/install.mjs
```

Open a new terminal after installation, then verify the command:

```bash
webhookpal --help
```

The installer configures a user-local npm prefix (`~/.npm-global` on
macOS/Linux or `%APPDATA%\npm` on Windows), adds it to your `PATH`, and runs
`npm install`, `npm run build`, and `npm link`. If installation fails, it prints
OS-specific remediation. Do not run it with `sudo` or from an elevated shell.

## Step 1: Create and store a CLI token

1. Sign in to [Webhook Pal](https://webhookpal.maplestack.com.au).
2. Open **Local Forwarding (CLI)** in the sidebar.
3. Select **Create token**, give it a name, and copy the token immediately. It
   starts with `whp_cli_` and is only displayed once.
4. Store it with the CLI:

```bash
webhookpal login --token whp_cli_xxxxxxxxxxxx
```

The token is stored in macOS Keychain, Windows Credential Manager, or libsecret
when available. Otherwise it is stored in
`~/.config/webhookpal/credentials.json` with `0600` permissions. Never commit a
token.

For CI shells or password-manager injection, use `WEBHOOKPAL_TOKEN` instead:

```bash
export WEBHOOKPAL_TOKEN=whp_cli_xxxxxxxxxxxx
webhookpal listen --endpoint <SITE_ENDPOINT_UUID> --port 3000
```

In PowerShell:

```powershell
$env:WEBHOOKPAL_TOKEN = "whp_cli_xxxxxxxxxxxx"
webhookpal listen --endpoint <SITE_ENDPOINT_UUID> --port 3000
```

## Step 2: Start a local web server

Any local HTTP server works. For a minimal test, create `local-webhook.mjs`:

```js
import http from "node:http";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      console.log("\n--- Webhook received ---");
      console.log(req.method, req.url);
      for (const [key, value] of Object.entries(req.headers)) {
        if (key.startsWith("webhookpal-")) console.log(`${key}:`, value);
      }
      console.log("body:", body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  })
  .listen(3000, () => console.log("listening on http://localhost:3000"));
```

Run it in your first terminal:

```bash
node local-webhook.mjs
```

## Step 3: Start the CLI listener

Open a second terminal and run:

```bash
webhookpal listen \
  --endpoint <SITE_ENDPOINT_UUID> \
  --port 3000 \
  --path /webhooks \
  --verbose
```

PowerShell uses backticks for line continuation:

```powershell
webhookpal listen `
  --endpoint <SITE_ENDPOINT_UUID> `
  --port 3000 `
  --path /webhooks `
  --verbose
```

Get the endpoint UUID from the site's **Local Forwarding** card in the app.
When connected, both the terminal and app show the active session.

You can also specify the target directly:

```bash
webhookpal listen \
  --endpoint <SITE_ENDPOINT_UUID> \
  --forward-to http://localhost:3000/webhooks
```

Every CLI line has a local timestamp, such as
`[2026-07-19 14:03:22.481]`, to correlate CLI output with local server logs and
the event drawer.

### Listener options

| Flag | Description |
| --- | --- |
| `--endpoint <id>` | Site endpoint UUID to subscribe to. Required. |
| `--forward-to <url>` | Absolute `http://localhost` target URL. |
| `--port <n>` | Shortcut for `http://localhost:<n>`. |
| `--path </path>` | Path used with `--port`. Defaults to `/`. |
| `--device-name <name>` | Label shown in the app. Defaults to the OS hostname. |
| `--timeout <seconds>` | Local request timeout. Defaults to 10; maximum 60. |
| `--verbose` | Log each forwarded request and response. |

## Step 4: Send a test webhook

In the app, open your site and copy its **Webhook URL**. In a third terminal,
send a request to that exact URL:

```bash
curl -X POST "<WEBHOOK_URL_FROM_THE_APP>" \
  -H "content-type: application/json" \
  -d '{"hello":"from curl"}'
```

PowerShell users can run:

```powershell
Invoke-RestMethod -Method Post `
  -Uri "<WEBHOOK_URL_FROM_THE_APP>" `
  -ContentType "application/json" `
  -Body '{"hello":"from powershell"}'
```

You should see:

1. `local-webhook.mjs` prints the request and its `webhookpal-*` headers.
2. `webhookpal listen` logs a `200` response.
3. The app's event drawer shows a **Local deliveries** row with
   **Succeeded / 200**.

## Step 5: Test replay

1. Stop `local-webhook.mjs` with `Ctrl+C`.
2. Send another webhook. Its local delivery should fail with
   `ECONNREFUSED`.
3. Restart the server with `node local-webhook.mjs`.
4. Open the event in the app and select **Replay to local**.
5. Confirm that a new successful local-delivery row appears.

## Step 6: Test disconnect and reconnect

Temporarily disconnect your network or close the listener. The session becomes
stale in the app. Restore the connection and restart the listener if necessary;
the CLI reconnects automatically with exponential backoff while it is running.

## Step 7: Clean up

- Press `Ctrl+C` in the listener terminal to disconnect.
- Run `webhookpal logout` to remove the locally stored token.
- Optionally revoke the token in the app so it can never be reused.

## Status and logout

```bash
webhookpal status
webhookpal logout
```

`status` shows whether a token is configured. `logout` removes the stored
credential.

## What is forwarded

- Exact raw body bytes without JSON re-serialization.
- Original HTTP method and query string, merged with the target query.
- Safe request headers, with hop-by-hop headers such as `connection`, `host`,
  `content-length`, `transfer-encoding`, and `upgrade` removed.
- Webhook Pal metadata headers:
  - `WebhookPal-Event-Id`
  - `WebhookPal-Delivery-Attempt-Id`
  - `WebhookPal-Delivery-Source: live | manual_replay`
  - `WebhookPal-Original-Received-At`

## Security

- Only `http://localhost`, `http://127.0.0.1`, and `http://[::1]` targets are
  accepted. LAN targets, public URLs, and local HTTPS are not supported during
  beta.
- Response cookies, `authorization`, and `proxy-authorization` headers are
  redacted before storage.
- Response bodies larger than 64 KB are truncated.
- Revoking a CLI token terminates its live sessions.

## Troubleshooting

- **Connection refused:** confirm the local server is running on the port passed
  to `--port`.
- **`TOKEN_REVOKED`:** create a new token in the app and run `webhookpal login`
  again.
- **Nothing arrives:** confirm `--endpoint` matches the UUID in the site's Local
  Forwarding card and that the site is not paused.
- **Local HTTPS:** unsupported; use a plain `http://localhost` target.
- **npm `EACCES`, `EPERM`, or “Access is denied”:** rerun
  `node scripts/install.mjs`. Do not use `sudo` or an elevated shell.
- **`webhookpal: command not found`:** open a new terminal after installation so
  the updated `PATH` is loaded.
- **PowerShell blocks `webhookpal`:** run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **libsecret is unavailable on Linux:** install `libsecret-1-0` and a compatible
  keyring, or use the `WEBHOOKPAL_TOKEN` environment variable.

## Beta and support

The CLI is in beta and its command shapes may change. For help or to report an
issue, email [support.webhookpal@maplestack.com.au](mailto:support.webhookpal@maplestack.com.au).

Web app: <https://webhookpal.maplestack.com.au>
