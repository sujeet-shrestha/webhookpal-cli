// Runtime configuration and credential storage for the Webhook Pal CLI.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
// @lovable:prod-replace-api-url — the next line is rewritten by release-cli-prod.yml
export const API_URL = process.env.WEBHOOKPAL_API_URL || 'https://webhookpal-site.maplestack.com.au';
// @lovable:prod-replace-anon-key — the next line is rewritten by release-cli-prod.yml
export const ANON_KEY = process.env.WEBHOOKPAL_ANON_KEY || 'sb_publishable_r7r4zngA7z5fPBTwSGTFvg_L5w3iT6g';
const KEYRING_SERVICE = "webhookpal";
const KEYRING_ACCOUNT = "cli-token";
function credsPath() {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    return join(base, "webhookpal", "credentials.json");
}
async function tryKeytar() {
    try {
        const mod = await import("keytar");
        return (mod.default ?? mod);
    }
    catch {
        return null;
    }
}
export async function saveToken(token) {
    const keytar = await tryKeytar();
    if (keytar) {
        try {
            await keytar.setPassword(KEYRING_SERVICE, KEYRING_ACCOUNT, token);
            return "keychain";
        }
        catch {
            // fall through
        }
    }
    const p = credsPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ token }, null, 2));
    try {
        chmodSync(p, 0o600);
    }
    catch {
        // best effort on non-POSIX
    }
    return "file";
}
export async function loadToken() {
    if (process.env.WEBHOOKPAL_TOKEN)
        return process.env.WEBHOOKPAL_TOKEN;
    const keytar = await tryKeytar();
    if (keytar) {
        try {
            const t = await keytar.getPassword(KEYRING_SERVICE, KEYRING_ACCOUNT);
            if (t)
                return t;
        }
        catch {
            // fall through
        }
    }
    const p = credsPath();
    if (!existsSync(p))
        return null;
    try {
        const { token } = JSON.parse(readFileSync(p, "utf8"));
        return token || null;
    }
    catch {
        return null;
    }
}
export async function clearToken() {
    const keytar = await tryKeytar();
    if (keytar) {
        try {
            await keytar.deletePassword(KEYRING_SERVICE, KEYRING_ACCOUNT);
        }
        catch {
            // ignore
        }
    }
    const p = credsPath();
    if (existsSync(p)) {
        try {
            unlinkSync(p);
        }
        catch {
            // ignore
        }
    }
}
