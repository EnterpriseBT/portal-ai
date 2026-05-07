/**
 * Toolpack registration — HTTP fetch + validation for the schema and
 * optional metadata endpoints supplied by an organization registering
 * a custom toolpack.
 *
 * - `fetchSchema(url, headers)`: required at registration. Fetches,
 *   caps the body at 256 KB, parses JSON, validates with the Zod
 *   `tools[]` shape, and returns the validated array. Throws
 *   `TOOLPACK_SCHEMA_*` ApiErrors on every failure path.
 *
 * - `fetchMetadata(url, headers)`: optional and best-effort. Fetches
 *   and parses; returns `null` on any failure (HTTP error, oversize,
 *   validation failure, timeout). Never throws.
 *
 * - `validateNoBuiltinCollision(tools, builtinNames)`: synchronous
 *   guard. Throws `TOOLPACK_TOOL_NAME_CONFLICT` on the first match.
 */

/* global AbortController, fetch */

import { z } from "zod";

import {
  ToolpackToolDefinitionSchema,
  ToolpackMetadataSchema,
  type ToolpackToolDefinition,
  type ToolpackMetadata,
} from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { signRequest } from "../utils/webhook-signing.util.js";
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
      typeof (response.headers as { get?: (k: string) => string | null }).get ===
      "function"
        ? (response.headers as { get: (k: string) => string | null }).get(
            "content-length"
          )
        : (response.headers as Map<string, string>).get("content-length") ??
          null;
    if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_TOO_LARGE,
        `Schema response exceeds ${MAX_RESPONSE_BYTES} bytes`
      );
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_TOO_LARGE,
        `Schema response exceeds ${MAX_RESPONSE_BYTES} bytes`
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      502,
      ApiCode.TOOLPACK_SCHEMA_INVALID,
      "Schema response is not valid JSON"
    );
  }
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
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
        err instanceof Error ? err.message : "Schema fetch failed"
      );
    }

    if (!result.ok) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
        `Schema endpoint returned ${result.status}${result.statusText ? `: ${result.statusText}` : ""}`
      );
    }

    const parsed = parseJson(result.text);
    const validated = SchemaResponseShape.safeParse(parsed);
    if (!validated.success) {
      throw new ApiError(
        502,
        ApiCode.TOOLPACK_SCHEMA_INVALID,
        "Schema response failed validation"
      );
    }

    return validated.data.tools;
  }

  /**
   * GET the metadata endpoint, validate the response, and return the
   * parsed object. Failures (HTTP, oversize, malformed, validation)
   * return `null` so callers can register without metadata.
   */
  static async fetchMetadata(
    url: string,
    headers: Record<string, string> | undefined,
    signingSecret?: string
  ): Promise<ToolpackMetadata | null> {
    try {
      const result = await fetchWithCap(url, headers, signingSecret);
      if (!result.ok) {
        logger.warn(
          { url, status: result.status },
          "Metadata fetch returned non-OK status; proceeding without metadata"
        );
        return null;
      }
      const parsed = JSON.parse(result.text);
      const validated = ToolpackMetadataSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn({ url }, "Metadata response failed validation");
        return null;
      }
      return validated.data;
    } catch (err) {
      logger.warn(
        { url, error: err instanceof Error ? err.message : "unknown" },
        "Metadata fetch failed; proceeding without metadata"
      );
      return null;
    }
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
