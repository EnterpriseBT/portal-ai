# 500 responses stop echoing internal errors — Condensed design (#687)

**Issue:** [EnterpriseBT/portal-ai#687](https://github.com/EnterpriseBT/portal-ai/issues/687) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Route handlers wrap a caught error as `new ApiError(500, <code>, error.message)`, and the response carries that message verbatim. For a Drizzle failure the message is the whole SQL statement plus its bound parameters, so any signed-in user who can trigger a DB error (a NUL byte in a path id is enough) reads table names, column lists and parameter values. The pattern is in 151 handlers across 27 routers. The fix is one change in the response path, not 151. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Response writer | `apps/api/src/services/http.service.ts:56-64` (`HttpService.error`) | writes `message`, `code`, `recommendation`, `details` from any `ApiError`, whatever its status |
| Catch-all | `apps/api/src/app.ts:105-213` | logs an `ApiError`'s message (`log.error({code,status,message})`) and then calls `HttpService.error`; an unknown error already gets a generic `500 {message:"Internal server error", code:"UNKNOWN"}` (:208) |
| Callers | `app.ts` only | no route calls `HttpService.error` directly, so every response passes the catch-all's log line first |
| Intentional 5xx copy | 503 `DB_ADMISSION_TIMEOUT` / `MAP_TILE_BUSY` (#698), 502s from vendor and REST adapters (`adapters/rest-api/*`, Excel, Sheets, billing) | written for the user: retry advice or an upstream's own refusal |
| Web | `apps/web/src/utils/permission-denied.util.ts:45` (`serverErrorMessage`) | shows the server's message, else the caller's fallback |

## Decision — scrub 500s in `HttpService.error`

Options:
- **(a)** Scrub in the catch-all only.
- **(b)** Scrub in `HttpService.error` for `status === 500`.
- **(c)** Scrub every 5xx.
- **(d)** Pattern-match DB errors (`Failed query:`).

**Chosen: (b).** The writer is the one place every error response passes, so a future direct caller can't skip the scrub. The catch-all already logs the original message before calling it, so nothing is lost server-side.

- **(c)** would erase deliberate copy: the 503 retry advice and the 502 upstream refusals.
- **(d)** leaks anything that isn't SQL-shaped (Redis, filesystem, library internals).

For a 500 the response becomes:
- **message:** `Internal server error`, matching the unknown-error branch.
- **code:** kept. It is the client contract and names the failing operation without internals.
- **recommendation:** kept. It is always authored copy.
- **details:** dropped. It is an arbitrary map that can carry raw values.

4xx, 502, 503 and 504 responses are unchanged.

**Review follow-ups.**
- **Interpret:** the parser's input errors (`UNKNOWN_SHEET`, `UNSUPPORTED_LAYOUT_SHAPE`) were 500s whose message told the user what to fix. They now answer **400** (`utils/interpret-error.util.ts`), so the scrub doesn't blank them.
- **Web:** `serverErrorMessage` reads the generic message as "no message" and shows the call site's own fallback. The string lives in `@portalai/core/constants` (`INTERNAL_ERROR_MESSAGE`), so the API and web share it.
- **Portal chat stream:** once the SSE stream is open, its catch applies the same rule, so a 500 `ApiError` sends the generic stream error.

## Plan — 1 slice

**Files**
- `apps/api/src/services/http.service.ts`: `HttpService.error` scrubs a 500 as above. The generic text becomes an exported constant that `app.ts:210` reuses.
- `CLAUDE.md` → API Style Guide → "Error handling": add one line saying a 500's message never reaches the client, so put the detail in the log. Make the same edit in `.github/copilot-instructions.md`.

**Tests**
- `apps/api/src/__tests__/services/http.service.test.ts`:
  - A 500 with SQL-shaped text returns the generic message, keeps its `code` and `recommendation`, and drops `details`.
  - An undefined status (which defaults to 500) is scrubbed the same way.
  - A 400 and a 503 keep their message.
- `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts`: `GET /api/field-mappings/%00` returns 500 with the route's code and no `Failed query` and no `select` anywhere in the body.
- Run `npm run test:unit -- --testPathPattern http.service` and `npm run test:integration -- --testPathPattern field-mapping.router`, then `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. `curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/field-mappings/%00` returns 500 with `{"message":"Internal server error","code":"FIELD_MAPPING_…"}` and no SQL. The API log shows the original `Failed query: …` line.
2. Repeat for `GET /api/entity-groups/%00` and `GET /api/connector-entities/%00`. Each returns a generic message and a route-specific code.
3. A 4xx is unchanged: `GET /api/field-mappings/<random uuid>` still returns 404 with its own message.
4. Interpret with a region hint naming a sheet that isn't in the workbook: `POST /api/layout-plans/interpret` returns **400** `LAYOUT_PLAN_INTERPRET_FAILED` with the `UNKNOWN_SHEET: …` explanation.
5. In the app, a failed action's toast shows the call site's own fallback (e.g. "Failed to …"), never "Internal server error" and never query text.

## Out of scope

- **Rejecting malformed path ids early** (400/404 for a NUL byte or a non-uuid id). With the scrub in place a malformed id is a sanitized 500, so this is a correctness nicety rather than a disclosure; it can be its own ticket if wanted.
- **Error text stored on job rows** (`jobs.error`), SSE error events and tool results. These are separate channels from an HTTP 5xx. A job's `error` is readable by any org member (#692) and may hold DB text, so it's worth a follow-up ticket.
- **502 bodies that relay an upstream's response.** That text comes from the org's own upstream, not from us.
