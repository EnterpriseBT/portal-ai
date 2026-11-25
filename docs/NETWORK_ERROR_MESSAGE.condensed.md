# Network failures show the action's message — Condensed design (#1121)

**Issue:** [EnterpriseBT/portal-ai#1121](https://github.com/EnterpriseBT/portal-ai/issues/1121) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** When a request never gets a response (the API is down, the connection dropped), the browser's `fetch` throws a `TypeError("Failed to fetch")`. That passes up unchanged, so every toast and dialog alert shows "Failed to fetch" instead of the action's own message ("Couldn't add the tag."). The fix turns that failure into one typed `ApiError` and has the shared message helper lead with the call's fallback. Mostly web, plus one Help entry in core content.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The one request path | `apps/web/src/utils/api.util.ts:146` (`sendApiRequest`), `fetch` at `:165` | Maps a non-2xx body to `ApiError`; a `fetch` rejection escapes as is. Used by `useAuthFetch`, so by `useAuthQuery`, `useAuthMutation` and the search hooks, and by `usePublicMutation` (`:433`) |
| Timeout mapping | `api.util.ts:491` | A timed-out write becomes `ApiError(REQUEST_TIMEOUT_MESSAGE, "REQUEST_TIMEOUT", 0)`; its copy (`:53`) says it "may still finish" (#753) |
| Abort | `api.util.ts` `boundedSignal` | A timeout or a caller's abort rejects `fetch` with the signal's reason (a `DOMException`), not a `TypeError` |
| Message helper | `apps/web/src/utils/permission-denied.util.ts:48` (`serverErrorMessage`) | Permission denial → its message; the 500 generic → `fallback` (#687); anything else → its `message`, so "Failed to fetch" |
| Toasts | e.g. `apps/web/src/utils/use-tag-assignments.util.ts:44` | `toast: { error: "Couldn't add the tag." }` reaches `serverErrorMessage` as the fallback |
| Dialog alert | `apps/web/src/components/FormAlert.component.tsx:21` | `serverErrorMessage(serverError)` with the default fallback, plus `(code)`; a raw `TypeError` arrives with `UNKNOWN_CODE` |
| Help | `packages/core/src/content/troubleshooting.util.ts` | No entry for a failed connection |

## Decision — type the failure once, and lead with the call's message

- **Where it's caught.** Options: in `serverErrorMessage` (match the text "Failed to fetch"; browser-specific: Firefox and Safari word it differently), or in `sendApiRequest` (one place, every caller). **Chosen: `sendApiRequest`.** It wraps `fetch` and turns a rejection that is a `TypeError` into `new ApiError(<message>, "NETWORK_ERROR", 0)`. An abort (a `DOMException`) passes through untouched, so the timeout mapping and react-query's cancellation keep working. The same applies when the connection drops while the body streams (`response.json()` rejects with a `TypeError`). The original error is kept as `cause`, since a malformed request also rejects with a `TypeError`, and the browser can't tell the two apart.
- **What it says.** Its message is a second sentence that suits either verb, since `sendApiRequest` knows whether the request is a read:
  - read: `NETWORK_ERROR_READ_MESSAGE` = "The server couldn't be reached. Check your connection and try again."
  - write: `NETWORK_ERROR_WRITE_MESSAGE` = "The server couldn't be reached. Check your connection, then check whether the change saved before trying again." A network error can follow an applied write (#753), so like `REQUEST_TIMEOUT` it doesn't claim nothing was saved.
- **How it's shown.** For `NETWORK_ERROR`, `serverErrorMessage` leads with the caller's own fallback when one is passed: `` `${fallback} ${message}` ``. A fallback with no closing stop ("Failed to revoke") gets one, so the sentences don't run together. A toast reads "Couldn't add the tag. The server couldn't be reached. Check your connection, then check whether the change saved before trying again." With no fallback passed (`FormAlert`), it shows the message alone, "The server couldn't be reached. …" with `(NETWORK_ERROR)`, rather than a generic "Something went wrong." lead. Other errors keep the default fallback.
- **Help.** A troubleshooting entry: "Something couldn't reach the server", its cause (connection or service down), and what to do, with aliases including "Failed to fetch" and "network error".
- Not chosen: a global offline banner (a new surface for a copy bug), or retrying writes (#753 rules that out).

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/utils/api.util.ts`: `NETWORK_ERROR_CODE`, the two messages, and the `TypeError` → `ApiError` mapping around `fetch`.
- Edit: `apps/web/src/utils/permission-denied.util.ts`: the `NETWORK_ERROR` case in `serverErrorMessage` (the fallback becomes optional, so it can tell a caller's own from the default).
- Edit: `packages/core/src/content/troubleshooting.util.ts`: the new entry.

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern <names>`; core: `cd packages/core && npm run test:unit -- --testPathPattern help-findability|troubleshooting`)
- New `apps/web/src/__tests__/auth-mutation-network-error.test.tsx`:
  - a write whose `fetch` rejects with `TypeError` rejects with `NETWORK_ERROR` and the write message, with the original as `cause`;
  - a body that fails while streaming is `NETWORK_ERROR` too;
  - a read rejects with the read message;
  - a timed-out write is still `REQUEST_TIMEOUT`;
  - a caller's abort passes through as is.
- `apps/web/src/__tests__/permission-denied.util.test.ts`: `NETWORK_ERROR` leads with the fallback (adding a stop when it lacks one), then its message; other codes are unchanged, including an empty fallback.
- `apps/web/src/__tests__/FormAlert.test.tsx`: a `NETWORK_ERROR` server error shows "The server couldn't be reached…" with no generic lead, and its code.
- Core's Help findability tests cover the new entry automatically (first for its own title, found by "failed to fetch").

## Smoke (manual, against your dev stack)

1. As the owner, open a station's detail page and press "Edit tags for {station}".
2. Stop the API (or block `POST /api/stations/<id>/tags` in devtools), then pick a tag. The toast reads "Couldn't add the tag. The server couldn't be reached. Check your connection, then check whether the change saved before trying again." The dialog stays open with the old tags.
3. With the API still down, open a dialog that saves (rename a station) and press Save. Its alert reads "The server couldn't be reached. Check your connection, then check whether the change saved before trying again." with "(NETWORK_ERROR)", and the dialog stays open.
4. Restart the API and repeat step 2: the tag is added, with no error.
5. In Help → Troubleshooting, search "failed to fetch": the "Something couldn't reach the server" entry comes first.

## Out of scope

- A non-JSON error body (a proxy's HTML 502) still fails parsing in `sendApiRequest`. It's a different failure with its own fix.
- An offline banner or retry button; per-call network copy beyond each call's existing fallback.
- A file upload's direct PUT to storage (`apps/web/src/api/file-uploads.api.ts`, an XHR) has its own network message and doesn't go through `sendApiRequest`.
