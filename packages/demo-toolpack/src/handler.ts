/**
 * AWS Lambda function-URL handler (#510) serving the custom-toolpack contract:
 *
 *   GET  /schema    — tool catalog (open; non-sensitive)
 *   GET  /metadata  — human-readable descriptions/examples (open)
 *   POST /runtime   — invoke a tool by name; HMAC-verified
 *
 * `/schema` and `/metadata` are served without signature verification on
 * purpose: the app fetches `/schema` signed with a secret it only returns
 * *after* registration, so enforcing signatures there would make registration
 * impossible. The sensitive action — `/runtime` — is always verified against
 * the `PORTALAI_SIGNING_SECRETS` allow-list (comma-separated; one entry per
 * demo env). An empty allow-list fails `/runtime` closed with a 401.
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

  if (method === "GET" && endpoint === "schema") {
    return json(200, { tools: TOOLS });
  }
  if (method === "GET" && endpoint === "metadata") {
    return json(200, METADATA);
  }
  if (method === "POST" && endpoint === "runtime") {
    const headers = lowerHeaders(event.headers);
    const verdict = verifySignature({
      timestamp: headers["x-portalai-timestamp"],
      webhookId: headers["x-portalai-webhook-id"],
      signature: headers["x-portalai-signature"],
      rawBody,
      secrets: signingSecrets(),
      nowSec: Math.floor(Date.now() / 1000),
    });
    if (!verdict.ok) {
      return json(verdict.status, { error: verdict.error });
    }

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
