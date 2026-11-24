# Tags toolpack — Spec

**Issue:** [EnterpriseBT/portal-ai#1071](https://github.com/EnterpriseBT/portal-ai/issues/1071) · **Discovery:** `docs/TAGS_TOOLPACK.discovery.md`

Pins the built-in **Tags** pack (`tag_management`): six agent tools over the tag catalog and over tag assignments on the five #1070 target types. Also pins the `EntityTagService` extraction they share with the routes, tag session provenance, Administrate provisioning and its backfill, the session's turn-end refresh, and the agent and help copy.

## Key decisions (flag for review)

1. **Two assignment tools over typed targets** (D1): `{tagIds, targets: [{type, id}]}`, so a mixed-type request is one call.
2. **Tags are named by id only** (D2). `tag_list` (with `search`) resolves names, and `tag_create` is the only way to create a tag.
3. **Bulk calls are all-or-nothing at pre-flight** (D3). The first unreadable or unwritable target, or unreadable tag, refuses the whole call with a typed result. Applied pairs report `assigned` / `already_assigned` (or `removed` / `not_assigned`); a no-op is never an error.
4. **One `EntityTagService`** (D4) holds list, create, update and delete. The routes become thin callers with no behaviour change.
5. **Self-gated control-plane tools** (D5): `rbacRead()` / `rbacWrite()` capabilities and **no `TOOL_AUTHORIZATION` entry**. The lock rule is `none`, the same as every tag route. The issue's "TOOL_AUTHORIZATION entries" deliverable is amended to this.
6. **Backfill finds Administrate by its pack signature** (OQ1): a live, system-created station that carries both `rbac_management` and `member_management`. That survives a rename.
7. **`tag_delete` reports what it removed** (OQ2) as readable per-type usage taken before the delete. Unreadable objects are never counted, so nothing hidden leaks through the count.
8. **`tag_list` returns no usage counts** (OQ3).
9. **Provenance on tags only** (PRD gate): `entity_tags.source_portal_id`, written by `tag_create`; assignments keep `createdBy`.
10. **Every tier, through `ALWAYS_ENTITLED_PACKS`** plus the standard/plus lists, so stored and custom tiers can't exclude it. No tier-row migration is needed, because `TierService` unions the always-entitled packs at read time.

## Scope

### In scope

1. `EntityTagService` extracted from `apps/api/src/routes/entity-tag.router.ts`.
2. `entity_tags.source_portal_id` (column, model field, type-checks), plus the chip on `TagCardUI`.
3. Pack registry: slug, pack spec with six mirrors, capabilities, `PACK_USES_STATION_DATA`, `ALWAYS_ENTITLED_PACKS`, tier lists, phase labels.
4. Six `Tool` classes in `apps/api/src/tools/tags/`, wired in `ToolService.buildAnalyticsTools`.
5. Administrate's `builtinSlugs` + a backfill migration.
6. Turn-end refresh in `PortalSession`.
7. `system.prompt.ts` section and `PACK_ELSEWHERE`; glossary, FAQ and `getting-started` copy where it names packs.

### Out of scope

Favorites; tag-filtering tools; a confirmation gate on `tag_delete`; provenance on assignments; any change to tag permissions, routes or wire contracts. Route paths, bodies, responses and OpenAPI blocks are unchanged.

## Surface

### `EntityTagService` — `apps/api/src/services/entity-tag.service.ts` (new)

The route handlers' bodies move here verbatim; the routes keep only parsing and `HttpService` responses.

```ts
export class EntityTagService {
  /** Readable tags, org + visibilityPredicate("tag"), ilike search on name/description. */
  static list(ctx: PermissionContext, opts: {
    search?: string; limit: number; offset: number;
    sortBy: "name" | "created"; sortOrder: "asc" | "desc"; includeUsage?: boolean;
  }): Promise<{ entityTags: EntityTagWithUsage[]; total: number }>;

  /** Class `resource.write` on tag (403), duplicate name 409 ENTITY_TAG_DUPLICATE_NAME. */
  static create(ctx: PermissionContext, body: EntityTagCreateRequestBody,
    opts?: { sourcePortalId?: string | null }): Promise<EntityTag>;

  /** loadForVerb(write) → 404 ENTITY_TAG_NOT_FOUND / 403; duplicate-name 409 on a rename. */
  static update(ctx: PermissionContext, id: string,
    body: EntityTagUpdateRequestBody): Promise<EntityTag>;

  /**
   * loadForVerb(delete) → 404 / 403. Readable usage is read first, then the
   * tag and all its assignments soft-delete in one transaction.
   */
  static delete(ctx: PermissionContext, id: string): Promise<{ id: string; removedFrom: TagUsage }>;
}
```

The route answers stay byte-identical: `DELETE` still answers `{ id }`, and create still answers 201 `{ entityTag }`. Error codes are unchanged (`ENTITY_TAG_*_FAILED`, `ENTITY_TAG_NOT_FOUND`, `ENTITY_TAG_DUPLICATE_NAME`).

### Tag provenance

- `apps/api/src/db/schema/entity-tags.table.ts`: `sourcePortalId: text("source_portal_id")` (nullable, no FK, as on `curated_views`).
- `packages/core/src/models/entity-tag.model.ts`: `sourcePortalId: SourcePortalIdSchema` (from `provenance.model.ts`).
- `apps/api/src/db/schema/zod.ts` / `type-checks.ts`: regenerate; both `IsAssignable` directions hold.
- `EntityTagService.create` writes `sourcePortalId ?? null`; the route passes nothing (null).
- `apps/web/src/components/TagCard.component.tsx`: renders `<SessionGeneratedChipUI />` when `isSessionGenerated(tag)`, beside the description/usage block.

### Pack registry — `packages/core/src/registries/`

- `builtin-toolpacks.ts`: `"tag_management"` is appended to `BuiltinToolpackSlugSchema`. `TAG_MANAGEMENT_PACK: BuiltinToolpackSpec` is `{ slug: "tag_management", name: "Tags", iconSlug: "LocalOffer", description: "Manage tags in a session: list, create, edit and delete tags, and add or remove them on entities, stations, pinned results, connectors and views. Changes follow the caller's own permissions on each tag and object." }`, with six mirrors whose `parameterSchema` fields and `required` match the Zod schemas below (schema-parity guard). It is listed in `BUILTIN_TOOLPACKS` after `VIEW_MANAGEMENT_PACK`. `apps/web/src/utils/tool-pack-icons.util.ts` maps `LocalOffer` to `LocalOfferOutlined`.
- `CAPABILITIES`: `tag_list: rbacRead()`; `tag_create`, `tag_update`, `tag_delete`, `tag_assign`, `tag_unassign`: `rbacWrite()`.
- **No `TOOL_AUTHORIZATION` entries.**
- `station-data-packs.ts`: `tag_management: false`.
- `tool-capabilities.ts`: `ALWAYS_ENTITLED_PACKS` gains `"tag_management"`.
- `tier-catalog.ts`: standard and plus `builtinToolpacks` gain `"tag_management"` (pro and enterprise take every slug).
- `tool-phase-labels.ts`: "Listing tags", "Creating the tag", "Updating the tag", "Deleting the tag", "Adding tags", "Removing tags".

### Tools — `apps/api/src/tools/tags/` (new)

All tools are `Tool` subclasses with strict Zod schemas and `build(ctx, portalId)`, and run through `runTagTool(failedCode, fn)` (`tag-tool.util.ts`). That has the same mapping as `runViewTool`:
- a permission 403 is rethrown, and the gate types it `TOOL_PERMISSION_DENIED`;
- a 404 becomes `TOOL_TARGET_NOT_FOUND`;
- other 4xx keep their code;
- a 5xx becomes `failedCode` with a generic message;
- a `ZodError` becomes `ENTITY_TAG_INVALID_PAYLOAD`.

```ts
const TagTargetInput = z.object({
  type: TagTargetTypeSchema,          // entity | station | pin | connector_instance | curated_view
  id: z.string().min(1),
}).strict();
```

| Tool | Input | Result | failedCode |
|---|---|---|---|
| `tag_list` | `{ search?: string, target?: TagTargetInput, limit?: int 1–100 = 25, offset?: int ≥0 = 0 }` | No target: `{ tags: {id,name,color,description,sourcePortalId}[], total }`, sorted by name. With target: `{ tags: AssignedEntityTag[] }` via `TagAssignmentService.list` | `ENTITY_TAG_FETCH_FAILED` |
| `tag_create` | `EntityTagCreateRequestBodySchema` | `{ success: true, entityTag }`; `sourcePortalId = portalId` | `ENTITY_TAG_CREATE_FAILED` |
| `tag_update` | `{ tagId }` + `EntityTagUpdateRequestBodySchema` fields (at least one) | `{ success: true, entityTag }` | `ENTITY_TAG_UPDATE_FAILED` |
| `tag_delete` | `{ tagId }` | `{ success: true, id, removedFrom: TagUsage }` | `ENTITY_TAG_DELETE_FAILED` |
| `tag_assign` | `{ tagIds: string[1–10], targets: TagTargetInput[1–50] }` (deduped) | `{ success: true, results: { type, id, tagId, status: "assigned" \| "already_assigned" }[] }` | `ENTITY_TAG_ASSIGNMENT_CREATE_FAILED` |
| `tag_unassign` | same input as `tag_assign` | `{ success: true, results: { …, status: "removed" \| "not_assigned" }[] }` | `ENTITY_TAG_ASSIGNMENT_DELETE_FAILED` |

**Assignment algorithm** (`tag_assign` / `tag_unassign`):
1. Dedupe the inputs.
2. **Pre-flight:**
   - each target goes through `TagAssignmentService.loadTarget(ctx, t, "write")`, giving a 404 (the target's own code) or a 403;
   - each tag must be `readableInOrg(set, org, "tag", tag)`, else 404 `ENTITY_TAG_NOT_FOUND`.
   
   The first failure throws, so nothing is applied.
3. **Apply** each `(target, tag)` in input order:
   - assign calls `TagAssignmentService.assign` and maps `created` to the status;
   - unassign finds the pair through `entityTagAssignments.findByTarget(target)` and calls `TagAssignmentService.unassign(ctx, target, assignmentId)` when present, else returns `not_assigned`.
4. **A race after pre-flight** (the object or tag deleted mid-call) surfaces as that call's typed error. Pairs already applied stay applied, which is the same outcome as N sequential UI clicks.

`tag_create` joins `SESSION_CREATING_TOOLS` (`apps/api/src/__tests__/system-principal.guard.test.ts:80`) and is built with `portalId`.

**Wiring** — `apps/api/src/services/tools.service.ts`, beside the view_management block (`:949-985`): `if (enabledPacks.has("tag_management"))` builds the six tools with `(permissionContext, portalId ?? null)`. They fall under the existing cost, input-character and permission wraps. The lock wrap is a no-op for them, since they have no descriptor.

### Provisioning

- `apps/api/src/constants/provisioned-stations.constants.ts`: Administrate's `builtinSlugs` becomes `["rbac_management", "member_management", "tag_management", "help"]`. Its `description` adds "manage and apply tags".
- The backfill migration is below.

### Session refresh — `apps/web`

- `apps/web/src/utils/tag-tools.util.ts` (new): `TAG_WRITE_TOOLS = ["tag_create","tag_update","tag_delete","tag_assign","tag_unassign"] as const`, and `changedTags(toolNames: ReadonlySet<string>): boolean`.
- `PortalSession.component.tsx` `handleTurnEnd` (`:421`): when `changedTags(turn.toolNames)`, invalidate each key of `tagCatalogChangeKeys()` (`utils/tag-invalidation.util.ts`). That covers the catalog, every object's tag list, and the five taggable lists.

### Agent and help copy

- `apps/api/src/prompts/system.prompt.ts`:
  - `PACK_ELSEWHERE.tag_management = "creating, editing and deleting tags and adding or removing them on objects"`.
  - `PACK_PROMPT_SECTIONS.tag_management` with `capability: "manage and apply tags"`, `markers: ["manage and apply tags", "## Tags Notes"]`, rendering:
    - the tools act on the user's authority, and the two refusals relayed plainly without a retry;
    - **resolve a tag's id with `tag_list` before assigning; never invent an id**, and create a tag only when the user asks for a new one;
    - targets name their type, and ids come from the object tools or the station context;
    - report each result's status, and what `tag_delete` removed.
- `glossary.util.ts`: the "Tag" entry notes the assistant can manage and apply tags with the Tags pack. The FAQ "What are tool packs?" lists Tags and says every plan includes Help, Members and Tags. The station/Administrate FAQ answers (`faq.util.ts:72`, `:85`, `:359`) name tags where they list Administrate's contents.

## Migration

1. `npm run db:generate -- --name add-entity-tag-source-portal-id` gives `0139`: `ALTER TABLE "entity_tags" ADD COLUMN "source_portal_id" text;`
2. `npm run db:generate -- --custom --name attach-tags-pack-to-administrate` gives `0140`, hand-written:

```sql
-- #1071: attach the Tags pack to every live org's Administrate station.
-- Administrate is the system-created station carrying both rbac_management
-- and member_management (a rename doesn't hide it). Re-running is a no-op.
INSERT INTO station_toolpacks (id, created, created_by, station_id, builtin_slug)
SELECT gen_random_uuid()::text,
       (extract(epoch FROM now()) * 1000)::bigint,
       portalai_system_id(),
       s.id,
       'tag_management'
FROM stations s
JOIN organizations o ON o.id = s.organization_id AND o.deleted IS NULL
WHERE s.deleted IS NULL
  AND s.created_by = portalai_system_id()
  AND EXISTS (SELECT 1 FROM station_toolpacks t WHERE t.station_id = s.id
              AND t.builtin_slug = 'rbac_management' AND t.deleted IS NULL)
  AND EXISTS (SELECT 1 FROM station_toolpacks t WHERE t.station_id = s.id
              AND t.builtin_slug = 'member_management' AND t.deleted IS NULL)
ON CONFLICT (station_id, builtin_slug)
  WHERE deleted IS NULL AND builtin_slug IS NOT NULL
DO NOTHING;
```

Both migrations are expand-only (no `destructive-ok`), and `created_by` uses `portalai_system_id()` (`lint:migrations`). The journal and snapshots are committed with each migration.

## Seed

No global seed change. The per-org path is `PROVISIONED_STATIONS` (provisioning), paired with migration `0140` for existing orgs. That is the #316/#581 rule, though this is a station toolpack rather than a system column, so the backfill-coverage marker doesn't apply.

## TDD test plan

Run `npm run test:unit` / `npm run test:integration` from each package, using `--testPathPattern` for touched files.

### packages/core (unit)
- `__tests__/registries/builtin-toolpacks.test.ts`: the slug list includes `tag_management`; the pack has six tools; every tool has a capability.
- `__tests__/registries/station-data-packs.test.ts`, `tier-catalog.test.ts` (every tier entitled), `tool-capabilities.test.ts` (always-entitled tools are all free), `tool-phase-labels.test.ts`.
- `__tests__/models/entity-tag.model.test.ts`: `sourcePortalId` is optional and nullable.
- `__tests__/content/glossary.util.test.ts` / `faq.util.test.ts`: copy pins. ≈ 10

### apps/api (unit)
- `__tests__/tools/builtin-toolpack-schema-parity.test.ts`: the six mirrors match (automatic).
- `__tests__/services/tools.service.test.ts`: the pack builds six tools; they are cost-wrapped and input-char-wrapped; none are built without the pack.
- `__tests__/system-principal.guard.test.ts`: `TagCreateTool` is in `SESSION_CREATING_TOOLS` and threads `portalId`.
- `__tests__/prompts/system.prompt.test.ts`: the "## Tags Notes" markers render only with the pack.
- `__tests__/tools/tags/tag-tool.util.test.ts`: 403 rethrown, 404 → `TOOL_TARGET_NOT_FOUND`, 409 kept, 500 → `failedCode`, Zod → `ENTITY_TAG_INVALID_PAYLOAD`. ≈ 14

### apps/api (integration) — `src/__tests__/__integration__/`
- `services/entity-tag.service.integration.test.ts`:
  - list visibility and search;
  - create: class-write 403, duplicate 409, `sourcePortalId` stored;
  - update: unreadable 404, read-only 403, rename duplicate 409;
  - delete: sweeps assignments, and `removedFrom` counts only readable objects.
- `tools/tags/tag-catalog-tools.integration.test.ts`: owner vs member vs read-only member for each catalog tool; a foreign-org tag is `TOOL_TARGET_NOT_FOUND`; a session-created tag carries `sourcePortalId`.
- `tools/tags/tag-assignment-tools.integration.test.ts`:
  - each of the five types assigns and unassigns;
  - a mixed-type call;
  - `already_assigned` / `not_assigned` no-ops;
  - a read-only target gives `TOOL_PERMISSION_DENIED` and applies nothing;
  - an unreadable or foreign target gives `TOOL_TARGET_NOT_FOUND` and applies nothing;
  - an unreadable tag gives `TOOL_TARGET_NOT_FOUND`;
  - caps reject 11 tags or 51 targets.
- `routes/entity-tag.router.integration.test.ts` (existing): green unchanged, proving the extraction changed no route behaviour.
- `migrations/attach-tags-pack-to-administrate.integration.test.ts`: runs `0140` against an org whose Administrate was renamed (it gets the pack), Playground (it doesn't), an org already holding the pack (no duplicate, no error), and a soft-deleted org (skipped); a second run is a no-op.
- `services/application.service.integration.test.ts` (existing provisioning case): a new org's Administrate lists `tag_management`. ≈ 40

### apps/web (unit)
- `__tests__/TagCard.test.tsx`: chip shows for a session-generated tag, not for a UI tag; axe still clean.
- `__tests__/tag-tools.util.test.ts`: `changedTags` true for each write tool, false for `tag_list` and others.
- `__tests__/PortalSession…` (existing turn-end test): a turn with `tag_assign` invalidates `tagCatalogChangeKeys()`. ≈ 6

**Totals ≈ 70 cases.**

## Acceptance criteria

- [ ] On a station with Tags, the agent lists, creates, edits and deletes tags and adds or removes them on all five object types. Each change shows on the Tags page and the object's pages without a reload once the turn ends.
- [ ] Creating needs class write on tag. Editing or deleting needs write or delete on the tag, and an unreadable tag is `TOOL_TARGET_NOT_FOUND`. Assigning or removing needs write on the target: read-only gives `TOOL_PERMISSION_DENIED`, unreadable gives `TOOL_TARGET_NOT_FOUND`. `tag_list` returns only readable tags.
- [ ] A refused bulk call applies nothing.
- [ ] A foreign-org tag or object id is `TOOL_TARGET_NOT_FOUND`.
- [ ] A repeated assign or an absent unassign reports a no-op status, never an error. Deleting a tag removes it everywhere, and the result counts only objects the caller can read.
- [ ] A session-created tag shows "Created in a portal session" on the Tags page; a UI-created one doesn't.
- [ ] New orgs' Administrate lists Tags. After `0140`, existing orgs' Administrate does too, renamed or not, and re-running `0140` changes nothing.
- [ ] Without the pack attached, no tag tool is offered.
- [ ] Every tag route answers exactly as before.

## Risks & rollback

- **The extraction changes route behaviour.** Detected by the existing route integration tests, which run unchanged. Roll back by reverting the slice.
- **The backfill misses or over-matches.** It's a pack signature, not a name. The worst case is a custom system station with both packs gaining a free, permission-checked pack, which is harmless. Rollback is a forward migration soft-deleting the `tag_management` rows `0140` created (`created_by = portalai_system_id()` and the migration's timestamp window).
- **Fail mode.** Authorization fails closed (service checks inside the call); nothing is metered, so the cost gate's fail-open never applies.
- **Prompt drift.** The agent could assign a tag by name. It can't: the schema takes ids only, and the prompt says to resolve with `tag_list` first.

## Files touched

**New:**
- `apps/api/src/services/entity-tag.service.ts`
- `apps/api/src/tools/tags/{tag-list,tag-create,tag-update,tag-delete,tag-assign,tag-unassign}.tool.ts` and `tag-tool.util.ts`
- `apps/api/drizzle/0139_add-entity-tag-source-portal-id.sql` and `0140_attach-tags-pack-to-administrate.sql`, plus journal and snapshots
- `apps/web/src/utils/tag-tools.util.ts`
- The test files named above

**Edit:**
- `apps/api/src/routes/entity-tag.router.ts`
- `apps/api/src/db/schema/entity-tags.table.ts`, `zod.ts`, `type-checks.ts`
- `apps/api/src/services/tools.service.ts`
- `apps/api/src/constants/provisioned-stations.constants.ts`
- `apps/api/src/prompts/system.prompt.ts`
- `apps/api/src/__tests__/system-principal.guard.test.ts`
- `packages/core/src/models/entity-tag.model.ts`
- `packages/core/src/registries/{builtin-toolpacks,station-data-packs,tool-capabilities,tier-catalog,tool-phase-labels}.ts`
- `packages/core/src/content/{glossary,faq}.util.ts`
- `apps/web/src/components/TagCard.component.tsx`, `PortalSession.component.tsx`
- `apps/web/src/utils/tool-pack-icons.util.ts` (`LocalOffer: LocalOfferOutlined`)

## Revisions after code review

`/code-review` changed four parts of the surface above. The code is the reference where they differ.

1. **Administrate is matched by `rbac_management` alone**, not with `member_management` (decision 6). #847 never backfilled `member_management`, so an org provisioned between #848 and #847 has an Administrate without it. `0140` also rewrites Administrate's description, but only where it is still exactly the #847 default.
2. **Assignment is one transaction.** `TagAssignmentService.assignMany` / `unassignMany` load the permissions once, check every object and tag, then lock them and write every pair in one transaction, so a failure part-way through applies nothing. The tools call them; the tools' own pre-flight is gone. `unassignMany` reads each object's tags inside the transaction, so a pair removed meanwhile reports `not_assigned`.
3. **Tags are row-locked for writes.** An assign share-locks the tag; a delete update-locks it. A delete waits for assigns in flight, and an assign after it finds the tag gone.
4. **`removedFrom` is opt-in** (`EntityTagService.delete(ctx, id, { countRemoved })`, which only `tag_delete` passes) and counted inside the delete's transaction, under the tag lock.

## Revisions after the smoke walk

5. **The pack finds its own object ids: `tag_target_list({ type, search?, limit?, offset? })`** → `{ targets: { type, id, name }[], total }`, the objects of one taggable type the caller can read (org-scoped, the type's read visibility; `search` on the name, and on the key for views and entities), sorted by name. `rbacRead()`, free. Without it the agent on Administrate, which has no data and no other lookup tools, could tag nothing, and no tool anywhere listed pinned results.
6. The prompt says `tag_list` / `tag_target_list` return only what the user can read: an empty result means none they can see.

## Revisions after the adversarial walk

7. **Tag names are unique per org among live tags, in the database.** Migration `0141_unique-entity-tag-name` adds the partial unique index `entity_tags_org_name_unique (organization_id, name) WHERE deleted IS NULL`. It first renames every live duplicate except each name's oldest to `<name> (<first 8 of its id>)`, so a database the old race already reached still migrates. `EntityTagService` keeps its pre-check for the clean 409, and a create or rename that races past it hits the index and gets the same `409 ENTITY_TAG_DUPLICATE_NAME`. The walk had found five parallel creates of one name all answering 201.
8. **Replayed tool results say they're from an earlier turn.** History reconstruction (`replayResult` in `portal.service.ts`) wraps a recent turn's JSON result as `{ fromEarlierTurn: true, result }` and prefixes a text one with `[From an earlier turn]`. Row summaries already read `[Previous … result …]`. The system prompt says such a result is history: call the tool again for anything current, never claim a call was made this turn when it wasn't, and when a tool used earlier is gone, say its pack isn't on this station. The walk had the agent answer "Already done this turn" from a previous turn's results, naming a station deleted since and ignoring a pack removed since.

## Next step

`docs/TAGS_TOOLPACK.plan.md` sequences this as about eight TDD slices on this branch:

1. `EntityTagService` extraction.
2. Tag provenance (`0139`, model, chip).
3. Pack registry.
4. `runTagTool` and the catalog tools.
5. The assignment tools.
6. Provisioning and `0140`.
7. Turn-end refresh.
8. Prompt and help copy.
