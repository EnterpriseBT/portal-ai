# Attach curated views from a portal session — Discovery

**Issue:** [EnterpriseBT/portal-ai#1036](https://github.com/EnterpriseBT/portal-ai/issues/1036)

**Why this exists.** An admin in a portal session can already create entities and records (`entity_management`) and build curated views over them (`view_management`). What they can't do is attach a view to a station. `curated_view_create` says outright that it "does not attach the view to any station". And `sql_query` reads only the views attached to the session's own station (`portal-sql.service.ts:616`).

So "create an entity, build a view, query it" means leaving the portal, attaching the view in the station editor, and opening a new portal. That round trip repeats for every new entity. Attaching a view to another station that's already shared with members needs the same detour.

#848's Playground station (Sandbox + `data_query` + `entity_management` + `view_management`) is designed around doing that whole loop in one session, and it depends on this ticket. This ticket adds `curated_view_attach`, `curated_view_detach` and `station_list` to `view_management`, under the same permission checks as the UI and with no exceptions.

## The current shape

### Attaching today: the routes

| Piece | Where | Behaviour |
|---|---|---|
| `loadWritableStation` | `curated-view.router.ts:295-314` | Missing, cross-org or unreadable station → 404 `STATION_NOT_FOUND`; then `resource.write` → 403. Returns the `PermissionSet` |
| Attach `POST /api/curated-views/:id/attach` | `:532-574` | `loadWritableStation` → `StationAttachmentService.assertAttachable` (any unreadable or missing view → 403 `STATION_ATTACHMENT_NOT_READABLE`, one shared message, `station-attachment.service.ts:91-118`) → `stationViews.insertManyIgnoreConflicts` (no transaction; re-attaching is a no-op) → audit only the rows inserted |
| Detach `DELETE …/:id/attach/:stationId` | `:596-620` | `loadWritableStation` → `softDeleteByStationAndViews` → audit if anything was removed. **Does not check that the view is readable** (documented at `:585-587`) |
| `applyChanges` / `applyAll` | `station-attachment.service.ts:138-246`, `:252` | The station editor's add/remove-by-difference, in a transaction. Unlike the detach route, it skips removing views the caller can't read |
| `auditViewAttachment` | `curated-view.router.ts:317-333` | **Private to the router.** Records `station.attachments.change` (`targetType: "station"`, `{added, removed}`) after the write; fail-open through `AuditService.record` (`audit.service.ts:45-65`) |

None of these paths takes a lock. The unique `(station_id, curated_view_id)` index with `ON CONFLICT DO NOTHING` is what makes them safe to run concurrently.

### The view_management tools

- **Shape.** Every tool extends `Tool` (`apps/api/src/types/tools.ts:3-18`), and its `build()` returns an AI SDK `tool()`.
- **Construction.** The tools are built at `tools.service.ts:892-921`. The pack comment ends "No tool attaches a view to a station."
- **Caller context.** The only context is a `PermissionContext` (`permission.service.ts:26-30`, built at `tools.service.ts:561`), and `curated_view_create` also gets `portalId`. **No view tool knows the session's station today**, but `buildAnalyticsTools(organizationId, stationId, userId, portalId)` (`:481`) has it in scope.
- **Errors.** `runViewTool` (`curated-view-tool.util.ts`) maps failures to typed results:

  | Failure | Result |
  |---|---|
  | Permission 403 | Re-thrown; the permission gate turns it into `TOOL_PERMISSION_DENIED` |
  | 404 | `TOOL_TARGET_NOT_FOUND` |
  | Other 4xx | Keeps its own code |
  | 5xx | The tool's own `*_FAILED` code |

  `STATION_ATTACHMENT_NOT_READABLE` is a 403, so an unreadable view would currently come back as a permission refusal.
- **Audit.** Agent writes are audited through `agentAudit(portalId)` (`rbac/rbac-tool.util.ts:19-31`). The router's `auditContextFromRequest` can't be used from a tool.
- **Wrappers.** Control-plane tools use `rbacRead()` / `rbacWrite()` (`builtin-toolpacks.ts:1784-1815`) with `writes: []`, so they aren't `TOOL_AUTHORIZATION` targets. They're wrapped with the cost gate innermost, then the lock, permission, input-character and output-cap gates (`tools.service.ts:1010-1081`).

### Listing stations

`GET /api/stations` (`station.router.ts:191-283`) is written inline in the router:
- it filters to the org plus `set.visibilityPredicate("station", …)` (`:218`);
- it searches by name, sorts, and pages by `limit`/`offset`;
- it fills in each station's toolpacks with one batched query, and its `capabilities` through `ObjectCapabilitiesService.attach` (`:263`).

Its `include` parameter is parsed but ignored: attached views come only from `GET /:id`, through `StationAttachmentService.listForStation` (one station at a time). There is no `StationService`.

### The view set, and how fresh each consumer is during a portal turn

A portal turn is one SSE request (`portal-events.router.ts:~198-208`) that runs up to 10 tool steps. The request context is an `AsyncLocalStorage` mounted globally (`request-context.util.ts:38`, `app.ts:61`), so tool calls run inside it.

| Consumer | Freshness within a turn |
|---|---|
| `sql_query` / `resolveViewsForSession` | Memoized per request under `views:${stationId}:${userId}:${organizationId}` (`portal-sql.service.ts:1225-1228`), the only `memoizeForRequest` user. **A view attached mid-turn is invisible until the next turn** |
| `station_context` | `resolveGrantedViewColumns` runs fresh on every call (`station-context.tool.ts:244`), so it's live |
| System-prompt roster | Built once before the stream, so it updates next turn |
| `resolve_identity` | Registered at tool-build time only when an entity group is visible (`tools.service.ts:631-656`), so it can appear next turn |

`memoizeForRequest` (`request-context.util.ts:68-85`) has **no invalidate API**. Its docstring says it's "only for values that cannot change within one request".

### Web freshness

No server-side event announces an attachment change. When a stream finishes, `handleStreamDone` (`PortalSession.component.tsx:343-353`) refreshes only usage and the portal. The portal header (`usePortalStation`, `portal-station.util.ts:27-40`) and `StationDetail.view.tsx:56` read the station through a query with a 60s `staleTime` (`client.ts:78`), so they'd show a stale view list after the agent attaches one.

### Copy that says attaching isn't possible from a session

- `builtin-toolpacks.ts`: the pack JSDoc (`:1502-1510`) and description (`:1515`), `curated_view_entity_list` (`:1567`) and `curated_view_create` (`:1579`), plus the matching `.tool.ts` files.
- `system.prompt.ts:638-645` and `:675-679`: "**You cannot attach a view to a station.**" This is pinned by `system.prompt.test.ts:404-409`.
- Glossary "Curated View" (`glossary.util.ts:257`) and "Station" (`:242`); FAQ `faq.util.ts:325` (and possibly `:57`, `:251`).

## The design space

### Decision 1 — Where the attach and detach logic lives

**A. The tools copy the route logic.** That duplicates the 404→403 ordering, `assertAttachable` and the audit.

**B. Move it into `StationAttachmentService`.** Add `attachViews(ctx, {stationId, curatedViewIds}, audit)` and `detachViews(…)`. Each loads the station org-scoped (404 if unreadable, then 403 without write), checks the views, writes in a transaction, and audits through a moved `auditViewAttachment` that takes plain audit context. The routes and the tools both call these.

| | A | B |
|---|---|---|
| One authorization path for UI and agent | No | Yes |
| Batch (several views at once) | Tool-only | Shared |
| Route change | None | Thin handlers, same responses |

**Lean: B.** "The agent can do exactly what the UI can" holds only if both call the same code. The route keeps its single-view request shape on top of the batch method.

### Decision 2 — Batch semantics

**A. All or nothing.** Every view must be readable, otherwise nothing is attached. All the rows go in one transaction.

**B. Partial.** Attach the readable views and report the rest.

**Lean: A.** It matches `assertAttachable` and `applyAll`, a refusal leaves no half-applied state, and the agent can retry without the view it named wrongly. Already-attached views are a no-op, and the result lists `added` vs `alreadyAttached`. The batch is capped (say 25) through the input schema.

### Decision 3 — Detach and view readability

The route detaches with station write alone. `applyChanges` instead skips views the caller can't read.

**Lean: follow the route.** Detaching changes the station, not the view (#674's "attaching is an edit to the station"). Detaching a view that isn't attached is a no-op, as the issue requires. The agent can't learn an unreadable view's id anyway, because `station_list` labels unreadable attachments without exposing them (Decision 5).

### Decision 4 — Making the view queryable in the same turn

**A. Accept next turn.** It needs no memo change, but the agent has to stop and tell the user to send another message, which breaks the ticket's acceptance criterion.

**B. Clear the memo entry.** Add `forgetForRequest(key)` to `request-context.util.ts`, and have `PortalSqlService` export a helper (`forgetSessionViews(stationId, userId, organizationId)`) so the key format has one owner. A successful attach or detach on **the session's own station** calls it. Update the docstring: request-stable unless the request itself changes the value through the owning service.

**C. Don't memoize view sets at all.** That reopens #647's repeated resolution on every `sql_query` step.

**Lean: B.** It's a narrow, owned invalidation. The tool result also returns each attached view's key and columns, because the system-prompt roster won't list the view until next turn and `station_context` is the only live alternative. `resolve_identity` appearing next turn is acceptable and gets a line in the prompt.

### Decision 5 — The shape of `station_list`

**A. A thin wrapper** that loops `GET /:id` logic per station. That makes N queries.

**B. Extract a `StationQueryService.listForCaller(set, org, {search, limit, offset, sortBy})`** from the inline route, which then calls it. Add a batched `StationAttachmentService.listForStations(set, org, stationIds)` for attached views, each marked `canRead`, with an unreadable one shown only as "a view you can't read" and no id.

**Lean: B.** It's one source for "stations this caller can see". The tool returns `{id, name, description, capabilities, isSessionStation, views: [{id?, key?, label, canRead}]}`. It takes `search` and `limit` (default 25, max 100) plus `offset`, and returns `total`, so a large org pages rather than dumps.

### Decision 6 — Refreshing the web after the agent changes attachments

**A. Do nothing.** The UI catches up on refetch or window focus, within 60s.

**B. Invalidate `queryKeys.stations.root` in `handleStreamDone`** when the turn's tool calls include `curated_view_attach` / `curated_view_detach`.

**Lean: B.** The portal header's view list is the first place the user looks after "attach it here". It's one conditional invalidation, outside any mutation callback, so the `mutation-invalidate` guard doesn't apply.

## Tradeoff comparison

| | D1 B (service) | D2 A (all-or-nothing) | D3 (route rule) | D4 B (forget memo) | D5 B (extract list) | D6 B (invalidate) |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| Packages | api | api | api | api | api | web |
| Route behaviour change | None (same responses) | n/a | None | n/a | None | n/a |

## Recommendation

1. `StationAttachmentService` gains `attachViews` and `detachViews`. They own the org-scoped station load (404 when unreadable, 403 without `resource.write`), view readability on attach, a transactional write and the `station.attachments.change` audit. The attach and detach routes call them, and their responses are unchanged.
2. `curated_view_attach({curatedViewIds: string[] (1–25), stationId?})` attaches all or nothing. `stationId` defaults to the session's station, which `buildAnalyticsTools` passes to `build()` along with `portalId` for `agentAudit`. It returns `{stationId, added, alreadyAttached, views: [{id, key, label, columns}], queryableNow}`.
3. `curated_view_detach({curatedViewIds, stationId?})` needs station write only, and treats a view that isn't attached as a no-op.
4. `station_list({search?, limit?, offset?})` comes from an extracted `StationQueryService.listForCaller`, which the list route then also calls. Attached views come from a batched `listForStations`, and unreadable ones are labelled without ids.
5. `forgetForRequest(key)` is added, and `PortalSqlService.forgetSessionViews` owns the key. Attach and detach on the session's own station call it, so `sql_query` sees the change in the same turn.
6. All three tools are control-plane (`rbacWrite()` / `rbacRead()`, `costHint: "free"`, no `TOOL_AUTHORIZATION` entry) and are registered in:
   - `BUILTIN_TOOL_NAMES`;
   - the pack's tool list and its mirror (schema parity);
   - `TOOL_PHASE_LABELS`;
   - `api-codes.constants.ts` (`CURATED_VIEW_ATTACH_FAILED` and its siblings).
7. Copy changes:
   - the pack description, and `curated_view_create` / `curated_view_entity_list`;
   - `system.prompt.ts`'s `view_management` section: attach after create when the user wants to query, `station_list` before targeting another station, queryable this turn but the roster updates next turn;
   - glossary "Curated View" / "Station", and FAQ `:325`.
8. The web invalidates `stations.root` when a turn ran attach or detach.
9. Tests:
   - the service methods (route and tool parity);
   - the tool unit and integration suites;
   - the guard and registry updates the survey listed;
   - a same-turn integration test: attach, then `sql_query` in one request returns rows.

## Open questions

1. **What an unreadable view reports.** The route answers 403 `STATION_ATTACHMENT_NOT_READABLE` with one message for missing and unreadable views alike. #1036's acceptance criterion says an unreadable view "reads as not found". **Lean:** in the tool, map it to `TOOL_TARGET_NOT_FOUND` and leave the route as it is, since changing a route's status is a separate contract change. The spec records the asymmetry.
2. **Is attach a "session-creating" tool?** `SESSION_CREATING_TOOLS` (`system-principal.guard.test.ts:80-88`) lists tools whose output records `sourcePortalId`. A `station_views` link has no `sourcePortalId` column and isn't one of #641's types. **Lean: no.** The audit event's `agentAudit(portalId)` is the provenance.
3. **Should `station_list` also return each station's toolpacks?** The route already loads them, and "attach to a station that can query it" depends on whether the target has `data_query`. **Lean: yes,** as slugs. It costs nothing extra and stops the agent attaching to a station that can't query.
4. **Concurrent attach and detach of the same pair across sessions.** The unique index keeps attach idempotent, and detach soft-deletes. **Lean: no lock**, the same as the routes (none take one). Last write wins, and both are audited.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: the routes' model is unchanged (`ON CONFLICT DO NOTHING`, soft-delete), and a batch now writes in one transaction. The only new state is the memo invalidation, and it's per request, so no other request is affected.
- **Accuracy & auditability.** Lean: every agent attach or detach records the same `station.attachments.change` event as the UI, attributed to the prompting user, with `portal-agent` as the user agent (`agentAudit`).
- **Failure modes.** Lean: fail-closed on authorization: an unreadable station is 404, no write is 403, and a batch with an unreadable view attaches nothing. Audit stays fail-open, as in the routes, and a failed memo invalidation can't happen because it's an in-process `Map` delete.
- **Scale & unbounded growth.** Lean: batches are capped at 25, and `station_list` pages (max 100) and loads attached views in one batched query, not one per station.
- **Multi-tenancy.** Lean: everything is org-scoped through the same service as the routes. `station_list` applies `visibilityPredicate`, and an unreadable attached view never exposes its id.
- **Contract stability.** Lean: the tool contracts mirror the routes. The service extraction gives future surfaces (attaching connectors or packs) a place to live without touching call sites.
- **Data lifecycle.** N/A because there is no retention or window. Links soft-delete exactly as the routes do.

## What this doesn't decide

- Attaching connectors or toolpacks, or creating, editing and deleting stations, from the agent. The issue's scope is views.
- Changing who may attach. Station write stays the gate, and members need it granted.
- Changing the attach route's 403 for unreadable views to a 404 (open question 1).
- Provisioning (#848), which follows this ticket.

## Next step

`docs/ATTACH_VIEWS_FROM_PORTAL.spec.md` fixes the tool schemas and results, the service signatures, the error mapping and the prompt copy. `.plan.md` slices it in this order:
1. The service extraction, with the routes on top and parity tests.
2. `forgetForRequest` and the same-turn test.
3. The attach and detach tools with their registries and guards.
4. `station_list` with the extracted list service.
5. The prompt, pack and help copy.
6. The web invalidation.
