# Microsoft Excel Cloud Connector — Phase E Spec

**Reconnect / error recovery.**

This spec covers the user-facing recovery path when Microsoft has revoked or rotated-away our refresh token, and the related polish around concurrent-rotation contention. Most of the persistence side already exists from Phase A (the cache layer flips the instance to `status="error"` on `invalid_grant`); Phase E adds the UX surface (Reconnect button), the `handleCallback` reset path (which Phase A's tests already cover but Phase E exercises end-to-end), and a single targeted retry around the `invalid_grant`-from-rotation-race case.

The Reconnect surface is largely connector-agnostic — Google's Phase E built it. Phase E for Excel is mostly verification + small additions, plus the Microsoft-specific retry-once on contention.

Discovery doc reference: §"Refresh-token rotation", §"Migration & Rollout — Phase E".

---

## Scope

### In scope

1. **Reconnect button on the connector card** — already renders from Google's Phase E for any instance whose `status === "error"` and whose connector definition has `auth_type === "oauth2"`. The render gating is connector-agnostic; the button click delegates to `useReconnectConnectorInstance`, which is the hook generalized in scope item 5 below. After that hook gains slug dispatch, the card's Reconnect button works for `microsoft-excel` instances with no further code changes.
2. **`handleCallback` reset semantics** — verified end-to-end:
   - When the OAuth dance completes for an existing `(org, tenantId, upn)` instance whose `status === "error"`, the row is updated with `status: "active"`, `lastErrorMessage: null`, and the new credentials. Phase A's `handleCallback` tests already cover this; Phase E adds an integration test that drives the full Reconnect flow (revoke → sync → status=error → reconnect → status=active → sync succeeds).
3. **Single-flight retry on `invalid_grant` from rotation contention.** The narrow case: two concurrent requests inside one process both miss the cache, the in-process single-flight de-dups them, but the upstream Microsoft refresh fails because *another process* (or a recently-completed call from this process whose state was lost) has already rotated the token. Today (post Phase A) that surfaces as `status="error"` immediately, requiring a manual Reconnect.
   - **Behavior change:** in `MicrosoftAccessTokenCacheService.refreshAndStore`, on `invalid_grant`, attempt **one** retry by re-reading the instance from the DB (in case another process/call has already persisted a new refresh token) and retrying the refresh against the freshly-read token. If the freshly-read token is the same one we just tried (no concurrent rotation happened), skip the retry — go straight to `status="error"`. If the retry also fails, mark `status="error"` and propagate.
   - This is a deliberately narrow tweak. It addresses the multi-process scaling pain without trying to coordinate across processes via Redis SET NX (out of scope; documented as the next step if the retry-once still doesn't suffice).
4. **`MICROSOFT_OAUTH_REFRESH_TOKEN_RACE` API code** — new code emitted when the rotation-race retry succeeds (logged for observability, not surfaced to the user) and as the `lastErrorMessage` when the retry also fails (so the UI's error tooltip can distinguish "we tried" from "first-time `invalid_grant`").
5. **Generalize `useReconnectConnectorInstance` to dispatch by connector slug.** Today (`apps/web/src/utils/use-reconnect-connector-instance.util.ts`) the hook is hard-coded to `sdk.googleSheets.authorize()` and `useGooglePopupAuthorize` — its own header comment flags this as the "do this when the second OAuth connector lands" generalization point. Phase E does it.
   - The hook accepts a `definitionSlug` argument (or reads it via `sdk.connectorInstances.get(id)` if the slug isn't already at the call site) and dispatches:
     - `slug === "google-sheets"` → `sdk.googleSheets.authorize()`.
     - `slug === "microsoft-excel"` → `sdk.microsoftExcel.authorize()`.
     - Default: throws — no silent fallback.
   - The popup hook becomes `useOAuthPopupAuthorize({ slug, allowedOrigin: apiOrigin() })` (already lifted in Phase A's Slice 3).
   - The toast already supports an inline Reconnect action via `ConnectorInstanceSyncFeedbackUI`'s `showReconnect` / `onReconnect` / `isReconnecting` props (verified at `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx:33-38, 109-122`). The view-layer trigger `isAuthFailureMessage` heuristic at `apps/web/src/views/ConnectorInstance.view.tsx:72-80` already matches `invalid_grant` / `refresh_failed` / `refresh_token` substrings — those substrings are what `MicrosoftAuthError("refresh_failed", …)` and the upstream `invalid_grant` payload emit verbatim, so no heuristic change is needed.
   - **No code lives in this spec for the toast itself or the heuristic** — the work is exactly the hook generalization. Once the hook dispatches by slug, the existing toast Reconnect action and the connector-card Reconnect button start working for `microsoft-excel` instances automatically.

### Out of scope

- Cross-process coordination via Redis SET NX (deferred).
- Email notification when a connector instance flips to `status="error"` (deferred).
- Auto-reconnect via background re-OAuth (not possible — refresh-token reissue requires a user click; Microsoft does not silently refresh).
- Migration of the Reconnect UX itself (Google's Phase E built it; Phase E for Excel verifies + uses it).

---

## Test plan (TDD ordering)

### Unit tests (`apps/api/src/__tests__/services/microsoft-access-token-cache.service.test.ts`)

Extend the Phase A test file.

1. **Rotation-race retry — succeeds on retry:**
   - Two concurrent `getOrRefresh` calls inside the same process.
   - Mock the DB so `findById` returns `refresh_token: "OLD"` initially. After the first refresh attempt (which throws `invalid_grant`), update the mock so `findById` returns `refresh_token: "PERSISTED-BY-OTHER-PROCESS"`.
   - Mock `refreshAccessToken` to throw `invalid_grant` for `"OLD"` and succeed for `"PERSISTED-BY-OTHER-PROCESS"` (returning `{ accessToken: "fresh", refreshToken: "ROTATED-2", expiresIn: 3600, scope }`).
   - Assert the retry happens, the second call succeeds, both promises resolve to `"fresh"`, and the instance ends up with `refresh_token: "ROTATED-2"`.
   - Assert `connectorInstances.update` was called with `lastErrorMessage` = `MICROSOFT_OAUTH_REFRESH_TOKEN_RACE` then cleared on success — or simply not flipped to `status="error"` at all (depending on how we model it; the spec is "no error state on successful retry").
2. **Rotation-race retry — fails on retry:**
   - Same setup but the freshly-read token also fails.
   - Assert the instance is flipped to `status="error"` with `lastErrorMessage: "MICROSOFT_OAUTH_REFRESH_TOKEN_RACE: …"` (the message includes both attempts' upstream errors for diagnostics).
   - The original error propagates.
3. **No retry when no rotation happened:**
   - Mock so `findById` returns the same `refresh_token: "OLD"` both times.
   - Assert the retry is **not** attempted (the cache layer detects the no-rotation case and goes straight to `status="error"`).
4. **No retry on first call (the existing Phase A test still passes):**
   - Single `getOrRefresh`; refresh fails; status flipped; error propagates. (Reconfirms Phase A's behavior is preserved when there's no concurrent contention to resolve.)

### Integration tests (`apps/api/src/__tests__/__integration__/services/microsoft-excel-reconnect.integration.test.ts`)

5. **Reconnect end-to-end:**
   - Seed an instance with bad credentials (the encrypted `refresh_token` decrypts to `"REVOKED"`).
   - Mock `MicrosoftAuthService.refreshAccessToken` to throw `invalid_grant`.
   - Trigger a sync via the shared sync route → expect failure; DB row's `status` flipped to `error`.
   - Run the OAuth callback again with a valid `code` for the same `(org, tenantId, upn)` (mock `MicrosoftAuthService.exchangeCode` to return fresh tokens).
   - Assert the same row id is updated with `status: "active"`, `lastErrorMessage: null`, and the new refresh token.
   - Re-trigger sync; succeeds.
6. **Same UPN, different tenant doesn't repair the wrong row:**
   - Two instances: `(orgA, tenantA, alice@x)` flipped to error; `(orgA, tenantB, alice@x)` healthy.
   - Reconnect with a callback bound to tenantB.
   - Assert tenantA's row remains in `status="error"` (the find-or-update by `(org, tenantId, upn)` from Phase A keys correctly).

### Manual verification

7. Connector card shows the "Reconnect" button when `status === "error"` for `microsoft-excel`.
8. Clicking Reconnect opens the same OAuth popup; completing it heals the row.
9. Forced rotation race: in dev, run two parallel sync triggers via curl while the access token has just expired. Observe in logs:
   - Either both succeed (single-flight de-dup worked).
   - Or one retries (rotation-race retry path engaged); the log line `mexcel.access.rotation_race_retry_succeeded` appears.
10. Revoke Portal.ai's access from the Microsoft account portal; click Sync; the toast shows the error and the "Reconnect" action; clicking it opens the popup; reconnecting heals the instance and the next sync succeeds.

---

## Risks

- **Retry-once doesn't fix all multi-process races.** If two processes refresh simultaneously and both write to the DB, last-writer-wins. The next miss reads the survivor; the loser's access token is still valid in Redis until TTL but its associated refresh token has been replaced. Acceptable — both processes have valid access tokens and the eventual rotation will converge.
- **DB read between failed-refresh and retry adds latency.** One extra `findById` per `invalid_grant`. Negligible — `invalid_grant` is rare in steady state.
- **Reconnect changes the credentials but the workbook cache is not invalidated.** Cache TTL handles it within 30 minutes; if the user wants an immediate fresh fetch, "Sync now" goes through `fetchWorkbookForSync` which doesn't read the cache. Document this in the service header.
