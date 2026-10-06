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
  - New case in `__integration__/routes/object-capabilities.agreement.integration.test.ts`, which already seeds every type. For each type's write routes (PATCH, DELETE, pin refresh, connector sync):
    - an owner-created row, as a member (MemberAccess) → the **same 404 + `*_NOT_FOUND` as its GET**, and the row survives;
    - for member-readable types, a system row → **403 `PERMISSION_DENIED`**.
  - Flip the one existing 403 assertion on an unreadable object: `nav-object-enforcement…` connector sync → 404 `CONNECTOR_INSTANCE_NOT_FOUND`. The other suites the audit flagged already target rows the caller can read, and pass unchanged.
- `npm run test:unit` + `npm run test:integration` (api), `lint`, `type-check`.

**Slice 2 — web (`fix(web)`)**
- Files: edit `apps/web/src/utils/api.util.ts` (invalidate on `isPermissionDenied(code) || status === 404`).
- Tests: `auth-mutation-permission-denied.test.tsx` gains "404 invalidates" and "500 doesn't". `npm run test:unit` (web).

## Smoke (manual, against your dev stack)

Untagged steps can be walked in the browser (`/smoke-walk`). `— backend` is an API probe.

**Coverage:**
- Decision 1 (404 before 403 on every write) → S1–S4.
- Decision 2 (a 404 refreshes the page) → S5–S6.
- Cross-org → S7.

**Preflight**
- [ ] `git checkout fix/713-unreadable-station-404 && git pull --ff-only`. No migration. `npm run dev` (API :3001, web :3000).
  - Make sure :3001 is nodemon's own child, not an orphaned server from an earlier checkout: `ps -o ppid= -p $(lsof -ti :3001)` isn't `1`.
- [ ] `npm run --workspace @portalai/e2e e2e:auth:all`. Owner and member switched into **e2e-fixture**.
- [ ] Bearer tokens `$OWNER`, `$MEMBER` from `packages/e2e/.auth/*.storageState.json`. — backend
- [ ] As **owner**, create, unshared:
  - station **s713** (`POST /api/stations {"name":"s713"}`);
  - a view on the Sandbox entity (or reuse **Smoke Contours** with no share);
  - a tag **t713**.

  Note an owner-created connector instance, entity, field mapping, column definition and record id (`GET` lists as owner). — backend

**Reset:** delete **s713** and **t713**. Revoke any share made below. — backend

**S1 — unreadable answers its GET's 404 on every write** — backend
- [ ] As **member**, `GET /api/stations/<s713>` → 404 `STATION_NOT_FOUND`.
- [ ] As member, `PATCH /api/stations/<s713> {"name":"x"}` → **404 `STATION_NOT_FOUND`**.
- [ ] As member, `DELETE /api/stations/<s713>` → **404 `STATION_NOT_FOUND`**.
- [ ] As owner, s713 is unchanged.
- [ ] Same for the view: `PATCH /api/curated-views/<id> {"label":"x"}` and `DELETE` → 404 `CURATED_VIEW_NOT_FOUND`.
- [ ] Same for the tag: `PATCH /api/entity-tags/<id> {"name":"x"}` and `DELETE` → 404 `ENTITY_TAG_NOT_FOUND`.

**S2 — the action routes and the data types** — backend
- [ ] Connector instance:
  - `PATCH {"name":"x"}` → 404 `CONNECTOR_INSTANCE_NOT_FOUND`;
  - `POST /api/connector-instances/<id>/sync` → 404 `CONNECTOR_INSTANCE_NOT_FOUND`;
  - `DELETE` → 404 `CONNECTOR_INSTANCE_NOT_FOUND`;
  - the instance still exists and no sync job was queued (`GET /api/jobs` as owner).
- [ ] Column definition `PATCH {"label":"x"}` / `DELETE` → 404 `COLUMN_DEFINITION_NOT_FOUND`.
- [ ] Entity `PATCH {"label":"x"}` / `DELETE` → 404 `CONNECTOR_ENTITY_NOT_FOUND`.
- [ ] Field mapping `PATCH {"sourceField":"x","columnDefinitionId":"<any id>"}` → 404 **`FIELD_MAPPING_NOT_FOUND`**: the mapping is authorized before the body's column definition. `DELETE` → 404 `FIELD_MAPPING_NOT_FOUND`.
- [ ] Record `PATCH /api/connector-entities/<eid>/records/<rid> {"data":{"a":1}}` / `DELETE` → 404. Expect the parent's `CONNECTOR_ENTITY_NOT_FOUND`, since the member can't read the entity either.
- [ ] Pin: if one exists (pin a result from an owner portal), `PATCH {"name":"x"}`, `DELETE` and `POST /api/portal-results/<id>/refresh` → 404 `PORTAL_RESULT_NOT_FOUND`. If none exists, record that the CI agreement suite covers it.

**S3 — missing ids answer the same 404** — backend
- [ ] As **owner**, `DELETE /api/connector-entities/<random uuid>` → 404 `CONNECTOR_ENTITY_NOT_FOUND`. It used to skip the check and fall through to the delete service.
- [ ] `PATCH /api/stations/<random uuid>` → 404 `STATION_NOT_FOUND`, the same body as an unreadable station's.

**S4 — readable but not permitted is still 403** — backend
- [ ] As **owner**, share **s713** with the member at **Read**.
- [ ] As member, `PATCH /api/stations/<s713> {"name":"x"}` → **403 `PERMISSION_DENIED`** "You don't have permission to edit this station."
- [ ] As member, `DELETE` → 403 "You don't have permission to delete this station."
- [ ] Revoke the share.

**S5 — revoked under an open page: the page refreshes (station)**
- [ ] As **owner**, share **s713** with the member at **Read & write**.
- [ ] As **member**, open the station page.
- [ ] As **owner**, revoke the share entirely (`DELETE /api/grants/<id>`). — backend
- [ ] As **member**, on the open page: More actions → **Edit** → change the name → **Save**. Expected:
  - the network shows the PATCH 404 followed by a GET of the station (404);
  - the page replaces itself with "Station not found", closing the dialog with it, so there's no stale Edit;
  - nothing renamed (check as owner).

  The dialog's own alert may not be seen, because the refresh lands at once. That's acceptable: the page says the station is gone.

**S6 — deleted under an open page: the page refreshes (view)**
- [ ] As **owner**, share a view with the member at **Read & write**.
- [ ] As **member**, open the view's page.
- [ ] As **owner**, delete the view. — backend
- [ ] As **member**, **Edit** → **Save**. Expected: the PATCH answers 404 `CURATED_VIEW_NOT_FOUND`, the view re-fetches, and the page shows the view as not found with no Edit left. The dialog may close with the page.

**S7 — cross-org** — backend
- [ ] As **member**, `PATCH` and `DELETE` a station in an org the member doesn't belong to (create one in the owner's **My Organization**) → 404 `STATION_NOT_FOUND`; it's unchanged.

**Sign-off**
- [ ] Every step above verified against my own running stack — <date + name>

**Bug-filing:** Step · Expected · Got · Repro · Identifiers (org/user/object ids, response body).

## Out of scope

- **Toolpacks.** Their GET is class-gated (`requirePermission("resource.read","toolpack")`), so a member already gets 403 on read too. PATCH/DELETE answering 403 leaks nothing.
- **Jobs cancel** (`jobs.router.ts:~368`). Every member reads every job, so it can't happen today. It's a latent gap only for a custom role scoped to fewer jobs: file it if one is introduced.
- **Unreadable-object reads** are already 404 (#692); this ticket only fixes writes and deletes.
