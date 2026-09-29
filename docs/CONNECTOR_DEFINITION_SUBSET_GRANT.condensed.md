# Connector-definition catalog-subset grant — Condensed design (#638)

**Issue:** [EnterpriseBT/portal-ai#638](https://github.com/EnterpriseBT/portal-ai/issues/638) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The policy editor's **Scope → "Specific objects"** is disabled for `resource = connector_definition`, so an admin can only grant the whole catalog (`read connector_definition`), never a subset (`read connector_definition:<id>`). Every other layer already honors a subset grant (the catalog list filters by it, and the authoring boundary resolves a specific definition), so the editor can do less than its own backend. The cause is **two hand-mirrored lists that drifted apart**: core's `INSTANCE_SEARCHABLE_TYPES` (which turns the picker on) and the server's `SEARCH_CONFIG` (which supplies the candidates). `connector_definition` is missing from both because it is a **global** table and the search query assumes an org column. The survey found the **same drift in the other direction**: `curated_view` is in core's list but not in `SEARCH_CONFIG`, so its picker opens and always comes back empty. Packages: `apps/api` (search service) and `packages/core` (one list).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Server candidate source | `apps/api/src/services/rbac-object-search.service.ts:29-81` | `TypeConfig.orgCol` is required. `SEARCH_CONFIG` has 5 entries (`station`, `pin`, `portal`, `connector_instance`, `entity`) |
| Org filter | `rbac-object-search.service.ts:99-102` | Always adds `eq(cfg.orgCol, caller.organizationId)`. An unknown type returns `[]` (`:91`) |
| Core picker switch | `packages/core/src/models/permission.model.ts:273-293` | `INSTANCE_SEARCHABLE_TYPES` has 6 entries, including `curated_view` (#599). Its doc comment says it "mirrors" the server, but nothing enforces that |
| Editor gate | `apps/web/src/modules/AccessAuthoring/StatementEditor.component.tsx:175` | `pickable = resourceAllowsInstanceScope(row.resourceType)`. Needs no change |
| Search route | `apps/api/src/routes/rbac-object-search.router.ts` | `GET /api/rbac/objects`. Gated on `customRbac` + `member.role.assign`, limit ≤ 50 |
| Catalog subset read | `apps/api/src/routes/connector-definition.router.ts:132-140` | `visibilityPredicate("connector_definition", { createdByCol, idCol })` |
| Authoring boundary | `apps/api/src/services/rbac-object-resolver.ts` (`connector_definition` finder, `GLOBAL_RESOURCE_TYPES`) | The org check is skipped for global types |
| `connector_definitions` | `apps/api/src/db/schema/connector-definitions.table.ts` | `baseColumns` plus `display` (label) and `isActive`. **No `organizationId`** |
| `curated_views` | `apps/api/src/db/schema/curated-views.table.ts` | Has `organizationId` and a `label` column, so it's a normal org-scoped entry |
| Tests | `packages/core/src/__tests__/models/permission.model.test.ts:468-541` (matrix), `apps/api/src/__tests__/__integration__/routes/rbac-object-search.router.integration.test.ts` | The integration test's "data-plane + pseudo + unknown → `[]`" case (`:169`) stays valid |

## Decision — make `orgCol` optional, add both missing types, and pin the mirror with a test

- **Global types.** Make `TypeConfig.orgCol` optional (`orgCol?: PgColumn`) and push the `eq(orgCol, …)` condition only when it's present. Absence is the explicit marker for a global registry, so no second flag is needed. This matches how `rbac-object-resolver.ts` treats `GLOBAL_RESOURCE_TYPES`. The rejected alternative was a separate `GLOBAL_SEARCH_TYPES` set, which would be a third list that could drift.
- **`connector_definition` entry.** `table: connectorDefinitions`, `labelCol: display`, `createdByCol`, `deletedCol`, no `orgCol`. The existing `visibilityPredicate` still applies, so an author only sees the definitions they can read and can't grant beyond what they hold. **Inactive definitions stay searchable:** the resolver accepts them, and granting access to a definition that has been switched off is harmless.
- **`curated_view` entry.** `table: curatedViews`, `labelCol: label`, `orgCol: organizationId`. This fixes the same drift from the other side. It's in scope because the one guard test below can only pass once the lists match.
- **Guard (why this won't recur).** Export `RBAC_SEARCHABLE_RESOURCE_TYPES = Object.keys(SEARCH_CONFIG)` from the service. An integration test asserts it equals `{ t ∈ PERMISSION_RESOURCE_TYPES : resourceAllowsInstanceScope(t) } \ {"page"}` (`page` uses fixed ids rather than search). Either side drifting then fails CI, instead of relying on the "mirrors" comment.

This changes no contract: same route, same payload shape, and a candidate list for a type that previously returned `[]`.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/rbac-object-search.service.ts`: make `orgCol` optional and apply the org condition only when present; add the `connector_definition` and `curated_view` entries; export `RBAC_SEARCHABLE_RESOURCE_TYPES`; update the header comment, since data-plane `view` is now searchable.
- Edit: `packages/core/src/models/permission.model.ts`: add `connector_definition` to `INSTANCE_SEARCHABLE_TYPES`, and change the doc comment to point at the guard test.

**Tests** (written first)
- `packages/core/src/__tests__/models/permission.model.test.ts`: `resourceAllowsInstanceScope("connector_definition")` is `true`. Update any snapshot or enumeration of instance-scoped types that the edit breaks.
- `rbac-object-search.router.integration.test.ts`:
  - owner + `resourceType=connector_definition` → returns definitions from the **global** catalog, including when a second org exists (no org filter); `search=` narrows by `display`.
  - member context (no `read connector_definition`) → `[]` at the service level. This shows the author can't see beyond what they hold.
  - owner + `resourceType=curated_view` → returns this org's views and **not** another org's.
  - mirror guard: `RBAC_SEARCHABLE_RESOURCE_TYPES` equals the core instance-scope set minus `page`.
- Run `npm run test:unit` (core), the integration suite for the api file (`--testPathPattern rbac-object-search`), `npm run type-check`, `npm run lint`, and `npm run format:check`.

## Smoke (manual, against your dev stack)

1. Sign in as an owner/admin of an org entitled to `customRbac`. Go to Settings → **Access** → new custom policy → add statement → Resource `connector_definition` → **Scope** → "Specific objects" is **enabled**.
2. Type part of a connector name (e.g. "file") → the picker lists matching catalog definitions by display name. Pick **File Upload** and save the policy with `read`.
3. Attach the policy to a role held by a test member who has no other `connector_definition` grant. As that member, open the new-connector catalog: **only File Upload** is listed.
4. Back in the editor, Resource `curated_view` → "Specific objects" → the picker lists this org's curated views by label (previously it was always empty).
5. Resource `entity_record` → "Specific objects" stays disabled (no regression to the data-plane rule).

## Out of scope

- Other global registries (e.g. system `column_definition`, `toolpack`) as instance-searchable types. Only `connector_definition` has a resolver finder and a subset-aware read today. Add others when one has a caller.
- Any change to `StatementEditor` or the picker UI. It already routes non-`page` instance types through `onSearch`.
- Ranking or ordering candidates. The current `ILIKE` + `LIMIT` behavior is unchanged.
