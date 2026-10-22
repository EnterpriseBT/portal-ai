# View-management toolpack — Discovery

**Issue:** [EnterpriseBT/portal-ai#645](https://github.com/EnterpriseBT/portal-ai/issues/645)

**Why this exists.** Curated views (#599) are row- and column-scoped projections of an entity. Members get access to a view through a share instead of a raw entity grant. Today views can only be created, edited, shared and deleted on the Views page. An admin working in a portal session ("make a view of accounts filtered to the NE region and share it with the team") has to leave the conversation to do it. The agent is a tool-caller, so the fix is a set of tools, not prompt prose.

This is the `view_management` built-in toolpack. It has six tools: `curated_view_list`, `curated_view_get`, `curated_view_create`, `curated_view_update`, `curated_view_delete` and `curated_view_share`. They behave exactly like the REST routes because they run the same code. The pack is available on every tier, since RBAC decides who can use it (`create` on curated views is a class rule, so in practice owners and admins). The row filter accepts both the structured `FilterGroup` and the #644 SQL filter, with SQL gated by the tier's `advancedViewFilters`. No extra confirmation step: per-object `delete`/`share` is the gate. These answers were folded into the issue body before this survey.

## The current shape

### Curated-view backend: logic lives in the router

| Piece | Location | Note |
|---|---|---|
| List | `apps/api/src/routes/curated-view.router.ts:290` | `visibilityPredicate("curated_view")` :358; `CuratedViewPayloadService.scopeRow` :392; `ObjectCapabilitiesService.attach` :397 |
| Get | `curated-view.router.ts:442` | org check + `can("resource.read")`, unreadable → 404; projection ids :476 |
| Create | `curated-view.router.ts:527–665` | **all inline**: class check :548, `ObjectAccessService.readableInOrg` on the entity :553, duplicate key 409, SQL entitlement, txn, dependency lock :610, projection insert |
| Update | `curated-view.router.ts:694–870` | **all inline**: `loadForVerb(...,"write")` :714, change detection (`canonicalJson` :250), filter-mode clearing :789, SQL entitlement only when text changes :730, lock :751 |
| Delete | `curated-view.router.ts:885` | thin wrapper: `loadForVerb(...,"delete")` :892 → `CuratedViewDeleteService.deleteByIds` (`curated-view-delete.service.ts:44`) |
| Private helpers | `curated-view.router.ts` :81 `validateFilter`, :146–203 `assertProjection`, :216 `assertEntityReadable` | not reachable from a tool |
| SQL filter | `services/curated-view-filter-sql.service.ts` :33 `assertEntitled`, :49 `beforeWrite` (before txn, #314), :59 `validateAndDryRun` (in txn) | `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED` 403 |
| Dependency lock | `services/curated-view-dependency.service.ts:50` `lockEntities` | per-entity xact advisory lock (#802) |
| Share | `routes/grant.router.ts:72` → `GrantService.share` (`services/grant.service.ts:118`), `list` :203, `revoke` :249 | needs `resource.share`; grantee must be member; boundary check; replace-per-principal |
| Payload scoping | `services/curated-view-payload.service.ts:18` (#680) | blanks `filter`/`filterSql`/`filterSqlKeys` for callers without write |
| Session resolution | `PortalSqlService.resolveViewsForSession` (`portal-sql.service.ts:1205`) | only views **attached to the station** and readable by the user |

Contracts: `packages/core/src/contracts/curated-view.contract.ts`. Create :143 (`.strict()`: `connectorEntityId`, `key`, `label`, `description`, `filter`, `filterSql`, `fieldMappingIds`). Update :175 (no `key`/entity change). `oneFilterMode` :130. Key :105 is 1–63 chars with reserved names refused, label is `nameField`, description is `descriptionField`, and `filterSql` is ≤ 4000. Share: `ShareGrantRequestSchema` (`grant.contract.ts:41`). The model (`models/curated-view.model.ts:23–38`) has **no `sourcePortalId`**. The projection is the `curated_view_field_mappings` join table, where empty means all columns.

### Agent tool infrastructure

| Piece | Location | Note |
|---|---|---|
| Pack slugs | `packages/core/src/registries/builtin-toolpacks.ts:33–43` | 9 slugs; `builtin-toolpacks.test.ts:16` pins the count |
| Precedent pack | `RBAC_MANAGEMENT_PACK` :1091; `rbacRead()` :1482 / `rbacWrite()` :1503 | `writes:[]`, `locks:[]`, `costHint:"free"`, `resultKind:"scalar"` |
| Capabilities | `CAPABILITIES` :1529–1735; `attachCapabilities` :1883 throws if missing | |
| Phase labels | `registries/tool-phase-labels.ts:91–110` (rbac) | key set pinned (`tool-phase-labels.test.ts:15`) |
| Tiers | `registries/tier-catalog.ts` standard :131, plus :166 hand-listed; pro/enterprise spread all slugs | `tier-catalog.test.ts:52–56,84–85` |
| Tool classes | `apps/api/src/tools/rbac/*.tool.ts`; helper `rbac-tool.util.ts` (`agentAudit` :28, `runRbac` :43) | service does the permission check; a 403 rethrows into the gate |
| Construction | `ToolService.buildAnalyticsTools` (`services/tools.service.ts:455`); rbac block :818; `BUILTIN_TOOL_NAMES` :205–264 | write gate :907 drops `writes`-tools on read-only stations |
| Gate stack | cost :941 (innermost) → lock :981 → permission :993 → input-character :1004 → output cap :1012 | |
| Per-caller authz | `TOOL_AUTHORIZATION` (`builtin-toolpacks.ts:1757`); `ToolAuthorizationSchema` (`models/tool-capability.model.ts:355–457`); `lock` required, targets limited to record/fieldMapping/connectorEntity/connectorInstance/columnDefinition (`job.model.ts:834`) | **no curated-view lock target** |
| Permission gate | `services/permission-gate.service.ts:118`; catch-403 → `TOOL_PERMISSION_DENIED` :351; `targetNotFound` :71 | descriptor-less tools are checked by their service |
| Existing share tool | `tools/rbac/grant.tool.ts` | `ShareResourceTypeSchema` already includes `curated_view` (`grant.contract.ts:17`); description says "station or pin" only |
| Provenance | `system-principal.guard.test.ts:80–87` `SESSION_CREATING_TOOLS`, :182 `portalId` threading | `0127_object-source-portal-id.sql` skipped `curated_views` |
| Prompt | `PACK_PROMPT_SECTIONS` (`prompts/system.prompt.ts:164`, `Record<BuiltinToolpackSlug,…>`); rbac section :519–560; entity relay guidance :403–416 | `system.prompt.test.ts:818–850` markers |

## The design space

### Decision 1 — Where the view logic lives

**A. Tools call the router's logic through extracted service methods.** Move create/update/get/list bodies (plus `validateFilter`, `assertProjection`, `assertEntityReadable`, `canonicalJson`) into a new `CuratedViewService`. The router becomes parse → service → respond. **B. Tools reimplement the checks.** **C. Tools call the HTTP routes in-process.**

| | A | B | C |
|---|---|---|---|
| Behavior parity | by construction | drifts | yes |
| Router churn | large but mechanical | none | none |
| Fits house style | yes (rbac tools → services) | no | no precedent; double auth context |

**Lean: A.** Two copies of the self-exposure, dependency-lock and SQL-entitlement rules is how they drift. The router's integration tests already pin the behavior the extraction must keep.

### Decision 2 — Authorization path for the tools

**A. rbac_management shape:** `writes:[]`, no `TOOL_AUTHORIZATION` entry, and the service runs `PermissionService.check` / `ObjectAccessService.loadForVerb` itself. The permission gate's catch-403 turns refusals into `TOOL_PERMISSION_DENIED`. **B. Data-plane shape:** declare `writes` plus a `TOOL_AUTHORIZATION` descriptor (`create`/`single` on `curated_view`), so the gate pre-checks.

| | A | B |
|---|---|---|
| Lock descriptor | none needed | required, and no curated-view lock target exists |
| Read-only stations | tools stay available (views are config, not entity data) | write gate (:907) drops them |
| Refusal shape | catch-403 at the gate; 404 needs mapping | gate pre-checks both |
| Check lives with the logic | yes, the same check the route runs | duplicated pre-flight |

**Lean: A.** A curated view is a control-plane object like a policy or group. B would invent a lock target for something no job locks, and hide the tools on read-only stations, where an admin may still want to author views. The issue's mention of the #629 map is about *per-caller gating*, and A delivers that. Gap: the service's 404 (unreadable view or entity) must surface as `TOOL_TARGET_NOT_FOUND`, the same split entity tools give (#835). `runRbac` currently returns non-403 errors as `{error}`, so the view tools need a sibling helper that maps 404 to the typed not-found result.

### Decision 3 — Sharing

**A. Dedicated `curated_view_share`** with `resourceType` fixed, calling `GrantService.share`/`revoke`. **B. Reuse `grant_share`** (rbac_management) and only fix its description.

**Lean: A**, implemented as a thin wrapper over `GrantService`. The user put it in scope, and an agent with only `view_management` enabled shouldn't need a second pack to finish "make it and share it". `grant_share`'s description also gains "curated view", since it already accepts one. One tool with share + revoke (an `access: "none"` or `revoke: true` arg), mirroring the Views page's single share dialog.

### Decision 4 — How the agent names columns

The route takes `fieldMappingIds`. **A. Same ids.** The agent must first find them through another pack (`entity_management`) or `station_context`. **B. Column keys** (`columns: ["region","owner"]`), resolved server-side against the entity's live mappings. Filters already reference keys.

**Lean: B for the tool input, ids in the output.** Keys are what the agent sees in query results and what filters use. Resolution happens in the tool before calling the service, against the entity's mappings. An unknown key is a typed input error naming it. `get`/`list` return both key and id per projected column.

### Decision 5 — Session provenance

CLAUDE.md "Ownership & provenance (#641)" says a session-creatable type gets a `sourcePortalId` column, a model field, the "Created in a portal session" chip, and a `SESSION_CREATING_TOOLS` entry. **A. Do all four. B. Skip provenance.**

**Lean: A.** It's the written rule, and `system-principal.guard.test.ts` holds it. The migration is expand-only (nullable column), so `lint:migrations` is fine. The chip goes on the Views list and detail.

## Tradeoff comparison

|  | D1: extract service | D2: rbac shape | D3: dedicated share | D4: keys in | D5: provenance |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Packages touched | api | core, api | api, core | api | core, api, web |

## Recommendation

1. Add `view_management` to `BuiltinToolpackSlugSchema` with a `VIEW_MANAGEMENT_PACK` mirror, capabilities (`writes:[]`, `locks:[]`, `costHint:"free"`), phase labels, an icon mapping, and entitlement on standard and plus.
2. Extract `CuratedViewService` (`list`, `get`, `create`, `update`) from `curated-view.router.ts`. The router and the tools both call it. Delete goes through the existing `CuratedViewDeleteService` behind a `CuratedViewService.delete` that runs `loadForVerb`.
3. Tools live in `apps/api/src/tools/curated-views/`. They are built in a `view_management` block of `buildAnalyticsTools` with the session `PermissionContext`, and use a `runViewTool` helper that rethrows 403 and maps 404 to `TOOL_TARGET_NOT_FOUND`.
4. `curated_view_get`/`list` return rows through `CuratedViewPayloadService.scopeRow` plus capabilities, so a caller without write never sees filter values.
5. Tool inputs take column keys, resolved to mapping ids on the view's entity. Filter input is `filter` (FilterGroup) or `filterSql`, never both. SQL goes through `CuratedViewFilterSqlService` with the tier entitlement.
6. `curated_view_share` wraps `GrantService.share`/`revoke` for `curated_view`. Add "curated view" to `grant_share`'s description.
7. Add nullable `curated_views.source_portal_id`, the model field, the chip, and `CuratedViewCreateTool` in `SESSION_CREATING_TOOLS`.
8. Add a `view_management` section to `PACK_PROMPT_SECTIONS`. It explains that the agent can't attach views: a new view resolves in a session only once someone attaches it to a station while creating or updating that station, how to read the two refusal codes, and to look up keys before creating.

## Open questions

1. **Attachment — decided.** The agent never attaches a view to a station. Attachment stays a manual step when creating or updating a station. The toolpack manages views themselves and nothing else. `resolveViewsForSession` resolves a tool-created view once someone attaches it, exactly as for a page-created view. The acceptance criterion was reworded to match, and the prompt section tells the agent to say this when it creates a view.
2. **Should list include views the caller can only read?** **Lean: yes.** Same `visibilityPredicate` as the page. Payload scoping already hides filters from read-only callers.
3. **Audit trail.** rbac tools pass `agentAudit(portalId)`. Do view writes have an audit sink? **Lean: provenance (`sourcePortalId`) is the record.** View routes write no audit rows today, and adding one belongs to #179 (centralized audit).
4. **The extraction's blast radius.** The router is 1382 lines, and the filter-sql preview/suggest and attach routes share helpers. **Lean: extract only create/update/get/list plus their private helpers.** Preview/suggest/attach/records stay put and import from the service.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: inherited. The service keeps the per-entity view-dependency lock and SQL `beforeWrite` before the txn (#314). `withUnlocked` isn't needed, because no job locks a view (the routes don't take it either). Duplicate keys still 409 from the partial unique index.
- **Accuracy & auditability.** Lean: `sourcePortalId` + `createdBy` (the prompting user, never the system principal) is the provenance record. A central audit log is #179.
- **Failure modes.** Lean: fail-closed. Every refusal is a typed tool result (`TOOL_PERMISSION_DENIED`, `TOOL_TARGET_NOT_FOUND`, `CURATED_VIEW_*`), never a throw that ends the turn. The SQL entitlement check fails closed (`entitled(key)`).
- **Scale & unbounded growth.** Lean: `curated_view_list` is paginated (`limit` ≤ 100, keyset/`offset` per the route), and the result passes through the existing output cap.
- **Multi-tenancy.** Lean: org comes from the session `PermissionContext`, never input. Unreadable or cross-org views and entities answer not-found.
- **Contract stability.** Lean: the tool contract mirrors the request contracts (same `nameField`/`descriptionField`/`CuratedViewKeySchema`), so a contract change propagates to both.
- **Data lifecycle.** N/A because no new retention: views already soft-delete through the #802 cascade.

## What this doesn't decide

- Station attachment, in any form. A view is attached to a station manually when creating or updating the station. The toolpack is purely for managing the views themselves.
- The Views page UI beyond the provenance chip (#599).
- Filter-SQL **suggest** (the AI authoring endpoint). The agent writes SQL itself; calling a nested model from a tool is a separate cost question.
- Record reads through a view (`GET /:id/records`). Sessions already query views through portal SQL.

## Next step

`/spec 645` writes `docs/VIEW_MANAGEMENT_TOOLPACK.spec.md` (tool contracts, refusal matrix, test plan), then `/plan 645`. Expected slicing: (1) extract `CuratedViewService` with the router on top and existing tests green; (2) `source_portal_id` migration + model + chip; (3) core pack registration (slug, mirror, capabilities, labels, tiers); (4) read tools; (5) create/update/delete tools; (6) share tool + `grant_share` copy; (7) prompt section and pinning tests.
