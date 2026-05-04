# Microsoft Excel Cloud Connector — Phase E Plan

**Reconnect / error recovery.**

Spec: `docs/MICROSOFT_EXCEL_CONNECTOR.phase-E.spec.md`. Discovery: `docs/MICROSOFT_EXCEL_CONNECTOR.discovery.md`.

Tests-first per slice. Run with `cd apps/api && npm run test:unit` and `npm run test:integration`.

---

## Slice 1 — Generalize `useReconnectConnectorInstance` (slug dispatch)

**Files**

- Edit: `apps/web/src/utils/use-reconnect-connector-instance.util.ts` — accept `definitionSlug` (and the existing `connectorInstanceId`); dispatch `authorize` and the popup slug by slug.
- New: `apps/web/src/utils/__tests__/use-reconnect-connector-instance.util.test.tsx`.
- Edit: every call site of the hook to pass the slug. Greppable list:
  - `apps/web/src/views/ConnectorInstance.view.tsx:104` (the only call site found at planning time — re-grep before editing).

**Steps**

1. Write the hook test covering:
   - `slug: "google-sheets"` → calls `sdk.googleSheets.authorize()` and opens the popup with `slug: "google-sheets"`.
   - `slug: "microsoft-excel"` → calls `sdk.microsoftExcel.authorize()` and opens the popup with `slug: "microsoft-excel"`.
   - Unknown slug → throws (no silent fallback per `feedback_no_compat_aliases`).
   - On successful popup → invalidates the connector-instance query (existing behavior preserved).
   - On `PopupClosedError` → silent (existing behavior preserved).
2. Run; verify failures.
3. Refactor the hook:
   - Add `definitionSlug: string` to the hook's signature.
   - Replace the unconditional `sdk.googleSheets.authorize()` / `useGooglePopupAuthorize` calls with a slug-keyed branch. Both SDK groups (`googleSheets`, `microsoftExcel`) expose the same `authorize()` mutation shape — `useAuthMutation<…AuthorizeResponsePayload, void>` — so the dispatch can pick one mutateAsync at top level: `const { mutateAsync: authorizeMutate } = slug === "microsoft-excel" ? sdk.microsoftExcel.authorize() : sdk.googleSheets.authorize();`. Hooks must be called unconditionally, so call BOTH and select between their `mutateAsync` based on slug — this is fine because the mutations are inert until `mutateAsync` is invoked.
   - Replace `useGooglePopupAuthorize({ allowedOrigin: apiOrigin() })` with `useOAuthPopupAuthorize({ slug: definitionSlug, allowedOrigin: apiOrigin() })`.
4. Update call sites. The `ConnectorInstance.view.tsx:104` call has the connector instance loaded (it loads the row to render the page) — pull `definitionSlug` from the loaded row's joined definition and pass it. If the slug isn't already in the loaded instance shape, extend the API include set to surface it.
5. Re-run `cd apps/web && npm run test:unit`. Green.

**Done when:** the hook tests pass for both slugs; `ConnectorInstance.view.tsx` compiles and renders the Reconnect button working for both connectors.

**Manual verification at the end of the slice:**

1. In the dev environment, manually flip a `microsoft-excel` instance to `status="error"` (revoke access in Microsoft and trigger a sync, or directly UPDATE the DB).
2. Confirm the connector card and the sync-failure toast both render the Reconnect button.
3. Click Reconnect on each surface in turn. Confirm the OAuth popup opens against `login.microsoftonline.com` (slug-correct).
4. Complete consent. Confirm the row heals (`status` returns to `active`, `lastErrorMessage` cleared) and the page reflects the new state without manual refresh.
5. Repeat for a Google instance to confirm no regression.

---

## Slice 2 — `MICROSOFT_OAUTH_REFRESH_TOKEN_RACE` API code

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `MICROSOFT_OAUTH_REFRESH_TOKEN_RACE`.

**Steps**

1. Add the enum entry. (No tests for the enum itself.)

**Done when:** the new code is exported.

---

## Slice 3 — Rotation-race retry in `MicrosoftAccessTokenCacheService`

**Files**

- Edit: `apps/api/src/services/microsoft-access-token-cache.service.ts` — add the retry-once branch.
- Edit: `apps/api/src/__tests__/services/microsoft-access-token-cache.service.test.ts` — add the four new test cases per spec §test-plan-#1-4.

**Steps**

1. Write the four new test cases first.
2. Run; verify failures (the retry doesn't exist yet).
3. Implement: in `refreshAndStore`, wrap the `try { ... } catch (err if invalid_grant)` block. On the catch:
   - Re-read the instance via `findById`. Compare `credentials.refresh_token` to the one we just tried.
   - If equal: original behavior — flip to `status="error"` and re-throw.
   - If different: log `mexcel.access.rotation_race_retry_attempted`. Retry the refresh with the freshly-read token.
     - Success: persist as normal, log `mexcel.access.rotation_race_retry_succeeded`. Do not flip status.
     - Failure: flip to `status="error"` with `lastErrorMessage: "MICROSOFT_OAUTH_REFRESH_TOKEN_RACE: <both errors>"`. Throw the second error (or wrap; document the choice).
4. Re-run; green.

**Done when:** all four new tests pass and Phase A's existing tests are still green.

---

## Slice 4 — Reconnect integration tests

**Files**

- New: `apps/api/src/__tests__/__integration__/services/microsoft-excel-reconnect.integration.test.ts`.

**Steps**

1. Write the two integration test cases per spec §test-plan-#5-6.
2. Run; verify behavior matches expectations or surface gaps in the existing `handleCallback` reset path.
3. Adjust adapter / service code if needed.
4. Re-run; green.

**Done when:** both integration tests pass.

---

## Slice 5 — Toast Reconnect verification

The toast already supports an inline Reconnect action via `ConnectorInstanceSyncFeedbackUI` (`apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx:33-38, 109-122`), and the view's `isAuthFailureMessage` heuristic at `apps/web/src/views/ConnectorInstance.view.tsx:72-80` already matches the substrings (`invalid_grant`, `refresh_failed`, `refresh_token`) that Microsoft's refresh failures emit. With Slice 1's hook generalization in place, no further code is required for the toast Reconnect to work for Microsoft.

**Steps**

1. **Verify substring match.** Confirm the upstream Microsoft refresh-failure message contains at least one of `invalid_grant`, `refresh_failed`, or `refresh_token`. The Phase A `MicrosoftAuthError("refresh_failed", …)` message string already includes the literal `refresh_failed`, so this should pass; assert it explicitly with a unit test in `microsoft-auth.service.test.ts` (extend Phase A's file): `expect(error.message).toMatch(/refresh_failed|invalid_grant/i)`.
2. **Manual end-to-end:** revoke access; trigger sync; confirm the failure toast renders the inline Reconnect button; click it; confirm the OAuth popup opens; complete consent; confirm the toast dismisses and the row heals.
3. **Regression check on Google:** repeat against a Google instance.

**If verification fails** — i.e. the toast does NOT show the Reconnect button for a Microsoft auth failure — the gap is in the heuristic. Update `isAuthFailureMessage` to also match the `MICROSOFT_OAUTH_*` codes once the SSE event carries a structured `code` field (see the Phase E §Slice 4 refactor note already in the comment at `ConnectorInstance.view.tsx:68-71`). Capture as a sub-slice with a test.

**Done when:** the toast Reconnect button works for Microsoft sync failures end-to-end without further code changes (or the gap is closed with a sub-slice).

---

## Slice 6 — Manual verification + observability

**Steps**

1. Force an `invalid_grant` (revoke access in Microsoft); trigger sync; observe the row flip to `status="error"`.
2. Click Reconnect on the connector card; complete consent; confirm the row heals.
3. Force a rotation-race scenario in dev: artificially seed two parallel sync triggers (e.g. `for i in {1..2}; do curl -X POST .../sync & done`) immediately after access-token expiry. Observe one of:
   - Both succeed (in-process single-flight covered it).
   - The retry-once fired (look for `mexcel.access.rotation_race_retry_attempted` and `mexcel.access.rotation_race_retry_succeeded` log lines).
4. Confirm the `lastErrorMessage` field on a flipped instance distinguishes `MICROSOFT_OAUTH_REFRESH_FAILED` from `MICROSOFT_OAUTH_REFRESH_TOKEN_RACE`.

**Done when:** the manual checks pass.

---

## Cross-slice checklist before declaring Phase E complete

- [ ] `npm run test:unit && npm run test:integration` green in `apps/api`.
- [ ] `npm run lint && npm run type-check && npm run build` green at the monorepo root.
- [ ] Reconnect end-to-end works in the dev environment for `microsoft-excel`.
- [ ] The rotation-race retry succeeds for the multi-process scenario (verified manually or via integration test).
- [ ] `lastErrorMessage` correctly distinguishes `MICROSOFT_OAUTH_REFRESH_FAILED` from `MICROSOFT_OAUTH_REFRESH_TOKEN_RACE`.
- [ ] Toast Reconnect action verified working for Microsoft sync failures (or the gap closed with a sub-slice that updated `isAuthFailureMessage`).
- [ ] `useReconnectConnectorInstance` dispatches by slug; no remaining `sdk.googleSheets.authorize()` references in the hook.

---

## Post-Phase-E follow-ups (not in scope here)

These are explicitly **not** done in Phase E; they're noted so they can be scheduled later via a `/schedule` agent or a follow-up ticket.

- **Cross-process Redis SET NX coordination** for refresh — only worth doing if the retry-once isn't enough at scale.
- **Email notification** on `status="error"` — connector-agnostic; would benefit Google too.
- **SharePoint document library support** — additional `Sites.Read.All` scope; new file-discovery surface; deferred per the discovery doc.
- **Scheduled / cadence sync** — same posture as Google; deferred until the identity-strategy guard is in place.
- **Microsoft Graph webhook subscriptions** for change-driven sync — replaces manual sync.
- **Picker-based file selection** via Microsoft's File Picker SDK — narrows scope to per-file consent.
