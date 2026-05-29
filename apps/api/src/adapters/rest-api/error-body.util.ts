/**
 * Helpers for surfacing upstream response bodies on non-2xx errors —
 * see [#78](https://github.com/EnterpriseBT/portal-ai/issues/78).
 *
 * Both `fetchJson` (buffered) and `streamFetchRecords` (streaming)
 * used to throw `REST_API_FETCH_FAILED` on non-2xx without ever
 * reading the body, dropping the upstream's actual diagnostic message
 * on the floor. These helpers read up to a small cap of the body and
 * try to extract a user-facing message from common JSON error shapes.
 */

const DEFAULT_ERROR_BODY_CAP_BYTES = 8 * 1024;

/**
 * Read up to `cap` bytes of `response.body` without throwing. Returns
 * `null` when the body is missing or unreadable. Bodies larger than
 * the cap are truncated — we don't need the whole thing for error
 * diagnosis, and an unbounded read would re-open the OOM door this
 * codebase has been working to close.
 *
 * Caller is responsible for NOT having already locked the body via
 * `getReader` / `Readable.fromWeb`. In both call sites we read the
 * body here before any other consumer touches it.
 */
export async function readErrorBody(
  response: Response,
  cap: number = DEFAULT_ERROR_BODY_CAP_BYTES
): Promise<string | null> {
  if (!response.body) return null;
  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (bytes < cap) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = cap - bytes;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      text += decoder.decode(chunk, { stream: true });
      bytes += chunk.byteLength;
    }
    text += decoder.decode();
    try {
      await reader.cancel();
    } catch {
      /* best-effort */
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Best-effort user-facing message extraction from a captured error
 * body. Walks the four shapes that cover the vast majority of REST
 * APIs we've seen:
 *
 *   - `{ "error": { "message": "..." } }`         — marketstack, stripe-style
 *   - `{ "errors": [ { "message": "..." } ] }`    — GitHub, OpenAI
 *   - `{ "message": "..." }`                       — many internal APIs
 *   - `{ "detail": "..." }`                        — DRF / FastAPI
 *
 * Returns `null` when the body isn't JSON or none of the shapes
 * match. Caller falls back to `Endpoint returned HTTP ${status}` in
 * that case — the raw body is still attached to `details.responseBody`
 * for the user / developer to inspect.
 */
export function extractUserMessage(body: string | null): string | null {
  if (body === null || body.trim() === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;

  const errorObj = json["error"];
  if (isRecord(errorObj) && typeof errorObj["message"] === "string") {
    return errorObj["message"];
  }

  const errorsArr = json["errors"];
  if (Array.isArray(errorsArr) && errorsArr.length > 0) {
    const first = errorsArr[0];
    if (isRecord(first) && typeof first["message"] === "string") {
      return first["message"];
    }
  }

  if (typeof json["message"] === "string") {
    return json["message"];
  }
  if (typeof json["detail"] === "string") {
    return json["detail"];
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
