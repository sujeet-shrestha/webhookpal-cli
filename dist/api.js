// Thin wrapper around the Webhook Pal edge functions.
import { API_URL, ANON_KEY } from "./config.js";
const CLI_VERSION = "0.1.0-beta.2";
export class ApiError extends Error {
    code;
    status;
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
async function call(fn, body, token) {
    const res = await fetch(`${API_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: ANON_KEY,
            "x-webhookpal-cli-version": CLI_VERSION,
        },
        body: JSON.stringify(body),
    });
    let json;
    try {
        json = (await res.json());
    }
    catch {
        throw new ApiError("INTERNAL_ERROR", `Non-JSON response (${res.status})`, res.status);
    }
    if (!json.ok || !json.data) {
        const code = json.error?.code || "INTERNAL_ERROR";
        const message = json.error?.message || `Request failed (${res.status})`;
        throw new ApiError(code, message, res.status);
    }
    return json.data;
}
export function connect(token, input) {
    return call("cli-connect", input, token);
}
export function heartbeat(token, input) {
    return call("cli-heartbeat", input, token);
}
export function disconnect(token, sessionId) {
    return call("cli-disconnect", { sessionId }, token);
}
export function reportDelivery(token, input) {
    return call("report-local-delivery", input, token);
}
export function fetchEnvelope(token, input) {
    return call("get-local-delivery-payload", input, token);
}
export { CLI_VERSION };
