# Default-station audit — Condensed design (#935)

**Issue:** [EnterpriseBT/portal-ai#935](https://github.com/EnterpriseBT/portal-ai/issues/935) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Changing the org's default station writes no audit entry, so Settings → Activity can't say who changed it or when. #907 added `org.update` with `{ field, from, to }` for renames so this could join it without a new action or migration. This records every default-station change (set, change, clear), including the clear a station delete does automatically, and shows it in Activity with the stations named. API + web; reuses #907's action.

## Current shape

| Piece | Location | Note |
|---|---|---|
| PATCH route | `apps/api/src/routes/organization.router.ts` (`PATCH /:id`, ~L205–290) | checks `org.write` for `name`, class write on station for `defaultStationId`; audits `org.update` only for a name change |
| Org write | `apps/api/src/services/organization-update.service.ts` (`apply`) | locks the row, writes the patch, returns `{ organization, previousName }` — no previous default |
| Station delete clears the default | `apps/api/src/routes/station.router.ts` (~L966) | `organizations.updateWhere(org = X and defaultStationId = id, { defaultStationId: null }, tx)`; nothing audited |
| Audit write | `AuditService.record` + `auditContextFromRequest` | post-commit, fail-open; both routes already import them |
| `org.update` action | `packages/core/src/models/audit-log.model.ts` | "#907: an org field changed; metadata `{ field, from, to }`" |
| Activity line | `apps/web/src/utils/audit-summary.util.ts` (`auditActionSummary`) | pure function of `action` + `metadata`; renders only `field: "name"` today |

## Decision — snapshot the station names into the entry

- **A. Resolve names when Activity renders** (join stations by id). Needs a lookup per page, a permission decision per viewer, and a fallback once a station is deleted.
- **B. Store the names in the entry at write time.** Metadata `{ field: "defaultStationId", from, to, fromName, toName }`: ids plus the names as they were. Activity renders from the entry alone.

**Chosen: B.** An audit entry records what happened, so the name as of the change is the right one. It shows to every Activity reader without a per-station check (as decided: names show regardless of station access; opening a station still follows the viewer's own access, and an unreadable one answers 404). It survives the station's deletion. One change to the issue text: a station deleted since still shows its name. The names are read inside the change's own transaction (the PATCH's row lock, the delete's station lock), so they're exact; an entry without a name (odd or legacy) reads a neutral "a station". The new keys are additive to #907's shape; `field`/`from`/`to` mean the same thing.

## Plan — 1 slice

**Files**
- `organization-update.service.ts`: `apply` also returns `previousDefaultStationId` and, when the patch touches the default, that station's name, both read under the row lock. `auditDefaultStationChange(context, orgId, { from, to, fromName, toName })` records the entry and does no lookup (code review: a post-commit lookup could record a later name, and an unscoped one could name another org's station).
- `organization.router.ts`: `assertStation` keeps the new station's name (it already loads it under the lock); after `apply`, when `defaultStationId` was sent and differs from the previous one, record `{ field: "defaultStationId", from, to, fromName, toName }`. Post-commit and fail-open, like the rename. A name change and a station change in one PATCH write two entries.
- `station.router.ts`: inside the delete's transaction, lock the station row and keep its name; when the `updateWhere` cleared the default, record `{ field: "defaultStationId", from: <id>, to: null, fromName: <name>, toName: null }` with the deleting caller's audit context, after commit.
- `audit-log.model.ts`: widen the `org.update` comment to name the new keys.
- `audit-summary.util.ts`: `field: "defaultStationId"` → `Default station set to "B"` (from null), `changed from "A" to "B"`, `cleared (was "A")` (to null); a missing name reads `a station`.
- `@openapi` text on the PATCH route: a default-station change is audited too.

**Tests** (`npm run test:unit`, `npm run test:integration` in each package)
- `apps/api/src/__tests__/__integration__/routes/organization.router.rename.integration.test.ts` (or a sibling default-station suite): set, change and clear each write one entry with ids and names; re-saving the same station writes none; a refused change (no permission, another org's station) writes none; a combined name + station PATCH writes two; the rename entry is unchanged.
- `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`: deleting the default station writes one clear entry attributed to the deleter; deleting a non-default station writes none.
- `apps/api/src/__tests__/services/organization-update.service.test.ts`: `previousDefaultStationId` returned.
- `apps/web/src/__tests__/audit-summary.util.test.ts`: the three phrasings plus the missing-name fallback; `AuditLogActivity.test.tsx`: one rendered default-station line.
- `npm run lint`, `npm run type-check`.

## Smoke (manual, against your dev stack)

1. As an owner, Settings → Organization: set a default station (none before), change it to another, then clear it. Settings → Activity shows three `org.update` lines, newest first: cleared (was "B"), changed from "A" to "B", set to "A", each with your name.
2. Re-save the same station: no new line.
3. Rename the org in the same session: the rename line is unchanged ("Renamed from … to …").
4. Make station C the default, then delete C from Stations. Activity shows "Default station cleared (was "C")" by you; the org has no default.
5. As a member without read on station B (not shared with them) but with `org.audit.read` (an admin, or a custom grant): Activity shows "B" by name; opening B from the Stations list isn't possible for them.
6. As a member without `station.default.set`, `PATCH /api/organization/<org> {"defaultStationId":"<A>"}` → 403 and no Activity line.

## Out of scope

- Moving the default station onto `write org` (stays on `station.default.set`).
- Backfilling past changes (nothing recorded them).
- The CLI path (tracked separately).
- Renaming a station later doesn't rewrite old entries (they keep the name as of the change).
