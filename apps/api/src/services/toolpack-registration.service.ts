/**
 * Toolpack registration — HTTP fetch + validation for the schema and
 * optional metadata endpoints supplied by an organization registering
 * a custom toolpack.
 *
 * - `fetchSchema(url, headers)`: required at registration. Fetches,
 *   caps the body at 256 KB, parses JSON, validates with the Zod
 *   `tools[]` shape, and returns the validated array. Throws
 *   `TOOLPACK_SCHEMA_*` ApiErrors on every failure path, and
 *   `TOOLPACK_SIGNATURE_REJECTED` on a 401/403 (#911).
 *
 * - `fetchMetadata(url, headers)`: optional and best-effort. Fetches
 *   and parses; returns `null` on any failure (HTTP error, oversize,
 *   validation failure, timeout), except a 401/403, which throws
 *   `TOOLPACK_SIGNATURE_REJECTED` as `fetchSchema` does (#911).
 *
 * - `validateNoBuiltinCollision(tools, builtinNames)`: synchronous
 *   guard. Throws `TOOLPACK_TOOL_NAME_CONFLICT` on the first match.
 */

/* global AbortController, fetch */

import { z } from "zod";

import {
  ToolpackToolDefinitionSchema,
  ToolpackMetadataSchema,
  customToolCapabilityError,
  type ToolpackToolDefinition,
  type ToolpackMetadata,
} from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { signRequest } from "../utils/webhook-signing.util.js";
import { describeFirstZodIssue } from "../utils/zod-issue.util.js";
import {
  assertUrlSafeToFetch,
  SsrfBlockedError,
} from "../utils/url-safety.util.js";
import { environment } from "../environment.js";

const logger = createLogger({ module: "toolpack-registration" });

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const SchemaResponseShape = z.object({
  tools: z.array(ToolpackToolDefinitionSchema).min(1).max(32),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchResult {
  ok: boolean;
  status: number;
  statusText?: string;
  text: string;
}

async function fetchWithCap(
  url: string,
  headers: Record<string, string> | undefined,
  signingSecret: string | undefined
): Promise<FetchResult> {
  // SSRF: resolve+validate before connecting. Throws SsrfBlockedError
  // on private/reserved IPs unless TOOLPACK_DISABLE_SSRF_FILTER=true.
  // The static refinement at the contract layer is the first line of
  // defence; this is the canonical, DNS-rebinding-resistant guard.
  await assertUrlSafeToFetch(url);

  // GET requests sign over the empty body — timestamp + webhookId
  // still bind into the signature so a captured request can't be
  // replayed past the receiver's window.
  const signedHeaders =
    signingSecret && !environment.TOOLPACK_DISABLE_SIGNING
      ? signRequest(signingSecret, "")
      : ({} as Record<string, string>);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = (await fetch(url, {
      method: "GET",
      headers: { ...(headers ?? {}), ...signedHeaders },
      signal: controller.signal,
    })) as unknown as {
      ok: boolean;
      status: number;
      statusText?: string;
      headers: { get: (k: string) => string | null } | Map<string, string>;
      text: () => Promise<string>;
    };

    // Quick reject on declared content-length.
    const contentLength =
      typeof (response.headers as { get?: (k: string) => string | null })
        .get === "function"
        ? (response.headers as { get: (k: string) => string | null }).get(
            "content-length"
          )
        : ((response.headers as Map<string, string>).get("content-length") ??
          null);
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_TOO_LARGE,
        `The toolpack response from ${url} exceeds the ${MAX_RESPONSE_BYTES}-byte cap.`
      );
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_TOO_LARGE,
        `The toolpack response from ${url} exceeds the ${MAX_RESPONSE_BYTES}-byte cap.`
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "parse error";
    throw new ApiError(
      502,
      ApiCode.TOOLPACK_SCHEMA_INVALID,
      `The toolpack response from ${url} is not valid JSON (${reason}).`
    );
  }
}

/**
 * #911: a 401/403 from a signed fetch means the toolpack server refused the
 * signature, so its secret doesn't match the one being registered. Returns
 * the error to throw, or `null` for any other status. Carries the URL and
 * status only, never secret material.
 */
function signatureRejection(url: string, status: number): ApiError | null {
  if (status !== 401 && status !== 403) return null;
  return new ApiError(
    502,
    ApiCode.TOOLPACK_SIGNATURE_REJECTED,
    `The toolpack server at ${url} rejected the request's signature (${status}). Its signing secret must match the one registered with Portals AI; see "Verifying requests" in the custom toolpack integration guide.`,
    { url, status }
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ToolpackRegistrationService {
  /**
   * GET the schema endpoint, validate the response, and return the
   * declared tool definitions. Throws structured ApiErrors on every
   * failure path.
   */
  static async fetchSchema(
    url: string,
    headers: Record<string, string> | undefined,
    signingSecret?: string
  ): Promise<ToolpackToolDefinition[]> {
    let result: FetchResult;
    try {
      result = await fetchWithCap(url, headers, signingSecret);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof SsrfBlockedError) {
        throw new ApiError(502, ApiCode.TOOLPACK_URL_PRIVATE_HOST, err.message);
      }
      const reason = err instanceof Error ? err.message : "unknown error";
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
        `Could not reach the toolpack schema endpoint at ${url} (${reason}). Check that the toolpack server is running and the URL is correct.`
      );
    }

    if (!result.ok) {
      const rejected = signatureRejection(url, result.status);
      if (rejected) throw rejected;
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
        `The toolpack schema endpoint at ${url} returned ${result.status}${result.statusText ? ` ${result.statusText}` : ""}.`
      );
    }

    const parsed = parseJson(result.text, url);
    const validated = SchemaResponseShape.safeParse(parsed);
    if (!validated.success) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_INVALID,
        `The toolpack schema response from ${url} did not match the expected shape (${describeFirstZodIssue(validated.error.issues)}).`
      );
    }

    // #121 child I / #124: a custom tool may declare only the pure-consumer
    // capability subset, and its `consumption` is gated to what the runtime
    // can actually feed (policy-(b): never a declarable-but-dead mode).
    // `none` (inline), `bounded` (records-in-body), and `streaming`
    // (pull-on-read) are wired (#124). `engine-pushdown` stays rejected for
    // custom — no backend access.
    for (const t of validated.data.tools) {
      if (!t.capability) continue;
      const reason = customToolCapabilityError(t.capability, {
        allowedConsumptionModes: ["none", "bounded", "streaming"],
      });
      if (reason) {
        throw new ApiError(
          400,
          ApiCode.TOOLPACK_CAPABILITY_INVALID,
          `Tool '${t.name}' from ${url} declares a capability outside the allowed subset: ${reason}.`
        );
      }
    }

    return validated.data.tools;
  }

  /**
   * GET the metadata endpoint, validate the response, and return the
   * parsed object. Failures (HTTP, oversize, malformed, validation)
   * return `null` so callers can register without metadata, except a
   * 401/403, which throws `TOOLPACK_SIGNATURE_REJECTED` (#911): a server
   * that refuses the signature would refuse every tool call too.
   */
  static async fetchMetadata(
    url: string,
    headers: Record<string, string> | undefined,
    signingSecret?: string
  ): Promise<ToolpackMetadata | null> {
    let result: FetchResult;
    try {
      result = await fetchWithCap(url, headers, signingSecret);
    } catch (err) {
      logger.warn(
        { url, error: err instanceof Error ? err.message : "unknown" },
        "Metadata fetch failed; proceeding without metadata"
      );
      return null;
    }
    const rejected = signatureRejection(url, result.status);
    if (rejected) throw rejected;
    if (!result.ok) {
      logger.warn(
        { url, status: result.status },
        "Metadata fetch returned non-OK status; proceeding without metadata"
      );
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      logger.warn({ url }, "Metadata response is not valid JSON");
      return null;
    }
    const validated = ToolpackMetadataSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn({ url }, "Metadata response failed validation");
      return null;
    }
    return validated.data;
  }

  /**
   * Throw `TOOLPACK_TOOL_NAME_CONFLICT` if any tool's name appears in
   * the built-in name set. The first collision wins.
   */
  static validateNoBuiltinCollision(
    tools: ToolpackToolDefinition[],
    builtinNames: Set<string>
  ): void {
    for (const tool of tools) {
      if (builtinNames.has(tool.name)) {
        throw new ApiError(
          409,
          ApiCode.TOOLPACK_TOOL_NAME_CONFLICT,
          `Tool "${tool.name}" conflicts with a built-in tool name`
        );
      }
    }
  }
}
