# resolve_identity view scoping — Discovery

**Issue:** [EnterpriseBT/portal-ai#658](https://github.com/EnterpriseBT/portal-ai/issues/658)

**Why this exists.** Curated views (#599) are the member read path: a view's row filter, its column projection, and `read field_mapping` (deny-wins) together decide what a member may read. `sql_query`, `display_entity_records`, the visualize tools, the handle-consuming analytics tools and the map tiles all go through that path.

`resolve_identity` does not. It is built from the station's **unscoped** entity groups and reads every live column of every member entity's raw wide table by link value. An integration repro on `main` @ `a6653201` shows it: a member whose only grant is a view over `customers` projecting just `customer_id` gets `customers.name` and the full `orders` row, for an entity they hold no view on.

The survey also found the same pattern in the REST twin, `GET /entity-groups/:id/resolve`. This is the fix that makes identity resolution read through the caller's granted views, so it can never return a column or row that `sql_query` would refuse.

## The current shape

### The bypassing paths

| Piece | Location | Behaviour |
|---|---|---|
| Tool wiring | `apps/api/src/services/tools.service.ts:595-599` | Registered when unscoped `stationData.entityGroups.length > 0`. `build(organizationId, entityGroups)` receives **no `userId` and no `stationId`** |
| Tool | `apps/api/src/tools/resolve-identity.tool.ts:28` | Thin wrapper over `AnalyticsService.resolveIdentity` |
| Resolver | `apps/api/src/services/analytics.service.ts:481-547` | For each member: `fetchProjectedRows(member.connectorEntityId, <all stmt.columns>, { organizationId, where: c_link = value })` (`:516-524`). No limit; errors log and return empty records |
| Result shape | `analytics.service.ts:240-248` | `{ entityGroupName, linkValue, matches: [{ entityKey, isPrimary, records }] }`. `entityKey` is the **connector-entity key** (`:421`), not the view key `sql_query` uses; records are keyed by `normalizedKey` plus `_record_id` (`wide-table.repository.ts:113-172`) |
| Group discovery | `analytics.service.ts:286` (`loadStation`), `:378` (`discoverEntityGroups`) | Groups with ≥2 members loaded on the station; member shape at `:65-85` |
| Gate | `packages/core/src/registries/builtin-toolpacks.ts:1602` (`engineRead("scalar","scan")`), `:1746-1817` (`TOOL_AUTHORIZATION`, writes only) | No descriptor, so `wrapWithPermissionGate` (`apps/api/src/services/permission-gate.service.ts:86`) skips pre-flight. The gate has no concept of view-scoped reads; each read tool owns that |
| REST twin | `apps/api/src/routes/entity-group.router.ts:963-1075` | Gated only by `resource.read entity_group`, then `entityRecords.findHydratedMany` returns full `normalizedData` per member. Used by `apps/web/src/views/EntityRecordDetail.view.tsx:78`. `MemberAccess` holds no `entity_group` read (`DATA_RESOURCE_TYPES`, `packages/core/src/models/permission.model.ts:78`), so it is reachable by admins, who read everything anyway, and by **custom roles granted `read entity_group`** |

### The view-scoped machinery to reuse

| Piece | Location | Notes |
|---|---|---|
| Granted views | `apps/api/src/services/portal-sql.service.ts:207` `resolveGrantedViewColumns(station, org, user)` | The single source of "what this user can see". A class-level `deny read entity_record` empties it (`:239`); station-attached views ∩ `read curated_view` (`:244-264`) → `{ set, views: [{ view, columns }] }` |
| Readable columns | `portal-sql.service.ts:304` `resolveOneViewColumns` | projection (or all live columns) − `VIEW_HIDDEN_COLUMNS` ∩ `read field_mapping` |
| One-view row read | `portal-sql.service.ts:391` `queryCuratedViewRecords(viewId, org, user, opts)` | `SELECT <readable cols> FROM er__… WHERE org AND deleted IS NULL AND (filter) AND (search)`. Returns `null` when the view is unreadable. The closest existing primitive |
| Session read | `portal-sql.service.ts:559` `buildViewsForSession`, `:741` `runSqlQuery` | One `CREATE TEMP VIEW "<view.key>"` per granted view, a read-only txn, then the SQL |
| Filter compiler | `apps/api/src/utils/filter-sql.util.ts:107` `buildFilterSqlForEntity`, `:133` `renderFilterGroupToSql`, `:153` `formatLiteral` | Column refs only from the statement cache; schema-validated; injection-safe; callable standalone (pattern at `portal-sql.service.ts:447-462`) |
| Group scoping | `apps/api/src/utils/entity-group-scope.util.ts` `scopeEntityGroupsToEntities` | #648 all-or-nothing entity scoping; used by `portal.service.ts:1265` and `station-context.tool.ts:360`. #651 (branch `fix/651-entity-group-link-column-scope`) extends it to require a readable link column |
| Memo | `apps/api/src/utils/request-context.util.ts:25` `memoizeForRequest` | Used only by `resolveViewsForSession` (`portal-sql.service.ts:553`). `resolveGrantedViewColumns` and `PermissionService.loadSet` are **not** memoized |

### Bypass audit (the other raw readers)

`sql_query`, `display_entity_records`, `visualize_*` and the handle-consuming analytics tools are **scoped**: handles re-run through `runSqlQuery` with the persisted user (`portal-sql-handle.service.ts:102-143`). Map tiles and dissolve are **scoped** (#643). `bulk_geocode_records` reads raw rows but is admin-only (`mode: "bulk"`, `builtin-toolpacks.ts:1806`) and returns progress, not rows. `entity-record.router.ts` (`:368`, `:386`, `:580`) is RBAC-scoped through `visibilityPredicate("entity_record")`, which is the raw-entity surface by design. `entity-group-member.router.ts` `/overlap` (`:742`, `:771`) and `field-mapping.router.ts` (`:1179`, `:1183`) do hydrated reads and were **not verified** in this survey (see Open questions).

## The design space

### Decision 1 — Where the scoped read lives

- **A. Through the SQL session.** Run `SELECT * FROM "<viewKey>" WHERE "<c_link>" = '<v>'` via `runSqlQuery`. This is identical to `sql_query` semantics and reuses the memo and the read-only txn. But one call builds temp views for *every* granted view on the station, and it takes one SQL statement per member-view, which means one txn each.
- **B. A new `PortalSqlService.queryViewRowsByColumn(view, columns, column, value, limit)`**, generalised from `queryCuratedViewRecords`. One parameterised `SELECT` per member-view: readable columns, org + soft-delete guard, the view's filter, and `c_link = $value`. It takes the already-resolved `{ view, columns }`, so it doesn't re-resolve.
- **C. Keep `fetchProjectedRows`, but pass readable columns plus a hand-rendered filter** from `AnalyticsService`. That re-implements scoping outside `PortalSqlService`, which is exactly the drift that produced this bug.

| | A (session) | B (view-row helper) | C (patch in place) |
|---|---|---|---|
| Same scoping as `sql_query` | exact | same inputs (resolved view + columns + filter compiler) | hand-assembled |
| Cost per call | temp views × all granted views, per member-view txn | 1 resolution + 1 SELECT per member-view | 1 SELECT per member |
| Lives with the other scoped readers | yes | yes | no |
| Reusable by the REST twin | awkward (session-shaped) | yes | yes |

**Lean: B.** It uses the same resolved inputs and filter compiler as every scoped reader, keeps all scoping in `portal-sql.service.ts`, costs one query per member-view, and the REST twin can call the same helper.

### Decision 2 — An entity with more than one granted view

- **A. One match per (member, granted view),** keyed by `viewKey`. Each view applies its own filter and columns exactly.
- **B. Union the views per entity** into one row set. That means merging different column sets and deduping by `_record_id`, which yields rows that are a column mix no single view grants.
- **C. Pick one view** (the first, or the widest). Arbitrary, and it silently hides rows another view grants.

**Lean: A.** It is exact per view and never builds a row from two views' permissions. It also makes each match name a relation the agent can `sql_query` next, fixing the entityKey-vs-viewKey mismatch the survey found.

### Decision 3 — A view where the link column isn't readable

Filtering on a column the caller can't read is an **oracle**: "this link value has a match in view V" reveals the hidden value even when the column is omitted from the output.

- **A. Skip that view** for this member.
- **B. Filter anyway and omit the column** from the output.

**Lean: A**, fail closed. This is the same rule #651 applies to the group metadata.

### Decision 4 — Which groups resolve

- **A. The same scoped groups the agent is shown:** #648 entity scoping plus #651's link-column rule, resolved from `resolveGrantedViewColumns` at call time. A group hidden from `station_context` answers "group not found".
- **B. Any group, returning matches only for readable members.** The tool then reveals groups the agent was never shown.

**Lean: A.** There's one definition of a visible group. Registration also switches to the scoped count, so the tool doesn't appear for a caller with no resolvable group; the prompt already counts scoped groups (`system.prompt.ts:634-638`).

### Decision 5 — The REST twin

- **A. Fix it in this PR** with the same helper: resolve granted views for the caller and route members through Decision 1's helper.
- **B. File it separately.**

**Lean: A.** It's the same semantic and the same helper, and shipping only half of "resolve respects views" leaves a known bypass on `main`.

One complication: the route has no station. Views are station-attached, so resolution must use the caller's **readable views over the member entities, org-wide** (`read curated_view`, not station attachments). That needs a station-less variant of `resolveGrantedViewColumns`. See Open questions.

### Decision 6 — Keeping it from recurring

- **A. A guard test.** Every tool whose capability declares `reads: ["entity_records"]` must be in an explicit list of view-scoped implementations built with `userId`. A new raw reader then fails CI until someone decides.
- **B. Rely on review.**

**Lean: A.** It mirrors the existing guards (`tools.service.test.ts:810` cost-gate wrap, `:873` write descriptors). Review is what missed this.

## Tradeoff comparison

|  | D1 B helper | D2 A per-view | D3 A skip | D4 A scoped groups | D5 A fix REST | D6 A guard |
|---|---|---|---|---|---|---|
| Closes the repro | yes | — | yes (oracle) | yes | REST path | prevents recurrence |
| Tool result contract change | no | **yes** (`viewKey`) | no | "group not found" for hidden groups | REST payload narrows for scoped callers | no |
| Spread to spec | yes | yes | yes | yes | yes | yes |

## Recommendation

1. Add `PortalSqlService.queryViewRowsByColumn({ view, columns }, organizationId, linkNormalizedKey, value, limit)`, generalised from `queryCuratedViewRecords`: readable columns only, org + soft-delete guard, the view's filter via `renderFilterGroupToSql`/`buildFilterSqlForEntity`, and `c_<link> = $value`, parameterised.
2. `ResolveIdentityTool.build(stationId, organizationId, userId)`. `AnalyticsService.resolveIdentity` resolves `resolveGrantedViewColumns` for the caller, scopes groups with the (#651-extended) `scopeEntityGroupsToEntities`, and for each member × granted view over its entity whose readable columns include the link column, calls the helper.
3. The result becomes `matches: [{ viewKey, entityKey, isPrimary, records, truncated }]`, one per member-view. Records carry only readable columns, and each match is capped (default 100) with `truncated`.
4. Registration: `resolve_identity` registers only when the caller's scoped groups are non-empty.
5. The REST `GET /entity-groups/:id/resolve` routes through the same helper for every caller, resolving the caller's readable views over the member entities org-wide. Admins see the same data as today, via `*`.
6. Update the tool's `description`, its `builtin-toolpacks.ts` mirror and the `system.prompt.ts` guidance for `viewKey` and the per-view matches, and pin them in `builtin-toolpacks.test.ts` / `system.prompt.test.ts`.
7. Add the read-scoping guard test (D6). Convert the repro into the failing integration test.

## Open questions

1. **Fold #651 into this PR?** **Decided: yes.** #651's link-column rule is exactly what D3/D4 require of `scopeEntityGroupsToEntities`. Its condensed doc (`docs/ENTITY_GROUP_LINK_COLUMN_SCOPE.condensed.md`) is now on this branch, and its util change is slice 1 here. This PR closes both **#658** and **#651**, so display (`station_context`/roster) and resolution share one scoping function.
2. **Station-less view resolution for the REST twin.** `resolveGrantedViewColumns` is station-attachment based, but the record-detail page has no station. **Lean:** add `resolveReadableViewColumnsForEntities(org, user, entityIds)`, meaning `read curated_view` over views on those entities, then the same `resolveOneViewColumns`. It shares the per-view column logic, so it can't drift.
3. **Per-match row cap.** Today's path is unbounded. A link value like a shared email can match thousands of rows. **Lean: 100 per match** with `truncated: true`, matching the scalar-result intent of the tool. Wider pulls belong in `sql_query`.
4. **The unverified hydrated readers** (`entity-group-member.router.ts` `/overlap`, `field-mapping.router.ts:1179`). **Lean:** check them in the spec phase. If either returns member-visible row values past views, file separately rather than widening this PR further.
5. **Memoize `resolveGrantedViewColumns` per request?** One tool call resolves once, but `station_context` + `resolve_identity` in the same turn resolve twice. **Lean: not in this PR.** It's a perf follow-up (#647 precedent); correctness first.

## Enterprise-scale considerations

- **Concurrency & correctness.** N/A for races: this is a read path with no check-then-act. **Lean:** resolution and read happen in the same call, so a grant revoked between turns takes effect on the next call. There's no cached authorization.
- **Accuracy & auditability.** **Lean:** no new audit surface. Reads aren't audited today (#575 audits mutations), and adding read-audit is out of scope.
- **Failure modes.** **Lean: fail closed everywhere.** A resolution error or an unreadable link column yields no match, never a raw read. The current path fails *open* in effect, since errors become empty records while the success path returns unscoped rows.
- **Scale & unbounded growth.** **Lean:** a per-match `LIMIT` (OQ3) plus bounded fan-out: groups × members × granted views, all small, station-attached counts. One `SELECT` per member-view, on the same indexes `queryCuratedViewRecords` uses.
- **Multi-tenancy.** Already org-scoped (`organization_id` guard). **Lean:** keep the guard in the helper. This fix is intra-org least privilege, the epic's point.
- **Contract stability.** **Lean:** `viewKey` + `truncated` are additive, and `entityKey` stays. The capability split (capability ≠ access) holds: the tool stays available per tier, and views decide access per caller, so future RBAC/SSO callers need no replumbing.
- **Data lifecycle.** N/A: no retention or window semantics; soft-deleted rows stay excluded by the existing guard.

## What this doesn't decide

- Read-audit logging of agent data access. It's a separate compliance feature, and #575 covers mutations.
- Memoizing `resolveGrantedViewColumns` across tools in a turn (OQ5). Perf, not correctness.
- Fixing any other hydrated reader beyond the REST twin (OQ4). Each gets its own ticket if confirmed.
- A generic "view-scoped read" hook in `wrapWithPermissionGate`. The guard test (D6) is the proportionate recurrence control; a gate-level abstraction would be a new pattern with one consumer.

## Next step

Write `docs/RESOLVE_IDENTITY_VIEW_SCOPING.spec.md` (contract: the helper signature, the tool result shape and copy, the REST payload, the guard) and `.plan.md`. Rough slicing:

1. The #651 util extension (per its condensed doc).
2. `queryViewRowsByColumn` plus its unit and integration tests.
3. The tool rewire, with the repro turned into a failing test and the result shape and copy updated.
4. The REST twin, with the station-less resolution.
5. The guard test.

Each slice is test-first and green on its own.
