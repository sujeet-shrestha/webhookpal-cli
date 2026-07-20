#!/usr/bin/env node
// Cross-platform Webhook Pal CLI installer (macOS, Linux, Windows).
//
// - Configures a user-local npm prefix so `npm link` never needs sudo/admin.
//     macOS/Linux: ~/.npm-global
//     Windows:     %APPDATA%\npm  (npm's own default user location)
// - Adds that prefix's bin directory to PATH (shell rc on Unix, user env on Windows).
// - Builds the CLI and links it globally as `webhookpal`.
// - On permission errors, prints clear step-by-step remediation for the current OS.
//
// Usage:  node scripts/install.mjs        (from the cli/ directory, or anywhere)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IS_WINDOWS = platform() === "win32";
const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
const info = (m) => console.log(c.cyan(`▸ ${m}`));
const ok = (m) => console.log(c.green(`✓ ${m}`));
const warn = (m) => console.log(c.yellow(`! ${m}`));
const err = (m) => console.error(c.red(`✗ ${m}`));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? CLI_DIR,
    shell: IS_WINDOWS, // needed so `npm`/`npm.cmd` resolves on Windows
    env: process.env,
  });
  if (r.status !== 0) {
    const e = new Error(`${cmd} ${args.join(" ")} exited with code ${r.status}`);
    e.exitCode = r.status ?? 1;
    throw e;
  }
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: IS_WINDOWS });
  return (r.stdout || "").trim();
}

function printPermissionsHelp() {
  console.error();
  err("npm reported a permissions error.");
  if (IS_WINDOWS) {
    console.error(`
This usually means the npm global prefix points at a location your user
account cannot write to (e.g. Program Files). Fix it once:

  ${c.cyan("1.")} Open PowerShell (not Administrator) and set a user prefix:
       npm config set prefix "$env:APPDATA\\npm"

  ${c.cyan("2.")} Add it to your user PATH permanently:
       [Environment]::SetEnvironmentVariable("Path",
         "$env:APPDATA\\npm;" + [Environment]::GetEnvironmentVariable("Path","User"),
         "User")

  ${c.cyan("3.")} Close and reopen your terminal (so PATH refreshes), then re-run:
       node scripts/install.mjs

Do not run this installer from an elevated (Administrator) prompt — it
recreates the same permissions mismatch on the next install.
`);
  } else {
    const prefix = process.env.NPM_PREFIX || join(homedir(), ".npm-global");
    console.error(`
This usually means npm's global prefix points at a system directory
(e.g. /usr/local) that your user cannot write to. Fix it once:

  ${c.cyan("1.")} Create a user-owned prefix:
       mkdir -p "${prefix}"
       npm config set prefix "${prefix}"

  ${c.cyan("2.")} Add it to your PATH (pick the file your shell uses):
       echo 'export PATH="${prefix}/bin:$PATH"' >> ~/.zshrc     # zsh (macOS default)
       echo 'export PATH="${prefix}/bin:$PATH"' >> ~/.bashrc    # bash

  ${c.cyan("3.")} Reload your shell:
       source ~/.zshrc     # or: source ~/.bashrc

  ${c.cyan("4.")} Re-run this installer:
       node scripts/install.mjs

If a previous install left root-owned files in your cache, fix them:
       sudo chown -R $(id -u):$(id -g) ~/.npm

Never run this installer with sudo — it recreates the same problem.
`);
  }
}

function ensureUnixPathLine(rcPath, prefix) {
  if (!existsSync(rcPath)) return false;
  const contents = readFileSync(rcPath, "utf8");
  if (contents.includes(`${prefix}/bin`)) return false;
  appendFileSync(
    rcPath,
    `\n# Added by webhookpal installer\nexport PATH="${prefix}/bin:$PATH"\n`,
  );
  return true;
}

function ensureWindowsPath(prefix) {
  // Read current user PATH via reg query, prepend prefix if missing, write with setx.
  const current =
    capture("powershell", [
      "-NoProfile",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path','User')",
    ]) || "";
  const parts = current.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === prefix.toLowerCase())) return false;
  const next = [prefix, ...parts].join(";");
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `[Environment]::SetEnvironmentVariable('Path', ${JSON.stringify(next)}, 'User')`,
    ],
    { stdio: "inherit" },
  );
  return r.status === 0;
}

async function main() {
  // Preflight
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) {
    err(`Node ${nodeMajor} detected. Node 20 or later is required.`);
    process.exit(1);
  }
  const npmVersion = capture(IS_WINDOWS ? "npm.cmd" : "npm", ["--version"]);
  if (!npmVersion) {
    err("npm is not installed or not on PATH. Install Node 20+ and re-run.");
    process.exit(1);
  }

  // Choose prefix per platform
  const desiredPrefix = IS_WINDOWS
    ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm")
    : process.env.NPM_PREFIX || join(homedir(), ".npm-global");
  const binDir = IS_WINDOWS ? desiredPrefix : join(desiredPrefix, "bin");

  info(`CLI directory: ${CLI_DIR}`);
  info(`npm prefix:    ${desiredPrefix}`);

  mkdirSync(binDir, { recursive: true });

  const currentPrefix = capture(IS_WINDOWS ? "npm.cmd" : "npm", ["config", "get", "prefix"]);
  if (currentPrefix !== desiredPrefix) {
    info(`Setting npm prefix (was: ${currentPrefix || "unset"})`);
    run(IS_WINDOWS ? "npm.cmd" : "npm", ["config", "set", "prefix", desiredPrefix]);
  } else {
    ok("npm prefix already configured");
  }

  // PATH persistence
  if (IS_WINDOWS) {
    if (ensureWindowsPath(desiredPrefix)) {
      ok(`Added ${desiredPrefix} to user PATH (restart your terminal to pick it up)`);
    } else {
      console.log(c.dim("PATH already contains the npm prefix"));
    }
  } else {
    const rcs = [];
    const shell = process.env.SHELL || "";
    if (shell.includes("zsh")) rcs.push(join(homedir(), ".zshrc"));
    else if (shell.includes("bash"))
      rcs.push(join(homedir(), ".bashrc"), join(homedir(), ".bash_profile"));
    else rcs.push(join(homedir(), ".profile"));
    for (const rc of rcs) {
      if (ensureUnixPathLine(rc, desiredPrefix)) ok(`Added npm prefix to PATH in ${rc}`);
    }
    // Make it available for this process too (so `npm link` below can write).
    process.env.PATH = `${binDir}:${process.env.PATH || ""}`;
  }

  // Install, build, link
  const npm = IS_WINDOWS ? "npm.cmd" : "npm";
  info("Installing dependencies (npm install)…");
  run(npm, ["install", "--no-audit", "--no-fund"]);
  info("Building CLI (npm run build)…");
  run(npm, ["run", "build"]);
  info("Linking CLI globally as 'webhookpal'…");
  run(npm, ["link"]);

  console.log();
  ok("Installed. Open a new terminal window, then run:");
  console.log("    webhookpal --version");
  console.log("    webhookpal login --token whp_cli_xxxxxxxx");
  console.log("    webhookpal listen --endpoint <site-id> --port 3000");
}

main().catch((e) => {
  const msg = String(e?.message || e || "");
  if (/EACCES|EPERM|permission denied|Access is denied/i.test(msg)) {
    printPermissionsHelp();
  } else {
    err(msg);
  }
  process.exit(e?.exitCode ?? 1);
});
