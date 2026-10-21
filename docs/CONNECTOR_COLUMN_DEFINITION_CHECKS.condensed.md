# Connector column-definition checks — Condensed design (#834)

**Issue:** [EnterpriseBT/portal-ai#834](https://github.com/EnterpriseBT/portal-ai/issues/834) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #832 made a mapping's column definition a reference that needs read (unreadable == absent). The connector flows still use the org's whole catalog:
- The two AI-suggestion catalogs offer every definition in the org.
- The layout-plan and REST-endpoint writes accept any id, even one from another org.
- The REST-endpoint save also creates column definitions without the class create rule.

API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Interpret catalog | `src/services/layout-plan-interpret.service.ts:64` `loadCatalog(orgId)` | the whole org catalog feeds the classifier, so a plan can carry unreadable ids |
| REST probe catalog | `src/adapters/rest-api/rest-api.adapter.ts:1217`, `:1388` | same, for the discover-columns suggestions |
| Draft commit | `src/services/layout-plan-draft.service.ts:132` `prepareDraftCommit` | the plan comes from the request body; nothing checks its ids |
| Plan patch | `src/services/connector-instance-layout-plans.service.ts:196` `patch` | the merged plan is schema-validated only |
| Recommit / sync | `layout-plan-draft.service.ts:449`, the Google Sheets / Excel adapters | replay the **stored** plan |
| Reconcile | `src/services/field-mappings/reconcile.ts:177`, `:256` | an id missing from `catalogById` is still upserted, so another org's id would land |
| REST endpoint save | `src/routes/api-endpoints.router.ts:174` `materializeColumns` | adopts the draft's `columnDefinitionId` unchecked; on no key match, calls `columnDefinitions.create` without the class rule (`column-definition.router.ts:453`); runs **after** the entity is committed, so a failure leaves it half-made |
| Batch read check | `src/services/parent-access.service.ts:271` `firstRefusal(set, org, "column_definition", ids, "read")` | added by #832 |

## Decision — references are checked where they enter, against the caller

The same rule as `POST /api/field-mappings`: a referenced definition must be in the org **and** readable, or `404 COLUMN_DEFINITION_NOT_FOUND`. Resending a stored reference isn't re-checked.

- **Interpret is checked on the way in (review).** A region hint naming an unreadable definition → 404 before interpreting. An id the classifier returns outside the readable catalog falls back to the `text` definition, or is unbound if there's none. The stored plan is replayed unchecked by recommit, so it can't carry an unchecked reference.
- **Suggestions offer only readable definitions.** `loadCatalog` and the probe catalog take the caller's `PermissionSet` and keep the rows `set.can("resource.read", {type, id, createdBy})` allows (the #832 `station_context` filter). The AI then can't put an unreadable id into a plan or draft.
- **Draft commit** checks every column-definition id in the body's plan (`firstRefusal`) before any write.
- **Plan patch** checks only the ids the patched plan adds over the stored plan. The editor resends the whole plan, and an owner-authored plan must stay editable.
- **Recommit and sync** replay the stored plan, which was checked on the way in, so they aren't re-checked. That's the same as a stored mapping.
- **Commit checks up front (review).** Every definition a reconciled target binds must still be in the org catalog, checked before the first target writes. A since-deleted or foreign id refuses cleanly (404) instead of committing part of the plan.
- **Reconcile fails closed on a foreign id.** A binding whose id isn't in the org catalog → `404 COLUMN_DEFINITION_NOT_FOUND`, with no upsert. This guards every caller, sync included, against a plan that predates the checks.
- **REST endpoint save resolves every column before writing anything.** Resolution moves ahead of the entity transaction:
  - an adopted id must pass `firstRefusal`;
  - a key match uses readable definitions only;
  - a column with no readable match is a new definition, and creating one needs the class rule (`PermissionService.check(…, "resource.write", {type: "column_definition"})`), as on `POST /api/column-definitions`. A refusal is `403 PERMISSION_DENIED` and nothing is written.
  - A fresh column whose key belongs to a definition the caller can't read → `409 COLUMN_DEFINITION_KEY_CONFLICT`, before any write. This only applies to callers who passed the create rule.
  - The wizard doesn't gate Save on the create rule yet, so a caller without it sees the 403 in the dialog. Default members can't open the Connectors pages, so only a custom policy reaches this. The gate is follow-up #838.
  - **Why not never create:** the wizard's normal flow mints definitions for new columns, and the class rule is the existing gate for doing so.

## Plan — one slice

**Files**
- Edit: `layout-plan-interpret.service.ts` (`analyze`/`loadCatalog` take `set`), `rest-api.adapter.ts` (the probe catalog takes `set` through its ctx/options), `layout-plan-draft.service.ts`, `connector-instance-layout-plans.service.ts`, `field-mappings/reconcile.ts`, `routes/api-endpoints.router.ts`.
- Edit: `routes/layout-plans.router.ts` and `routes/connector-instance-layout-plans.router.ts` pass `PermissionService.loadSet(metadata)`.
- Edit: the description in `route-authorization.map.ts` for the affected routes.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`)
- `src/__tests__/__integration__/services/field-mappings/reconcile.integration.test.ts`: a binding with another org's id → 404, and no mapping is written.
- `src/__tests__/__integration__/routes/layout-plans.router.integration.test.ts`: a draft commit naming an unreadable definition → 404, with no instance or entity created.
- `src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts`:
  - a patch adding an unreadable id → 404;
  - a patch resending the stored plan → 200.
- `src/__tests__/__integration__/routes/api-endpoints.router.integration.test.ts`:
  - an adopted unreadable id → 404, no entity;
  - a new column without the create rule → 403, no entity and no definition;
  - with the rule → 201, and the definition is created;
  - a key match on a readable definition reuses it.
- `src/__tests__/__integration__/routes/api-endpoints.discover-columns.integration.test.ts` and `src/__tests__/adapters/rest-api/rest-api.adapter.test.ts`: the probe catalog excludes an unreadable row; `layout-plans.router.integration.test.ts`: the same for the interpret catalog.

## Smoke (manual, against your dev stack)

Set up in `e2e-fixture`: as **owner**, create column definition `zz_secret`, and give **member** write on a REST-API connector they created (or grant `write connector_instance` on one).

1. As **member**, `POST /api/connector-instances/<ci>/api-endpoints` with a column whose `columnDefinitionId` is `zz_secret`'s id → 404 `COLUMN_DEFINITION_NOT_FOUND`. `GET …/api-endpoints` shows no new entity.
2. As **member**, the same POST with a column `brand_new_key` that has no `columnDefinitionId` → 403 `PERMISSION_DENIED`. No `brand_new_key` definition exists.
3. As **owner**, step 2's body → 201. The `brand_new_key` definition exists and is mapped.
4. As **member**, `PATCH …/layout-plan/<plan>` adding a binding to `zz_secret` → 404. Resending the stored plan unchanged → 200.
5. As **member**, `POST /api/layout-plans/commit` with a plan whose binding names `zz_secret` → 404, and no connector instance is created.
6. As **member**, `POST …/discover-columns` on their endpoint: no suggestion names `zz_secret`.

## Out of scope

- Re-checking stored plans on recommit or sync. They were checked on the way in; reconcile's org check is the backstop.
- Members reaching the connector pages. Page visibility is unchanged.
