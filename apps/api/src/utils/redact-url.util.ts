/**
 * #728: a URL safe to log. SSE streams authenticate with `?token=<JWT>`
 * (`EventSource` can't send headers), and request logs wrote the URL verbatim,
 * putting live bearer tokens in CloudWatch. Every place a request URL is
 * logged goes through this: the request serializers, the request logger's
 * messages, and the error handler's `route` fields. A guard test fails CI on
 * a raw `req.url` / `originalUrl` in the source.
 *
 * The value of a sensitive query parameter becomes `[REDACTED]`; the path,
 * every other parameter, their order and any fragment are kept. A parameter
 * whose name can't be decoded is dropped (fail closed) and the rest are kept.
 */

export const REDACTED = "[REDACTED]";

/**
 * Credential parameter names, normalized ({@link normalizeName}): lower-cased
 * with `_` and `-` removed, so `access_token`, `accessToken` and
 * `Access-Token` all match.
 */
const SENSITIVE_NAMES = new Set([
  "token",
  "accesstoken",
  "idtoken",
  "refreshtoken",
  "code",
  "apikey",
  "key",
  "secret",
  "clientsecret",
  "signature",
  "sig",
  "password",
]);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

/** A query key is sensitive if any of its bracket segments is: `token`,
 *  `token[]`, `token[0]`, `auth[token]`. Express 5's `simple` parser keeps
 *  these as flat keys (#897); a URL can still carry them. */
function isSensitiveKey(key: string): boolean {
  return key
    .split(/[[\]]/)
    .filter(Boolean)
    .some((segment) => SENSITIVE_NAMES.has(normalizeName(segment)));
}

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
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      continue; // undecodable name: drop this parameter, keep the rest
    }
    parts.push(isSensitiveKey(key) ? `${rawKey}=${REDACTED}` : part);
  }
  return `${path}?${parts.join("&")}${fragment}`;
}

/**
 * #728: the parsed query object (Express's `req.query`, which the request
 * serializer emits alongside `url`) with every sensitive parameter's value
 * replaced. Both parsers' shapes are covered: a key is checked segment by
 * segment, so Express 5's default parser's flat `auth[token]` is redacted
 * (#897), and nested objects are still walked, so `qs`'s
 * `{ auth: { token } }` is too. Non-object input passes through.
 */
export function redactQuery<T>(query: T): T {
  if (!query || typeof query !== "object") return query;
  if (Array.isArray(query)) return query.map((v) => redactQuery(v)) as T;
  // `fromEntries` defines own properties, so a `?__proto__=` key (which the
  // `simple` parser keeps as an own key) stays a key instead of setting the
  // copy's prototype (#897).
  return Object.fromEntries(
    Object.entries(query as Record<string, unknown>).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactQuery(value),
    ])
  ) as T;
}
