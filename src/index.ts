#!/usr/bin/env node
// @webhookpal/cli entrypoint.

import { Command } from "commander";
import pc from "picocolors";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clearToken, loadToken, saveToken } from "./config.js";
import { listen } from "./listen.js";
import { installTimestampedConsole } from "./logger.js";

installTimestampedConsole();


const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string; name: string };

const program = new Command();
program
  .name("webhookpal")
  .description("Stream Webhook Pal events to a local HTTP server (beta).")
  .version(pkg.version);

program
  .command("login")
  .description("Store a CLI token securely on this machine.")
  .option("--token <token>", "CLI token (whp_cli_...)")
  .action(async (opts: { token?: string }) => {
    const token = opts.token || process.env.WEBHOOKPAL_TOKEN;
    if (!token) {
      console.error(pc.red("Provide --token <token> or set WEBHOOKPAL_TOKEN."));
      process.exit(1);
    }
    if (!token.startsWith("whp_cli_")) {
      console.error(pc.red("Token does not look like a Webhook Pal CLI token (whp_cli_...)."));
      process.exit(1);
    }
    const where = await saveToken(token);
    console.log(
      pc.green("✓ Token saved") +
        pc.dim(where === "keychain" ? " (OS keychain)" : " (~/.config/webhookpal/credentials.json, mode 0600)"),
    );
  });

program
  .command("logout")
  .description("Remove the stored CLI token.")
  .action(async () => {
    await clearToken();
    console.log(pc.green("✓ Token removed"));
  });

program
  .command("status")
  .description("Show whether a token is configured.")
  .action(async () => {
    const t = await loadToken();
    if (!t) {
      console.log(pc.dim("No token configured. Run `webhookpal login --token <token>`."));
      return;
    }
    const prefix = t.slice(0, 12);
    console.log(pc.green("✓ Token configured") + pc.dim(` (${prefix}…)`));
  });

program
  .command("listen")
  .description("Subscribe to a site and forward events to localhost.")
  .requiredOption("--endpoint <id>", "Site (endpoint) UUID")
  .option("--forward-to <url>", "Full http://localhost URL")
  .option("--port <n>", "Shortcut for http://localhost:<n>")
  .option("--path <path>", "Path to append when using --port", "/")
  .option("--device-name <name>", "Label for the dashboard")
  .option("--timeout <s>", "Local request timeout seconds (1-60)", "10")
  .option("--verbose", "Verbose logging")
  .action(async (opts) => {
    const code = await listen(opts);
    process.exit(code);
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(pc.red(`Fatal: ${(e as Error).message}`));
  process.exit(1);
});
