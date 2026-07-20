// Forward a Webhook Pal envelope to a local HTTP target. Returns a delivery
// report ready for report-local-delivery.
const MAX_BODY_BYTES = 64 * 1024;
// Hop-by-hop / unsafe headers that must not be forwarded to the local target.
const STRIP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
]);
function base64ToBytes(b64) {
    const bin = Buffer.from(b64, "base64");
    return new Uint8Array(bin);
}
function bytesToBase64(bytes) {
    return Buffer.from(bytes).toString("base64");
}
function isValidUtf8(bytes) {
    try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        return decoder.decode(bytes);
    }
    catch {
        return null;
    }
}
function mergeQuery(targetUrl, incomingQuery) {
    const merged = new URL(targetUrl.toString());
    if (incomingQuery) {
        const incoming = new URLSearchParams(incomingQuery.startsWith("?") ? incomingQuery.slice(1) : incomingQuery);
        for (const [k, v] of incoming.entries()) {
            merged.searchParams.append(k, v);
        }
    }
    return merged;
}
export async function forwardToLocal(target, envelope, opts) {
    const url = mergeQuery(target, envelope.request.query);
    // Build headers
    const headers = new Headers();
    for (const [name, values] of Object.entries(envelope.request.headers)) {
        if (STRIP.has(name.toLowerCase()))
            continue;
        for (const v of values)
            headers.append(name, v);
    }
    for (const [name, value] of Object.entries(envelope.metadata.headers)) {
        // Convert lowercase metadata keys back to WebhookPal-Foo style.
        const canonical = name
            .split("-")
            .map((p) => (p === "id" ? "Id" : p.charAt(0).toUpperCase() + p.slice(1)))
            .join("-");
        headers.set(canonical, value);
    }
    const body = envelope.request.body ? base64ToBytes(envelope.request.body) : undefined;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.max(1, opts.timeoutSeconds) * 1000);
    const requestSentAt = new Date().toISOString();
    const started = Date.now();
    try {
        const res = await fetch(url.toString(), {
            method: envelope.request.method || "POST",
            headers,
            body: body && body.byteLength > 0 ? body : undefined,
            signal: ac.signal,
        });
        const responseReceivedAt = new Date().toISOString();
        const durationMs = Date.now() - started;
        // Response body capture
        const raw = new Uint8Array(await res.arrayBuffer());
        let truncated = false;
        let sliced = raw;
        if (raw.byteLength > MAX_BODY_BYTES) {
            sliced = raw.slice(0, MAX_BODY_BYTES);
            truncated = true;
        }
        const asText = isValidUtf8(sliced);
        const bodyPayload = asText !== null
            ? { body: asText, bodyEncoding: "utf8" }
            : { body: bytesToBase64(sliced), bodyEncoding: "base64" };
        // Response headers → Record<string,string[]>
        const respHeaders = {};
        res.headers.forEach((v, k) => {
            const n = k.toLowerCase();
            (respHeaders[n] ??= []).push(v);
        });
        if (opts.verbose) {
            console.log(`→ ${envelope.request.method} ${url.toString()}  ${res.status}  ${durationMs}ms${truncated ? "  [truncated]" : ""}`);
        }
        return {
            sessionId: envelope.sessionId,
            deliveryAttemptId: envelope.deliveryAttemptId,
            status: "succeeded",
            requestSentAt,
            responseReceivedAt,
            durationMs,
            response: {
                statusCode: res.status,
                headers: respHeaders,
                ...bodyPayload,
                truncated,
            },
        };
    }
    catch (err) {
        const durationMs = Date.now() - started;
        const responseReceivedAt = new Date().toISOString();
        const aborted = err.name === "AbortError";
        const code = aborted
            ? "TIMEOUT"
            : err.code || "FETCH_ERROR";
        const message = err.message || "Local delivery failed";
        if (opts.verbose) {
            console.error(`✗ ${envelope.request.method} ${url.toString()}  ${code}  ${message}`);
        }
        return {
            sessionId: envelope.sessionId,
            deliveryAttemptId: envelope.deliveryAttemptId,
            status: aborted ? "timed_out" : "failed",
            requestSentAt,
            responseReceivedAt,
            durationMs,
            error: { code, message },
        };
    }
    finally {
        clearTimeout(timer);
    }
}
