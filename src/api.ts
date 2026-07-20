// Thin wrapper around the Webhook Pal edge functions.

import { API_URL, ANON_KEY } from "./config.js";

const CLI_VERSION = "0.1.0-beta.2";

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(
  fn: string,
  body: unknown,
  token: string,
): Promise<T> {
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
  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError("INTERNAL_ERROR", `Non-JSON response (${res.status})`, res.status);
  }
  if (!json.ok || !json.data) {
    const code = json.error?.code || "INTERNAL_ERROR";
    const message = json.error?.message || `Request failed (${res.status})`;
    throw new ApiError(code, message, res.status);
  }
  return json.data;
}

export interface ConnectResponse {
  sessionId: string;
  endpointId: string;
  channel: string;
  heartbeatIntervalSeconds: number;
  serverTime: string;
  realtime: { url: string; accessToken: string };
}

export function connect(
  token: string,
  input: { endpointId: string; deviceName: string; localTarget: string; cliVersion: string },
) {
  return call<ConnectResponse>("cli-connect", input, token);
}

export function heartbeat(
  token: string,
  input: { sessionId: string },
) {
  return call<{
    revoked?: boolean;
    accessToken?: string;
    expiresAt?: string;
    pendingDeliveries?: Envelope[];
  }>(
    "cli-heartbeat",
    input,
    token,
  );
}

export function disconnect(token: string, sessionId: string) {
  return call<{ id: string }>("cli-disconnect", { sessionId }, token);
}

export interface DeliveryReport {
  sessionId: string;
  deliveryAttemptId: string;
  status: "received_by_cli" | "forwarding" | "succeeded" | "failed" | "timed_out" | "cancelled";
  requestSentAt?: string;
  responseReceivedAt?: string;
  durationMs?: number;
  response?: {
    statusCode: number;
    headers: Record<string, string[]>;
    body: string;
    bodyEncoding: "utf8" | "base64";
    truncated?: boolean;
  };
  error?: { code: string; message: string };
}

export function reportDelivery(token: string, input: DeliveryReport) {
  return call<{ id: string; status: string }>("report-local-delivery", input, token);
}

export interface EnvelopeRequest {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string[]>;
  bodyEncoding: "base64" | "external";
  body: string;
}

export interface Envelope {
  type: "local_forwarding.event";
  schemaVersion: number;
  deliveryAttemptId: string;
  eventId: string;
  endpointId: string;
  sessionId: string;
  receivedAt: string;
  deliverySource: "live" | "manual_replay";
  request: EnvelopeRequest;
  metadata: { headers: Record<string, string> };
}

export function fetchEnvelope(
  token: string,
  input: { deliveryAttemptId: string; sessionId: string },
) {
  return call<Envelope>("get-local-delivery-payload", input, token);
}

export { CLI_VERSION };
