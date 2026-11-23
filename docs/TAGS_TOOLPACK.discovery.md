# Tags toolpack — Discovery

**Issue:** [EnterpriseBT/portal-ai#1071](https://github.com/EnterpriseBT/portal-ai/issues/1071)

**Why this exists.** Tags can be managed and applied only in the UI: the Tags page, and since #1070 the Tags section on station, pin, connector, view and entity pages. The portal agent has no tag tools, so "tag these entities as Finance" or "create a Q4 tag and put it on the revenue views" can't be done in a session. Tagging is org-level metadata over five object types, most of them not entities. That is the same shape as `view_management` (#645), not a fit for Entity Management.

This is the built-in **Tags** pack (`tag_management`): catalog tools and assignment tools that act on the prompting user's authority, with exactly the UI's permissions. It is provisioned on Administrate and attachable anywhere.

## The current shape

### Pack registry (core)

| Piece | Location | Note |
|---|---|---|
| Slug enum | `packages/core/src/registries/builtin-toolpacks.ts:32-48` | Adding a slug forces entries in every `Record<BuiltinToolpackSlug, …>` |
| Pack precedents | `RBAC_MANAGEMENT_PACK` `:1281`, `VIEW_MANAGEMENT_PACK` `:1561` | `{slug, name, description, iconSlug, tools[]}`; tools are hand-authored JSON-schema mirrors |
| Capabilities | `CAPABILITIES` `:2058`; `rbacRead()` `:1980`, `rbacWrite()` `:2002` | Control-plane tools: `writes: []`, `costHint: "free"`, `resultKind: "scalar"`, `locks: []`. A missing entry makes `attachCapabilities` throw (`:2421-2437`) |
| `TOOL_AUTHORIZATION` | `:2272-2410` | Data-plane writes only. RBAC and view tools are absent: their services self-gate, and the gate turns a thrown 403 into `TOOL_PERMISSION_DENIED` (comment `:2259-2271`) |
| Descriptor schema | `packages/core/src/models/tool-capability.model.ts:365-468` | One fixed `resourceType` per tool, so nothing can read the type from an argument |
| Station-data flag | `station-data-packs.ts:18-33` | rbac/view/member/help are `false` |
| Tiers | `tier-catalog.ts` standard `:131-141`, plus `:171-184` | pro `:215` and enterprise `:244` take every slug automatically |
| Always entitled | `tool-capabilities.ts:68-72` | `help`, `member_management`; every tool in them must be free (guard) |
| Phase labels | `tool-phase-labels.ts:118-131` | Key set pinned to `ALL_TOOL_CAPABILITIES` |

### Tools and gates (api)

| Piece | Location | Note |
|---|---|---|
| Tool pattern | `apps/api/src/tools/curated-views/curated-view-create.tool.ts:19-79` | `Tool` subclass, strict Zod schema, `build(ctx, portalId)` |
| Error mapping | `curated-view-tool.util.ts:40-98` (`runViewTool`), `tools/rbac/rbac-tool.util.ts:45` (`runRbac`) | 403 rethrown (the gate types it), 404 → `TOOL_TARGET_NOT_FOUND`, other 4xx keep their code, 5xx → a generic code |
| Wiring | `ToolService.buildAnalyticsTools`, `apps/api/src/services/tools.service.ts:502`; view block `:949-985` | `if (enabledPacks.has(slug)) tools.x = new X().build(ctx, portalId)` |
| Gate order | cost `:1073` → lock `:1113` → permission `:1125` → input-char / handle / output cap `:1135-1155` | Cost wraps innermost, so a refusal is never charged |
| Permission gate | `apps/api/src/services/permission-gate.service.ts:118-359` | A row that's absent or unreadable → `TOOL_TARGET_NOT_FOUND` (`:287-303`); a failed verb → `TOOL_PERMISSION_DENIED` (`:308-321`); a thrown 403 → denied (`:349-355`) |
| Guards | `tools.service.test.ts` cost-wrap `:1095`, input-char `:1182`, write descriptors `:1392`, registry `:1843`; `builtin-toolpack-schema-parity.test.ts:181`; `builtin-toolpacks.test.ts:44-54`; `system-principal.guard.test.ts:80-88` | A new tool lands in all of them |

### Tags after #1070

| Piece | Location | Note |
|---|---|---|
| Assignment service | `apps/api/src/services/tag-assignment.service.ts`; `TARGETS` `:50-88`; `loadTarget` `:96` | An unreadable target is a 404 and a read-only one is a 403. Each target type's name is also its permission resource type |
| Assign | `assign(ctx, target, entityTagId)` `:138` | Returns `{assignment, created}`; `created: false` is "already there" ("a tool reports a no-op"). An unreadable tag → 404 `ENTITY_TAG_NOT_FOUND` (`:148`) |
| Unassign | `unassign(ctx, target, assignmentId)` `:198` | Keyed by assignment id; `entityTagAssignments.findByTarget` (`entity-tag-assignments.repository.ts:87`) maps a tag to it |
| Router | `createTagAssignmentRouter`, `apps/api/src/routes/tag-assignment.router.ts:33` | Turns `!created` into 409 `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` (`:95-100`) |
| Locks | `route-authorization.map.ts` `:51`, `:638`, `:926-985` | Every tag route declares `locks: { none: … }` |
| Tag CRUD | `apps/api/src/routes/entity-tag.router.ts`: list `:95`, create `:375`, update `:538`, delete `:675` | **Logic lives in the handlers**: class write `:396`, duplicate name 409 `:404-415`, `ObjectAccessService.loadForVerb` `:557` / `:684`, delete sweeps assignments in one transaction `:700-715` |

### Provisioning and provenance

| Piece | Location | Note |
|---|---|---|
| Provisioned stations | `apps/api/src/constants/provisioned-stations.constants.ts:27-50` | Administrate: `["rbac_management", "member_management", "help"]` |
| Provisioning loop | `apps/api/src/services/application.service.ts:973-1008` | `stationToolpacks.replaceForStation` (`:988`) as the system principal |
| Storage | `station-toolpacks.table.ts:36-38` | Partial unique `(station_id, builtin_slug) WHERE deleted IS NULL` |
| Migration patterns | `drizzle/0048_drop_stations_tool_packs.sql`, `0110_backfill-nav-permission-grants.sql`, `0133_repair-system-principal.sql` | No prior backfill attached a pack to Administrate (help and member_management never were). `created_by` must be `portalai_system_id()`. Latest is `0138` |
| View provenance | `drizzle/0131_add-curated-view-source-portal-id.sql`, `curated-views.table.ts:52-53`, `curated-view.model.ts:41`, `provenance.model.ts:10-22` | `SourcePortalIdSchema` + `isSessionGenerated` |
| Chip | `apps/web/src/components/SessionGeneratedChip.component.tsx:15-20`, used at `CuratedViews.view.tsx:154-156` | The Tags page renders `TagCardUI` (`Tags.view.tsx:140`); the chip goes in `TagCard.component.tsx:64-77` |
| Tags table/model | `entity-tags.table.ts:9-17`, `entity-tag.model.ts:4-8`, `type-checks.ts:26,66` | No source column yet |
| Session refresh | `PortalSession.component.tsx:421-424`, `utils/station-attachment-tools.util.ts:12`; `utils/tag-invalidation.util.ts:15` | A turn that ran a station-attachment tool invalidates `stations.root` at turn end (#1036). `tagAssignmentKeys(type)` already names what an assignment makes stale |

### Agent copy

`system.prompt.ts` holds `PACK_ELSEWHERE` (`:261-277`) and `PACK_PROMPT_SECTIONS` (`:279-…`). view_management's "Curated Views Notes" (`:764-869`) is the closest model: it says the tools act on the user's authority, what the two refusals mean, and "look things up before you act". The prompt test iterates every slug (`system.prompt.test.ts:2`). The glossary "Tag" entry is `glossary.util.ts:223-232`, and the FAQ "What are tool packs?" (`faq.util.ts:283-288`) lists every pack.

## The design space

### Decision 1 — Assignment tool shape

- **A. Per-type tools.** `tag_assign_station`, `tag_assign_view`, … (10 tools). Each can carry a real `TOOL_AUTHORIZATION` descriptor, but the agent must split one mixed request across tools.
- **B. One tool, one type per call.** `{targetType, targetIds[], tagIds[]}`. Compact, but "tag these entities and those views" takes two calls.
- **C. One tool, typed targets.** `{tagIds[], targets: [{type, id}]}`. A mixed request is one call, and it maps 1:1 onto `TagAssignmentService.assign(ctx, target, tagId)`.

| | A | B | C |
|---|---|---|---|
| Tool count | 10 | 2 | 2 |
| Mixed-type request | several calls | several calls | one call |
| Fits a gate descriptor | yes | no | no |
| Matches the service | per type | yes | exactly |

**Lean: C.** The descriptor can't express a polymorphic target, but the service already decides 404 vs 403 per target exactly as the routes do. So self-gating, as the view and RBAC tools do, loses nothing.

### Decision 2 — How a tool names a tag

- **A. By id only.** The agent resolves names with `tag_list` first, which is what the prompt guidance asks for.
- **B. Id or name.** Saves a call, but adds name resolution against case and whitespace, and makes "name matches no tag you can read" a second not-found path.

**Lean: A.** Ids are deterministic, and `tag_list` takes a `search` argument. Creating a tag is a separate, explicit act (`tag_create`), never a side effect of naming an unknown tag.

### Decision 3 — Bulk failure semantics

- **A. All-or-nothing pre-flight.** Load and check every target and tag first, refuse the whole call on the first failure (typed, naming the item), then apply. This matches the batch gate's behaviour.
- **B. Per-item results.** Apply what can be applied and report each item's outcome.

| | A | B |
|---|---|---|
| A refusal is a single typed result the gate understands | yes | no (mixed) |
| User intent preserved ("all of these") | yes | partial |
| Race after pre-flight | the item fails as itself | same |

**Lean: A.** A refusal must be a typed result (`TOOL_PERMISSION_DENIED` / `TOOL_TARGET_NOT_FOUND`), and a half-applied bulk tag is the harder state to explain. The result lists each pair as `assigned` or `already_assigned` (or `removed` / `not_assigned`), so a no-op is visible and is never an error.

### Decision 4 — Where tag CRUD logic lives

- **A. Extract an `EntityTagService`** from `entity-tag.router.ts`. The router and the tools both call it, so permission checks, the duplicate-name 409 and the delete sweep exist once.
- **B. The tools re-implement it.** Two copies of the permission rules drift, which is the failure #1070's agreement tests exist to prevent.

**Lean: A.** "Permissions match the UI exactly" holds by construction only when both paths run one function.

### Decision 5 — Authorization and locks for the tools

The PRD asks for `TOOL_AUTHORIZATION` entries "(permission plus `lock`)". The survey shows those entries are for data-plane writes, and every tag route declares `locks: { none }`.

- **A. `rbacRead()` / `rbacWrite()` capabilities, no descriptor.** The services self-gate, the gate types a thrown 403, `runViewTool`-style mapping types a 404, and the lock rule is "none", the same as every tag route.
- **B. Invent a polymorphic descriptor.** This is a new gate feature with one caller.

**Lean: A.** Same rule as the UI, no new gate surface. The PRD deliverable should be amended to say this, because no `TOOL_AUTHORIZATION` entry is the correct shape here.

## Tradeoff comparison

| | D1 typed targets | D2 ids only | D3 pre-flight | D4 EntityTagService | D5 self-gate |
|---|---|---|---|---|---|
| New pattern | No (view tools self-gate) | No | No (batch gate) | No | No |
| Contract change | Tool inputs only | — | — | Internal refactor | PRD wording |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. Add built-in pack `tag_management` ("Tags") with six tools: `tag_list`, `tag_create`, `tag_update`, `tag_delete`, `tag_assign`, `tag_unassign`, each a `Tool` class with a hand-authored mirror.
2. `tag_list {search?, target?: {type, id}, limit?}` returns readable tags (id, name, color, description). With `target`, it returns that object's tags, subject to the same read rule on the object.
3. `tag_assign` / `tag_unassign` take `{tagIds: string[], targets: [{type, id}]}` over the five `TagTargetType`s, capped at 50 targets × 10 tags.
4. The assignment tools pre-flight every target (via `TagAssignmentService.loadTarget`) and every tag, and refuse the whole call on the first failure with a typed result naming it. They then apply, reporting `assigned` / `already_assigned` / `removed` / `not_assigned` per pair. `tag_unassign` maps a tag to its assignment through `findByTarget`.
5. Extract `EntityTagService` (list, create, update, delete) from `entity-tag.router.ts`. The router and tools both call it, with no behaviour change, and the existing route tests prove that.
6. Capabilities are `rbacRead()` for `tag_list` and `rbacWrite()` for the rest. No `TOOL_AUTHORIZATION` entry, since the lock rule is `none`, matching the routes. All tools are `costHint: free` and go through the cost, input-character and permission wraps.
7. `PACK_USES_STATION_DATA: false`; the pack joins `ALWAYS_ENTITLED_PACKS` and the standard/plus tier lists; phase labels for each tool.
8. Administrate's `builtinSlugs` gains `tag_management`. Migration `0139` inserts it for existing Administrate stations with `ON CONFLICT DO NOTHING` (see OQ1) and `created_by = portalai_system_id()`.
9. Add `source_portal_id` to `entity_tags`, `sourcePortalId` on the model and type-checks, written by `tag_create` (which joins `SESSION_CREATING_TOOLS`). `TagCardUI` shows `SessionGeneratedChipUI` when `isSessionGenerated(tag)`.
10. A turn that ran a tag tool invalidates the tag catalog, every tag-assignment list and the five taggable lists at turn end, alongside `changedStationAttachments`.
11. Add a "Tags Notes" prompt section (look up with `tag_list` before assigning; create only on an explicit request; what the two refusals mean), a `PACK_ELSEWHERE` phrase, and glossary/FAQ copy naming the Tags pack.

## Open questions

1. **How does the backfill find Administrate?** Nothing marks a provisioned station, and a user can rename one. Options: name `'Administrate'` + system creator, or a system-created station that carries both `rbac_management` and `member_management`. Lean: the pack signature. It survives a rename, and only Administrate is provisioned with both.
2. **Should `tag_delete` report how many objects lose the tag?** The UI's delete dialog shows usage before deleting. Lean: yes, return the per-type counts it removed, so the agent can tell the user what changed.
3. **Should `tag_list` return usage counts?** Lean: no. `include=usage` costs a grouped count per type, and the agent needs ids to act. "How is Finance used" can come later with filtering tools (out of scope).
4. **The PRD's `TOOL_AUTHORIZATION` deliverable.** Lean: amend it to "self-gated control-plane tools with no descriptor; lock rule `none`, matching the routes", per Decision 5.

## Enterprise-scale considerations

- **Concurrency & correctness.** `assign` already runs `insertIfAbsent` under `lockLiveTarget`, so two sessions or a session and a tab converge on one row. Lean: reuse it, and turn `created: false` into `already_assigned`.
- **Accuracy & auditability.** Tag writes from the UI are audited where the routes audit. Lean: the extracted service carries the same audit calls, so a session's writes are audited identically, with `sourcePortalId` as provenance on created tags.
- **Failure modes.** Refusals are typed results, never throws, and infra errors map to a generic failed code as `runViewTool` does. Lean: fail-closed on authorization; nothing here is metered, so the cost-gate fail-open doesn't apply.
- **Scale & unbounded growth.** Bulk caps (50 × 10) bound one call to 500 pairs; `tag_list` pages with `limit` (max 100). Lean: caps in the Zod schema so the mirror shows them.
- **Multi-tenancy.** Every load is org-scoped through `TagAssignmentService` / `ObjectAccessService`, so a foreign id is not found. Lean: reuse; no new query path.
- **Contract stability.** Typed `targets` take a new taggable type by widening `TagTargetType` alone. Lean: the tool schema derives its enum from `TAG_TARGET_TYPES`.
- **Data lifecycle.** N/A because tags already soft-delete with their assignments, and nothing here adds retained state beyond one nullable column.

## What this doesn't decide

- **Favorites.** It's user-anchored, and is designed separately.
- **Tag-based filtering tools** ("list stations tagged X"). The existing list tools may grow a `tagIds` filter separately.
- **A confirmation gate on `tag_delete`.** The existing agent delete tools have none, and this follows them.
- **Provenance on assignments.** An assignment is a link and keeps `createdBy` only (decided at the PRD gate).

## Next step

`docs/TAGS_TOOLPACK.spec.md` fixes the six tool schemas, result shapes, error codes and the migration. `docs/TAGS_TOOLPACK.plan.md` slices it roughly as:

1. `EntityTagService` extraction (routes unchanged).
2. `source_portal_id` column, model and chip.
3. Pack registry, capabilities, tiers and labels.
4. Catalog tools.
5. Assignment tools.
6. Provisioning and the backfill.
7. Turn-end invalidation.
8. Prompt and help copy.
