/**
 * Canonical, runtime-agnostic hash of the inputs that drive a REST API
 * connector probe. The client (`apps/web`) computes this on each
 * endpoint draft + instance-level edit to detect whether a cached
 * probe result is still valid; the server (`apps/api`) uses the same
 * function as the 60-second in-process cache key for the probe-draft
 * route. One hash function, two consumers.
 *
 * The projection is fixed (see ENDPOINT_HASH_KEYS): display-only fields
 * (`key`, `label`) and any other rogue input keys are dropped before
 * hashing. Equality of two hashes is the source of truth for "cached
 * result is fresh."
 *
 * SHA-256 is provided by Web Crypto (`globalThis.crypto.subtle`),
 * which is available in browsers and in Node 18+ (the project's
 * minimum runtime). No native dependency.
 */
import type {
  ApiAuthConfig,
  ApiCredentials,
  ApiEndpointConfig,
} from "../models/api-connector.model.js";

/** Endpoint fields whose change must invalidate the probe cache. */
const ENDPOINT_HASH_KEYS = [
  "path",
  "method",
  "recordsPath",
  "transform",
  "idField",
  "bodyTemplate",
  "pagination",
] as const;

export interface ProbeHashInput {
  organizationId: string;
  baseUrl: string;
  auth: ApiAuthConfig;
  credentials: ApiCredentials | null;
  endpoint: Pick<ApiEndpointConfig, (typeof ENDPOINT_HASH_KEYS)[number]>;
}

export async function probeInputHash(input: ProbeHashInput): Promise<string> {
  const projected = {
    organizationId: input.organizationId,
    baseUrl: input.baseUrl,
    auth: input.auth,
    credentials: input.credentials,
    endpoint: pickKeys(
      input.endpoint as unknown as Record<string, unknown>,
      ENDPOINT_HASH_KEYS
    ),
  };
  const canonical = JSON.stringify(canonicalize(projected));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

function pickKeys<K extends string>(
  obj: Record<string, unknown>,
  keys: readonly K[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
