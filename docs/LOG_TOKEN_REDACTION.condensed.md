# SSE bearer tokens kept out of the logs — Condensed design (#728)

**Issue:** [EnterpriseBT/portal-ai#728](https://github.com/EnterpriseBT/portal-ai/issues/728) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `EventSource` can't send headers, so SSE streams authenticate with `?token=<JWT>` (`middleware/sse-auth.middleware.ts`). The request logger writes `req.url` verbatim, so a live Auth0 access token (about 24h lifetime) lands in CloudWatch on every SSE request line. It also appears on every `req.log` line inside that request (seen on app-dev, `AI stream error chunk`, 2026-10-07). Anyone who can read the API logs can replay it until it expires.

The header path is already redacted (`req.headers.authorization`). The query string isn't. `apps/api` only.

## Current shape

| Vector | Location | Note |
|---|---|---|
| Request serializer | `utils/logger.util.ts:119-125` (`req: pino.stdSerializers.req`) | emits `req.url` with its query string on the request line and on every `req.log` child line |
| Messages | `middleware/logger.middleware.ts:64,71` (`customSuccessMessage` / `customErrorMessage`) | interpolate `${req.url}` |
| Error-handler fields | `app.ts:121,132,161,179,198` (`route: req.originalUrl`) | includes the JWT-rejected branch, so an expired SSE token is logged on rejection too |
| Existing redaction | `logger.middleware.ts:79-97`, `logger.util.ts:127-` | headers and body fields only; `*.token` matches object keys, not a query string |

## Decision — one URL redactor, applied at every place a URL is logged

Options:
- **(a)** Redact in the request serializer only. That misses the message strings and `app.ts`'s `route` fields.
- **(b)** Move SSE auth to a short-lived single-use ticket, so the URL never carries a replayable credential. This is the stronger fix, but it's a contract change on both client and server; a separate ticket if wanted.
- **(c)** A shared `redactUrl(url)` that replaces the value of sensitive query parameters with `[REDACTED]`, used by the `req` serializer, both messages and the `app.ts` fields.

**Chosen: (c).**
- **Parameters:** `token`, `access_token`, `id_token`, `refresh_token`, `code`, `api_key`, `apikey`, `key`, `secret`, `signature`, `sig`, `password`. Names match case-insensitively.
- **Everything else is untouched:** the path, other parameters and their order. A malformed URL is returned with its whole query string cut, which fails closed.
- **Where it runs:**
  - The `req` serializer wraps `pino.stdSerializers.req` and redacts `url`. Every `req` field on every line goes through it, request line and child lines alike.
  - The two message formatters use it.
  - `app.ts` logs `route: redactUrl(req.originalUrl)`.

## Plan — 1 slice

**Files:** new `utils/redact-url.util.ts`; edit `utils/logger.util.ts` (serializer), `middleware/logger.middleware.ts` (messages) and `app.ts` (route fields).

**Tests:**
- New `__tests__/utils/redact-url.util.test.ts`:
  - each listed parameter is redacted;
  - other parameters and the path are kept;
  - case-insensitive match;
  - repeated parameters;
  - no query string;
  - a malformed URL.
- A guard: `__tests__/middleware/logger.middleware.test.ts` (extend). A `GET /api/sse/…?token=SECRET` request through `httpLogger` writes no `SECRET` anywhere in the captured output: request line, message, or a `req.log` child line. A source scan also fails CI on a new `req.url` / `originalUrl` reaching a log call without `redactUrl`.

Run `npm run test:unit` for the touched files, plus `type-check` and `lint`.

## Smoke (app-dev, after deploy)

1. Open any portal. This opens `/api/sse/portals/<id>/stream?token=…`.
2. In CloudWatch `/ecs/portalai-api-dev`, search the last few minutes for `token=eyJ`. There are no matches. The SSE request lines show `token=[REDACTED]`.

## Out of scope

- **Single-use SSE tickets (b).** That removes the credential from the URL entirely; a follow-up if wanted.
- **Scrubbing tokens already in CloudWatch.** Log retention ages them out, and they expire in about 24h. Purge the group if policy requires it.
- **Prod.** It's on v1.0.11, and the fix ships with the gated release.
