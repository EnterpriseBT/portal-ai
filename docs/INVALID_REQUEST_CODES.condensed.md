# Malformed-request 400s say so — Condensed design (#742)

**Issue:** [EnterpriseBT/portal-ai#742](https://github.com/EnterpriseBT/portal-ai/issues/742) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Several API routes answer a **malformed request** with a 400 whose `code` says an object is **missing**: `PORTAL_NOT_FOUND`, `PORTAL_RESULT_NOT_FOUND`, `MAP_TILE_NOT_FOUND`. Clients key off `code`, so a bad body or path parameter reads as "it's gone". #706 fixed the station routes the same way. This fixes the rest and adds a guard so a new one can't land. Only `apps/api` changes.

## Current shape

An AST scan of `apps/api/src` for `new ApiError(4xx≠404, ApiCode.*_NOT_FOUND, …)` finds:

| Site | Request | Today |
|---|---|---|
| `routes/portal.router.ts:101` | `POST /api/portals`, body fails `CreatePortalBodySchema` | `400 PORTAL_NOT_FOUND` "Invalid portal payload" |
| `routes/portal.router.ts:614` | `PATCH /api/portals/:id`, neither `name` nor `lastOpened` | `400 PORTAL_NOT_FOUND` "name or lastOpened is required" |
| `routes/portal.router.ts:754` | `POST /api/portals/:id/messages`, body fails `SendMessageBodySchema` | `400 PORTAL_NOT_FOUND` "Invalid message payload" |
| `routes/portal-results.router.ts:124` | `POST /api/portal-results`, body fails `PinResultBodySchema` | `400 PORTAL_RESULT_NOT_FOUND` "Invalid pin result payload" |
| `routes/portal-results.router.ts:685` | `PATCH /api/portal-results/:id`, no `name` | `400 PORTAL_RESULT_NOT_FOUND` "name is required" |
| `routes/portal-map.router.ts:53`, `:61` | tile `z` out of 0–22; `x`/`y` out of range | `400 MAP_TILE_NOT_FOUND` |
| `routes/portal-map.router.ts:222` | non-integer `blockIndex` | `400 MAP_TILE_NOT_FOUND` |
| `routes/field-mapping.router.ts:1256` | a bidirectional mapping names a target that doesn't exist | `400 FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND`, a **correct** use: a not-found *reference* inside a valid body |
| `queues/processors/bulk-transform.processor.ts:179` | a bulk job names a tool not dispatchable on the station | `400 BULK_DISPATCH_TOOL_NOT_FOUND`, also a reference |

The precedent is #706's `STATION_INVALID_PAYLOAD`, which puts the first issue in the message (`describeFirstZodIssue`, `apps/api/src/utils/zod-issue.util.ts`) and `{ issues }` in `details`. Nothing in `apps/web` reads these codes: the map widget's tile status is status-only (`tile-source.util.ts:67`).

The same scan also finds **403s** with `*_NOT_FOUND` codes. `MEMBERSHIP_NOT_FOUND` (×2) is a real "you aren't a member" refusal. But `CONNECTOR_INSTANCE_NOT_FOUND` "Connector instance belongs to a different organization" (×5: `google-sheets-connector.service.ts:387`, `:447`; `microsoft-excel-connector.service.ts:436`, `:562`; `layout-plan-draft.service.ts:155`) answers a foreign id with a 403 while an unknown id gets a 404. That reveals another org's object exists, against #713's "unreadable == absent". It's a security bug, not a mislabel, and is filed as #743 (see Out of scope).

## Decision — domain invalid codes, one helper, and a 400 guard

1. **New codes:** `PORTAL_INVALID_PAYLOAD`, `PORTAL_RESULT_INVALID_PAYLOAD` and `MAP_TILE_INVALID_REQUEST` (the tile errors are path parameters, not a body). Each of the eight sites uses its domain's code; the messages stay as they are, or become specific for the schema ones.
2. **One helper for schema failures:** `invalidPayload(code, label, error)` in `utils/zod-issue.util.ts` returns the `ApiError` (`400`, ``${label}: ${describeFirstZodIssue(…)}``, `{ issues }`). The three schema sites (`portal.router.ts:101`, `:754`, `portal-results.router.ts:124`) use it, and so does `station.router.ts`, replacing its local copy from #706. The two hand-rolled checks (`:614`, `:685`) keep their exact messages and change only the code.
3. **A guard test** (`apps/api/src/__tests__/invalid-request-code.guard.test.ts`) scans `apps/api/src` with the TypeScript AST. It fails on any `new ApiError(400, ApiCode.*_NOT_FOUND, …)` outside an allowlist, and the allowlist holds the two reference cases. The allowlist is shrink-only, and an entry that no longer exists fails too, in the spirit of `permission-copy.guard.test.ts`. The guard covers **400 only**: the 403 `MEMBERSHIP_NOT_FOUND` sites are correct, and the cross-org 403s are their own security fix.

The `@openapi` 400 descriptions on the touched routes name the new codes.

## Plan — one slice

**Files**
- Edit: `apps/api/src/constants/api-codes.constants.ts`: add the three codes.
- Edit: `apps/api/src/utils/zod-issue.util.ts`: add `invalidPayload`.
- Edit: `routes/portal.router.ts`, `routes/portal-results.router.ts`, `routes/portal-map.router.ts`: the eight sites plus `@openapi`.
- Edit: `routes/station.router.ts`: use the shared `invalidPayload` and drop its local copy.
- New: `apps/api/src/__tests__/invalid-request-code.guard.test.ts`.

**Tests**
- Guard: a self-test on embedded fixtures (flags `new ApiError(400, ApiCode.X_NOT_FOUND, …)`, ignores 404 and allowlisted codes), then the real tree is clean, and every allowlist entry still exists.
- `__tests__/utils/zod-issue.util.test.ts`: `invalidPayload` builds the 400, message and details.
- Integration (`portal.router.integration.test.ts`, `portal-results.router.integration.test.ts`): POST portal `{}`, PATCH portal `{}` and POST message `{}` (the existing status-only tests now also assert the code and message), plus new POST pin `{}` and PATCH pin `{}`. Tile coordinates: `__tests__/routes/portal-map.router.test.ts` (`parseTileCoords`) asserts `MAP_TILE_INVALID_REQUEST`. The route-level `blockIndex` check has no route test harness (the map suite calls the service directly), so it's covered by smoke step 4 and the guard.
- `npm run type-check`, `lint`, the touched unit and integration suites.

## Smoke (manual, against your dev stack)

1. As the e2e owner, `POST /api/portals {}` → 400 `PORTAL_INVALID_PAYLOAD` with the first issue in the message.
2. `PATCH /api/portals/<yours> {}` → 400 `PORTAL_INVALID_PAYLOAD` "name or lastOpened is required"; `POST /api/portals/<yours>/messages {}` → 400 `PORTAL_INVALID_PAYLOAD`.
3. `POST /api/portal-results {}` and `PATCH /api/portal-results/<a pin> {}` → 400 `PORTAL_RESULT_INVALID_PAYLOAD`.
4. `GET /api/portal-map/tiles/message/<geo msg>/0/23/0/0` and `…/abc/0/0/0` → 400 `MAP_TILE_INVALID_REQUEST`. A real map tile still loads (200).

## Out of scope

- The cross-org **403** `CONNECTOR_INSTANCE_NOT_FOUND` existence leak (5 sites in 3 services). It's a security fix (it should be 404, the same answer as unknown), filed as #743 together with the recommit authorization hole it turned up.
- `MEMBERSHIP_NOT_FOUND` 403s: correct as they are.
- Making other routers' body schemas strict (#706 did stations only).
