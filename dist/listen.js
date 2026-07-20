// Main `listen` loop: connect → subscribe → heartbeat → forward → report.
// Reconnects with exponential backoff on transient failures. Exits cleanly
// on TOKEN_REVOKED / SESSION_REVOKED and on SIGINT / SIGTERM.
import { createClient } from "@supabase/supabase-js";
import pc from "picocolors";
import { hostname } from "node:os";
import { CLI_VERSION, connect, disconnect, fetchEnvelope, heartbeat, reportDelivery, } from "./api.js";
import { API_URL, ANON_KEY, loadToken } from "./config.js";
import { forwardToLocal } from "./forward.js";
function resolveTarget(opts) {
    if (opts.forwardTo) {
        return new URL(opts.forwardTo);
    }
    if (opts.port) {
        const p = Number(opts.port);
        if (!Number.isInteger(p) || p < 1 || p > 65535) {
            throw new Error(`Invalid --port ${opts.port}`);
        }
        const path = opts.path && opts.path.startsWith("/") ? opts.path : `/${opts.path || ""}`;
        return new URL(`http://localhost:${p}${path}`);
    }
    throw new Error("Provide either --forward-to <url> or --port <n>.");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const seenAttempts = new Set();
async function handleEnvelope(token, target, envelope, timeoutSeconds, verbose) {
    if (seenAttempts.has(envelope.deliveryAttemptId))
        return;
    seenAttempts.add(envelope.deliveryAttemptId);
    // Cap dedup memory
    if (seenAttempts.size > 5000) {
        const first = seenAttempts.values().next().value;
        if (first)
            seenAttempts.delete(first);
    }
    // Fetch full envelope if broadcast omitted the body.
    let full = envelope;
    if (envelope.request.bodyEncoding === "external") {
        try {
            full = await fetchEnvelope(token, {
                deliveryAttemptId: envelope.deliveryAttemptId,
                sessionId: envelope.sessionId,
            });
        }
        catch (e) {
            const err = e;
            await reportDelivery(token, {
                sessionId: envelope.sessionId,
                deliveryAttemptId: envelope.deliveryAttemptId,
                status: "failed",
                error: { code: err.code || "ENVELOPE_FETCH_FAILED", message: err.message },
            }).catch(() => undefined);
            return;
        }
    }
    try {
        await reportDelivery(token, {
            sessionId: full.sessionId,
            deliveryAttemptId: full.deliveryAttemptId,
            status: "received_by_cli",
        });
    }
    catch (e) {
        if (verbose)
            console.error(pc.dim(`ack-local-delivery failed: ${e.message}`));
    }
    const report = await forwardToLocal(target, full, { timeoutSeconds, verbose });
    try {
        await reportDelivery(token, report);
    }
    catch (e) {
        if (verbose)
            console.error(pc.dim(`report-local-delivery failed: ${e.message}`));
    }
}
async function runSession(token, target, opts) {
    const deviceName = opts.deviceName || hostname() || "unknown-device";
    const timeoutSeconds = Math.min(60, Math.max(1, Number(opts.timeout || 10)));
    const verbose = Boolean(opts.verbose);
    let conn;
    try {
        conn = await connect(token, {
            endpointId: opts.endpoint,
            deviceName,
            localTarget: target.toString(),
            cliVersion: CLI_VERSION,
        });
    }
    catch (e) {
        const err = e;
        if (err.code === "TOKEN_REVOKED" || err.code === "TOKEN_EXPIRED" || err.code === "UNAUTHENTICATED") {
            console.error(pc.red(`Auth error: ${err.message}`));
            return "revoked";
        }
        console.error(pc.yellow(`Could not connect (${err.code || "error"}): ${err.message}`));
        return "retry";
    }
    console.log(pc.green(`✓ Connected`) +
        ` — endpoint ${pc.bold(conn.endpointId)} → ${pc.bold(target.toString())} (session ${conn.sessionId.slice(0, 8)})`);
    const rt = createClient(API_URL, ANON_KEY, {
        realtime: { params: {} },
        auth: { persistSession: false, autoRefreshToken: false },
    });
    rt.realtime.setAuth(conn.realtime.accessToken);
    let stopped = false;
    let hbTimer;
    let currentToken = conn.realtime.accessToken;
    const channel = rt.channel(conn.channel);
    channel.on("broadcast", { event: "local_forwarding.event" }, ({ payload }) => {
        const envelope = payload;
        if (!envelope || envelope.sessionId !== conn.sessionId)
            return;
        void handleEnvelope(token, target, envelope, timeoutSeconds, verbose);
    });
    let resolveDone;
    const doneP = new Promise((resolve) => {
        resolveDone = resolve;
    });
    const cleanup = async (why) => {
        if (stopped)
            return;
        stopped = true;
        if (hbTimer)
            clearInterval(hbTimer);
        try {
            await channel.unsubscribe();
        }
        catch {
            // ignore
        }
        try {
            await rt.removeAllChannels();
        }
        catch {
            // ignore
        }
        try {
            await disconnect(token, conn.sessionId);
        }
        catch {
            // ignore
        }
        resolveDone?.(why);
    };
    try {
        let subscribed = false;
        await new Promise((resolve, reject) => {
            channel.subscribe((status, err) => {
                if (status === "SUBSCRIBED") {
                    subscribed = true;
                    resolve();
                }
                else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                    const error = err || new Error(`Realtime ${status}`);
                    if (!subscribed) {
                        reject(error);
                    }
                    else if (!stopped) {
                        if (verbose)
                            console.error(pc.dim(`Realtime disconnected: ${error.message}`));
                        void cleanup("retry");
                    }
                }
            });
        });
    }
    catch (e) {
        console.error(pc.yellow(`Realtime subscription failed: ${e.message}`));
        await cleanup("retry");
        return "retry";
    }
    console.log(pc.dim(`Listening for events… (Ctrl+C to stop)`));
    // Heartbeat loop
    hbTimer = setInterval(async () => {
        try {
            const hb = await heartbeat(token, { sessionId: conn.sessionId });
            if (hb.revoked) {
                console.error(pc.red("Session or token revoked."));
                void cleanup("revoked");
            }
            else if (hb.accessToken && hb.accessToken !== currentToken) {
                currentToken = hb.accessToken;
                rt.realtime.setAuth(currentToken);
            }
            for (const envelope of hb.pendingDeliveries ?? []) {
                if (!envelope || envelope.sessionId !== conn.sessionId)
                    continue;
                void handleEnvelope(token, target, envelope, timeoutSeconds, verbose);
            }
        }
        catch (e) {
            if (verbose)
                console.error(pc.dim(`heartbeat failed: ${e.message}`));
        }
    }, conn.heartbeatIntervalSeconds * 1000);
    const onSignal = () => cleanup("revoked");
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const final = await doneP;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    return final;
}
export async function listen(opts) {
    const token = await loadToken();
    if (!token) {
        console.error(pc.red("No CLI token. Run `webhookpal login --token <token>` first."));
        return 1;
    }
    let target;
    try {
        target = resolveTarget(opts);
    }
    catch (e) {
        console.error(pc.red(e.message));
        return 1;
    }
    if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
        console.error(pc.red("Target must be an http://localhost URL."));
        return 1;
    }
    let attempt = 0;
    while (true) {
        const result = await runSession(token, target, opts);
        if (result === "revoked")
            return 0;
        attempt++;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        const jitter = Math.floor(Math.random() * 500);
        console.log(pc.dim(`Reconnecting in ${Math.round((delay + jitter) / 1000)}s…`));
        await sleep(delay + jitter);
    }
}
