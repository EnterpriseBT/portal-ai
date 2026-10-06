# Unreadable objects answer 404 on every verb — Condensed design (#713)

**Issue:** [EnterpriseBT/portal-ai#713](https://github.com/EnterpriseBT/portal-ai/issues/713) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). The ticket named stations; the audit found the same gap in 22 routes across 10 routers (see Sizing note).

**Why.** The authorization rule (CLAUDE.md, API Style Guide) is that an object the caller can't read is absent: 404 on every verb, and 403 only when it's readable but not changeable. Today many by-id write/delete routes load org-scoped and go straight to `check(write|delete)`. So a same-org object the caller can't read answers **403** to PATCH/DELETE while its GET answers 404, and that reveals the id exists. Under the seeded `MemberAccess` policy (own objects only, `seed.service.ts:749`), every other member's object hits this today. Mostly `apps/api`, plus one `apps/web` change so a refused action still refreshes the page.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Read predicate | `services/object-access.service.ts:19` `readableInOrg(set, orgId, type, row)` | row exists + same org + `can("resource.read")`; non-throwing |
| Throwing loaders (the pattern) | `connector-instance-access.service.ts:31`, `portal-access.service.ts:29` | missing / cross-org / unreadable → 404, then `check(verb)` → 403 |
| Routes already correct | portal, entity-tag-assignment, entity-group-member, curated-view attach/detach, grants, instance sub-routes, entity-record import/revalidate/clear | load via the above or a route-local `assert*Readable/Writable` |
| Web refresh-after-refusal | `apps/web/src/utils/api.util.ts:231-238` | `onPermissionDenied` invalidates only when `isPermissionDenied(error.code)` |

**GAP routes** (load + org compare, then write/delete check with no read check), all under `apps/api/src/routes/`. Line numbers are the write/delete checks:
- `station.router.ts`: PATCH :693, DELETE :879
- `portal-results.router.ts`: POST /:id/refresh :365, PATCH :697, DELETE :799
- `curated-view.router.ts`: PATCH ~:538, DELETE ~:656
- `connector-entity.router.ts`: PATCH :769, DELETE :1051 (DELETE skips the check entirely when the row is missing)
- `entity-record.router.ts`: record PATCH :1306, DELETE :1475 (the parent is read-checked, the record isn't)
- `field-mapping.router.ts`: PATCH :700, DELETE :1093
- `column-definition.router.ts`: PATCH :636, DELETE :1044
- `entity-tag.router.ts`: PATCH :537, DELETE :675
- `entity-group.router.ts`: PATCH :604, DELETE :847
- `connector-instance.router.ts`: DELETE :1434, PATCH :1615, POST /:id/sync :1914

## Decision 1 — one throwing check, not 22 hand-written ones

Options: (a) add `if (!readableInOrg(...)) 404` before each check, by hand; (b) a throwing helper on `ObjectAccessService` that every route calls once.

**Decided (b):** `ObjectAccessService.loadForVerb(set, orgId, type, row, verb, notFound: () => ApiError)`.
- It throws `notFound()` when `readableInOrg` fails, then `set.check("resource.<verb>", object(type,row))`.
- It returns the row narrowed to non-null.
- Each GAP route replaces its org compare + check with one call, keeping its own `*_NOT_FOUND` code.
- Why: one place encodes "404 before 403", so a new route can't half-apply it. It mirrors `ConnectorInstanceAccessService.load` for routes that already hold the row.

## Decision 2 — a refused action on a vanished object still refreshes the page

After the fix, editing an object whose share was revoked under an open page gets a **404**. `onPermissionDenied` fires only on `PERMISSION_DENIED`, so the page would keep offering Edit: the exact staleness #711 fixed (smoke §3.2 / §6).

**Decided:** `useAuthMutation` also runs the `onPermissionDenied` invalidation when the error's `status === 404`. "Access to this object changed" now covers both answers. The name stays; its JSDoc says it covers 403 permission and 404 gone. The caller's `onError` and feedback are unchanged.

## Plan — 2 slices

**Slice 1 — API (`fix(api)`)**
- Files:
  - Edit `services/object-access.service.ts` (add `loadForVerb`).
  - Edit the 10 routers above.
  - Edit `__tests__/config/route-authorization.map.ts`: each GAP entry's `by` text gains "unreadable → 404".
- Tests:
  - New `apps/api/src/__tests__/services/object-access.service.test.ts` cases for `loadForVerb`: missing, cross-org, unreadable → 404 via `notFound`; readable but not permitted → 403; permitted → returns the row.
  - New table in `__integration__/routes/same-org-access.authorization.integration.test.ts`: for each GAP route, an owner-created object, then as a member (MemberAccess) → **404 + the route's `*_NOT_FOUND` code**, and nothing written.
  - Flip the existing 403 assertions the audit found:
    - `nav-object-enforcement…:345` (connector sync)
    - `field-mapping.router.integration.test.ts:2203`
    - the curated-view and connector-instance router suites.
    - Keep 403 cases where the caller *can* read (e.g. `station.enforcement` read-only grantee).
- `npm run test:unit` + `npm run test:integration` (api), `lint`, `type-check`.

**Slice 2 — web (`fix(web)`)**
- Files: edit `apps/web/src/utils/api.util.ts` (invalidate on `isPermissionDenied(code) || status === 404`).
- Tests: `auth-mutation-permission-denied.test.tsx` gains "404 invalidates" and "500 doesn't". `npm run test:unit` (web).

## Smoke (manual, against your dev stack)

Fixtures: owner, member (seeded `MemberAccess`) in e2e-fixture; tokens from `packages/e2e/.auth/*.storageState.json`.

1. As **owner**, create a station, a view and a pin; don't share them. As **member**:
   - `PATCH` and `DELETE` each (`/api/stations/:id`, `/api/curated-views/:id`, `/api/portal-results/:id`) → **404** with the type's `*_NOT_FOUND` code, matching its GET.
   - Nothing changed (check as owner). — backend
2. Same for an owner-created connector instance (`PATCH`, `DELETE`, `POST /:id/sync`), column definition and tag → 404, and nothing changed. — backend
3. Share the station with the member at **Read**. `PATCH` as member → **403** `PERMISSION_DENIED` "You don't have permission to edit this station." (readable but not permitted still says so). — backend
4. Browser, as **member**:
   - share the station at **Read & write** and open it;
   - as **owner**, revoke the share entirely;
   - as **member**, Edit → Save.

   Expected: the dialog shows "Station not found (STATION_NOT_FOUND)". After Cancel, the page re-fetches and shows "Station not found". No Edit is left on a dead page.
5. Cross-org: as member, `PATCH /api/stations/<another org's station>` → 404, unchanged. — backend

## Out of scope

- **Toolpacks.** Their GET is class-gated (`requirePermission("resource.read","toolpack")`), so a member already gets 403 on read too. PATCH/DELETE answering 403 leaks nothing.
- **Jobs cancel** (`jobs.router.ts:~368`). Every member reads every job, so it can't happen today. It's a latent gap only for a custom role scoped to fewer jobs: file it if one is introduced.
- **Unreadable-object reads** are already 404 (#692); this ticket only fixes writes and deletes.
