/**
 * Thin wrapper around `fetch` for the REST API connector.
 *
 * Two responsibilities:
 *   1. Convert non-2xx / network / parse failures into typed `ApiError`s
 *      so callers don't have to inspect response shape themselves.
 *   2. Cap response bodies at MAX_RESPONSE_BYTES (default 50 MB) so a
 *      misconfigured unpaginated endpoint can't OOM the worker.
 *
 * Streaming JSON parse to lift the cap for genuinely huge responses is
 * tracked separately as #72.
 */

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface FetchJsonResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * GET / POST the given URL and parse the body as JSON.
 *
 * Throws — never returns — on:
 *   - 4xx / 5xx response → REST_API_FETCH_FAILED with `details.status`.
 *   - Body exceeds MAX_RESPONSE_BYTES → REST_API_RESPONSE_TOO_LARGE.
 *     Fast path: rejects when `Content-Length` header exceeds the cap
 *     before reading any bytes. Slow path: streams the body and aborts
 *     once the running counter trips the cap (for chunked responses
 *     without `Content-Length`).
 *   - Body isn't valid JSON → REST_API_INVALID_JSON.
 *   - Network error / DNS / timeout → REST_API_FETCH_FAILED with the
 *     underlying cause in `details.cause`.
 *
 * `fetchImpl` is injectable for tests; defaults to `globalThis.fetch`.
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<FetchJsonResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    throw new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      `Fetch failed: ${(err as Error).message}`,
      { url, cause: (err as Error).message }
    );
  }

  const headers = collectHeaders(response.headers);
  const status = response.status;

  if (!response.ok) {
    throw new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      `Endpoint returned HTTP ${status}`,
      { url, status, headers }
    );
  }

  // Fast path: trust Content-Length when set.
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.REST_API_RESPONSE_TOO_LARGE,
        `Response exceeded ${MAX_RESPONSE_BYTES} bytes (Content-Length: ${cl})`,
        { url, bytesObserved: cl, limit: MAX_RESPONSE_BYTES }
      );
    }
  }

  // Slow path: stream the body, abort if the running total trips the cap.
  const text = await readBodyWithCap(response, url);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new ApiError(
      502,
      ApiCode.REST_API_INVALID_JSON,
      `Response body isn't valid JSON: ${(err as Error).message}`,
      { url, status, headers }
    );
  }

  return { status, body, headers };
}

async function readBodyWithCap(response: Response, url: string): Promise<string> {
  // If the runtime exposes a streaming reader, use it so we can abort
  // mid-stream. Falls back to `response.text()` only when the reader
  // isn't available (test fakes that don't expose .body, etc.).
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ApiError(
        502,
        ApiCode.REST_API_RESPONSE_TOO_LARGE,
        `Response exceeded ${MAX_RESPONSE_BYTES} bytes after buffering`,
        { url, bytesObserved: text.length, limit: MAX_RESPONSE_BYTES }
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        throw new ApiError(
          502,
          ApiCode.REST_API_RESPONSE_TOO_LARGE,
          `Response exceeded ${MAX_RESPONSE_BYTES} bytes mid-stream`,
          { url, bytesObserved: bytes, limit: MAX_RESPONSE_BYTES }
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  }
  text += decoder.decode();
  return text;
}

function collectHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
