/**
 * #728: a URL safe to log. SSE streams authenticate with `?token=<JWT>`
 * (`EventSource` can't send headers), and request logs wrote the URL verbatim,
 * putting live bearer tokens in CloudWatch. Every place a request URL is
 * logged goes through this: the `req` serializer, the request logger's
 * messages, and the error handler's `route` fields. A guard test fails CI on
 * a raw `req.url` / `originalUrl` in the source.
 *
 * The value of a sensitive query parameter becomes `[REDACTED]`; the path,
 * every other parameter, their order and any fragment are kept. A query
 * string that can't be decoded is dropped whole (fail closed).
 */

export const REDACTED = "[REDACTED]";

/** Query parameter names (lower-cased) whose values are credentials. */
const SENSITIVE_PARAMS = new Set([
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "api_key",
  "apikey",
  "key",
  "secret",
  "client_secret",
  "signature",
  "sig",
  "password",
]);

export function redactUrl(url: string): string;
export function redactUrl(url: string | undefined): string | undefined;
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf("?");
  if (q < 0) return url;
  const path = url.slice(0, q);
  const afterPath = url.slice(q + 1);
  const hash = afterPath.indexOf("#");
  const query = hash < 0 ? afterPath : afterPath.slice(0, hash);
  const fragment = hash < 0 ? "" : afterPath.slice(hash);

  const parts: string[] = [];
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    let key: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " ")).toLowerCase();
    } catch {
      return path; // undecodable: drop the whole query string
    }
    parts.push(SENSITIVE_PARAMS.has(key) ? `${rawKey}=${REDACTED}` : part);
  }
  return `${path}?${parts.join("&")}${fragment}`;
}

/**
 * #728: the parsed query object (Express's `req.query`, which the request
 * serializer emits alongside `url`) with every sensitive parameter's value
 * replaced. Shallow; non-object input passes through.
 */
export function redactQuery<T>(query: T): T {
  if (!query || typeof query !== "object" || Array.isArray(query)) return query;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    out[key] = SENSITIVE_PARAMS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out as T;
}
