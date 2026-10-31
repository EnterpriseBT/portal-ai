/**
 * AWS Lambda function-URL handler (#510) serving the custom-toolpack contract:
 *
 *   GET  /schema    — tool catalog
 *   GET  /metadata  — human-readable descriptions/examples
 *   POST /runtime   — invoke a tool by name
 *
 * Every request is HMAC-verified against the `PORTALAI_SIGNING_SECRETS`
 * allow-list (comma-separated; one entry per demo env) **when it is set**: the
 * GETs over the empty body, `/runtime` over its raw body. The demo seed
 * registers with the allow-list's first entry (`DEMO_TOOLPACK_SIGNING_SECRETS`
 * on the app side), so the registration fetches verify too (#911). When it is
 * unset every call is accepted unsigned (the reference mock's SKIPPED mode);
 * the demo payloads are invented, so that's a weaker but harmless option.
 *
 * Framework-free (only `node:crypto` via ./signing) so it unit-tests under the
 * same ts-jest ESM config as the other leaf packages and needs no bundler.
 */

import { verifySignature } from "./signing.js";
import { TOOLS, METADATA, dispatchTool } from "./tools.js";

/** Minimal shape of a Lambda function-URL request (payload format 2.0). */
export interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Response body cap mirroring the app's 1 MB runtime limit. */
const MAX_RESPONSE_BYTES = 1_000_000;

function json(statusCode: number, body: unknown): FunctionUrlResult {
  let text = JSON.stringify(body);
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    statusCode = 500;
    text = JSON.stringify({ error: "RESPONSE_TOO_LARGE" });
  }
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: text,
  };
}

/** Read the signing-secret allow-list from the environment. */
export function signingSecrets(): string[] {
  return (process.env.PORTALAI_SIGNING_SECRETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function lowerHeaders(
  headers: Record<string, string | undefined> | undefined
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/** Normalize a request path so a trailing slash or base prefix doesn't matter. */
function endpointOf(path: string): "schema" | "metadata" | "runtime" | null {
  const p = path.replace(/\/+$/, "");
  if (p.endsWith("/schema")) return "schema";
  if (p.endsWith("/metadata")) return "metadata";
  if (p.endsWith("/runtime")) return "runtime";
  return null;
}

export async function handler(
  event: FunctionUrlEvent
): Promise<FunctionUrlResult> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
  const endpoint = endpointOf(path);

  const rawBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "";

  // #911: verify every request once an allow-list is configured.
  const secrets = signingSecrets();
  if (secrets.length > 0 && endpoint !== null) {
    const headers = lowerHeaders(event.headers);
    const verdict = verifySignature({
      timestamp: headers["x-portalai-timestamp"],
      webhookId: headers["x-portalai-webhook-id"],
      signature: headers["x-portalai-signature"],
      rawBody,
      secrets,
      nowSec: Math.floor(Date.now() / 1000),
    });
    if (!verdict.ok) {
      return json(verdict.status, { error: verdict.error });
    }
  }

  if (method === "GET" && endpoint === "schema") {
    return json(200, { tools: TOOLS });
  }
  if (method === "GET" && endpoint === "metadata") {
    return json(200, METADATA);
  }
  if (method === "POST" && endpoint === "runtime") {
    let parsed: unknown;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json(400, { error: "Request body must be valid JSON." });
    }
    const { tool, input } = (parsed ?? {}) as {
      tool?: unknown;
      input?: unknown;
    };
    const result = dispatchTool(tool, input);
    return json(result.status, result.body);
  }

  return json(404, { error: "Not found." });
}
