/**
 * Apply the configured auth mode to a REST API request.
 *
 * Pure function — no I/O, no logging. The adapter loads + decrypts
 * credentials once per sync run and calls `applyAuth` per fetch.
 *
 * Inputs:
 *   - `url`   — fully-resolved request URL (baseUrl + path + caller
 *               query string already merged).
 *   - `init`  — `RequestInit` to forward to fetch. Caller-supplied
 *               headers are preserved; `applyAuth` *adds* the auth
 *               header (or query param) on top.
 *   - `auth`  — non-secret auth config from `connectorInstances.config`.
 *   - `credentials` — decrypted secret payload from
 *               `connectorInstances.credentials`. `null` is permitted
 *               only when `auth.mode === "none"`.
 *
 * Throws `ApiError(REST_API_AUTH_FAILED)` when:
 *   - `auth.mode !== credentials.mode` (details.mismatch).
 *   - `credentials === null` for a non-`none` mode (details.reason).
 *
 * Headers are returned as a plain `Record<string, string>` regardless
 * of the caller's input shape — keeps test assertions trivial and
 * matches how `fetchJson` consumes them today.
 */
import type { ApiAuthConfig, ApiCredentials } from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

export interface AuthAppliedRequest {
  url: string;
  init: RequestInit;
}

export function applyAuth(
  url: string,
  init: RequestInit,
  auth: ApiAuthConfig,
  credentials: ApiCredentials | null
): AuthAppliedRequest {
  if (auth.mode === "none") {
    return { url, init: { ...init, headers: normalizeHeaders(init.headers) } };
  }

  if (credentials === null) {
    throw new ApiError(
      500,
      ApiCode.REST_API_AUTH_FAILED,
      `Credentials missing for auth mode "${auth.mode}"`,
      { reason: "missing", configMode: auth.mode }
    );
  }

  if (credentials.mode !== auth.mode) {
    throw new ApiError(
      500,
      ApiCode.REST_API_AUTH_FAILED,
      `Auth-mode mismatch — config.auth.mode is "${auth.mode}" but credentials.mode is "${credentials.mode}". Re-save the connector to repair.`,
      { mismatch: { configMode: auth.mode, credentialsMode: credentials.mode } }
    );
  }

  const headers = normalizeHeaders(init.headers);

  switch (auth.mode) {
    case "apiKey": {
      // discriminated-union narrowing — `credentials.mode` is already "apiKey".
      const value = (credentials as { mode: "apiKey"; value: string }).value;
      if (auth.placement === "header") {
        headers[auth.keyName] = value;
        return { url, init: { ...init, headers } };
      }
      const parsed = new URL(url);
      parsed.searchParams.set(auth.keyName, value);
      return { url: parsed.toString(), init: { ...init, headers } };
    }
    case "bearer": {
      const token = (credentials as { mode: "bearer"; token: string }).token;
      headers.Authorization = `Bearer ${token}`;
      return { url, init: { ...init, headers } };
    }
    case "basic": {
      const { username, password } = credentials as {
        mode: "basic";
        username: string;
        password: string;
      };
      const encoded = Buffer.from(`${username}:${password}`, "utf8").toString(
        "base64"
      );
      headers.Authorization = `Basic ${encoded}`;
      return { url, init: { ...init, headers } };
    }
  }
}

function normalizeHeaders(
  input: RequestInit["headers"] | undefined
): Record<string, string> {
  if (!input) return {};
  if (input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const [k, v] of input) out[k] = v;
    return out;
  }
  return { ...(input as Record<string, string>) };
}
