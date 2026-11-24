# Tags toolpack — Plan

**TDD-sequenced implementation of the built-in Tags pack: a shared `EntityTagService`, tag session provenance, the pack and its six tools, Administrate provisioning with its backfill, the session's turn-end refresh, and the help copy.**

Spec: `docs/TAGS_TOOLPACK.spec.md`. Discovery: `docs/TAGS_TOOLPACK.discovery.md`. Issue: #1071. Builds on **shipped #1070** (`TagAssignmentService`, the five `TagTargetType`s, `tagCatalogChangeKeys`), all live on `main`.

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/1071-tags-toolpack`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, never jest directly, and only the touched files locally (`--testPathPattern`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` (and `format`) at the boundary. After a core change, run the root `npm run build`, since a new core field reaches typed fixtures in web and site.
5. Move to the next slice.

Sequencing rationale:

- **Slice 1** extracts `EntityTagService` first. The catalog tools need it, and the unchanged route tests prove the move on their own.
- **Slice 2** adds provenance next. `tag_create` writes `sourcePortalId`, so the column and model field must exist before the tool.
- **Slice 3** lands the pack together with the catalog tools. Adding the slug forces entries in `PACK_ELSEWHERE` / `PACK_PROMPT_SECTIONS` (a type error otherwise), and the schema-parity guard needs a Tool class behind every mirror. So the registry can't ship ahead of real tools.
- **Slice 4** adds the assignment tools to the existing pack. They are the largest piece of logic, built on slice 3's wrapper and wiring.
- **Slice 5** provisions the pack and backfills it. It needs the slug to exist (slice 3), and adding it last keeps Administrate from offering a half-built pack between slices.
- **Slice 6** is the web turn-end refresh. It needs only the tool names.
- **Slice 7** is the help copy, describing the finished capability.

---

## Slice 1 — `EntityTagService` extraction

Move the list, create, update and delete logic out of `entity-tag.router.ts` with no behaviour change. `delete` returns `removedFrom` (readable usage, read before the delete) for the tool to use later, and the route keeps answering `{ id }`.

**Files**

- New: `apps/api/src/services/entity-tag.service.ts`, the four static methods (spec § EntityTagService).
- Edit: `apps/api/src/routes/entity-tag.router.ts`. Handlers parse, call the service and respond.
- New: `apps/api/src/__tests__/__integration__/services/entity-tag.service.integration.test.ts`.

**Steps**

1. **Tests (spec § integration, service file).**
   - List: visibility and search.
   - Create: class-write 403, duplicate 409.
   - Update: unreadable 404, read-only 403, rename-duplicate 409.
   - Delete: sweeps assignments; `removedFrom` counts only objects the caller reads, which needs an assignment on an object shared away from the caller.
   
   Run them; they fail.
2. **Implement** by moving the bodies across verbatim and pointing the router at them. Green.
3. Run the existing `entity-tag` route integration tests **unchanged**. They must stay green.
4. Lint and type-check.

**Done when:** the service tests pass and every existing tag route test passes with no edits.

**Risk:** a subtle response change (status, payload key). The unchanged route suite is the check.

---

## Slice 2 — Tag session provenance

**Files**

- New: `apps/api/drizzle/0139_add-entity-tag-source-portal-id.sql`, plus the journal and snapshot, via `npm run db:generate -- --name add-entity-tag-source-portal-id`.
- Edit:
  - `apps/api/src/db/schema/entity-tags.table.ts`, `zod.ts`, `type-checks.ts`;
  - `packages/core/src/models/entity-tag.model.ts` (`sourcePortalId: SourcePortalIdSchema`);
  - `EntityTagService.create` (the `opts.sourcePortalId` parameter);
  - `apps/web/src/components/TagCard.component.tsx` (the chip).
- Tests: `packages/core/src/__tests__/models/entity-tag.model.test.ts`, the service integration file from slice 1, `apps/web/src/__tests__/TagCard.test.tsx`.

**Steps**

1. **Tests.**
   - Core: `sourcePortalId` is optional and nullable.
   - Integration: create with `sourcePortalId` stores it; a route create stores null.
   - Web: the chip shows for `sourcePortalId: "p-1"` and is absent for null; axe stays clean.
   
   Run them; they fail.
2. **Implement** the column, migration, model field, service parameter and chip. `npm run db:migrate` locally. Green.
3. Run the root `npm run build` (the core model change reaches web and site fixtures), then lint and type-check.

**Done when:** a tag created with a portal id round-trips it, and `TagCardUI` shows the chip only then.

**Risk:** typed fixtures of `EntityTag` in web and site need the new field. The root build catches them.

---

## Slice 3 — The Tags pack and the catalog tools

**Files**

- Edit, core:
  - `builtin-toolpacks.ts`: the slug, `TAG_MANAGEMENT_PACK` with four mirrors (`tag_list`, `tag_create`, `tag_update`, `tag_delete`), and their `CAPABILITIES`;
  - `station-data-packs.ts`, `tool-capabilities.ts` (`ALWAYS_ENTITLED_PACKS`), `tier-catalog.ts` (standard and plus), `tool-phase-labels.ts` (four labels).
- New, api: `apps/api/src/tools/tags/tag-tool.util.ts` (`runTagTool`), plus `tag-list.tool.ts`, `tag-create.tool.ts`, `tag-update.tool.ts`, `tag-delete.tool.ts`.
- Edit, api:
  - `tools.service.ts`: the `tag_management` block;
  - `system.prompt.ts`: `PACK_ELSEWHERE` and the "## Tags Notes" section, catalog guidance only;
  - `__tests__/system-principal.guard.test.ts`: `TagCreateTool` in `SESSION_CREATING_TOOLS`.
- Edit, web: `apps/web/src/utils/tool-pack-icons.util.ts` (`LocalOffer`).
- New tests:
  - `apps/api/src/__tests__/tools/tags/tag-tool.util.test.ts`;
  - `apps/api/src/__tests__/__integration__/tools/tags/tag-catalog-tools.integration.test.ts`.

**Steps**

1. **Tests.**
   - Core unit: the slug list, a capability for each tool, station-data `false`, every tier entitled, always-entitled tools all free, the phase-label key set.
   - `runTagTool` mapping: 403 rethrown, 404 → `TOOL_TARGET_NOT_FOUND`, 409 kept, 500 → `failedCode`, Zod → `ENTITY_TAG_INVALID_PAYLOAD`.
   - `tools.service.test.ts`: four tools built only with the pack, cost-wrapped and input-char-wrapped.
   - The prompt test renders "## Tags Notes" only with the pack.
   - Catalog integration, for owner, member and read-only member: list readable only; create class-write; update and delete per-object; a foreign-org tag gives `TOOL_TARGET_NOT_FOUND`; a session create carries `sourcePortalId`; delete reports `removedFrom`.
   
   Run them; they fail.
2. **Implement** the registry entries, the four tools over `EntityTagService`, the wiring and the prompt section. Schema parity is automatic. Green.
3. Run the root `npm run build`, lint and type-check.

**Done when:** on a station with `tag_management`, the four catalog tools work with UI-identical permissions, and every registry, parity, cost-wrap and session guard is green.

**Risk:** the largest slice, but it can't be split, because the slug and its records must land together. Keep the prompt section to the catalog tools; slice 4 extends it.

---

## Slice 4 — The assignment tools

**Files**

- New: `apps/api/src/tools/tags/tag-assign.tool.ts`, `tag-unassign.tool.ts`, with a shared pre-flight helper in `tag-tool.util.ts` (`preflightAssignment(ctx, tagIds, targets)`).
- Edit:
  - `builtin-toolpacks.ts`: two mirrors and capabilities;
  - `tool-phase-labels.ts`: two labels;
  - `tools.service.ts`: two more tools in the block;
  - `system.prompt.ts`: assignment guidance (resolve the id with `tag_list`, typed targets, report statuses).
- New: `apps/api/src/__tests__/__integration__/tools/tags/tag-assignment-tools.integration.test.ts`.

**Steps**

1. **Tests (spec § assignment integration).**
   - Each of the five types assigns and unassigns, plus a mixed-type call.
   - `already_assigned` / `not_assigned` no-ops.
   - A read-only target gives `TOOL_PERMISSION_DENIED`, and an unreadable or foreign target gives `TOOL_TARGET_NOT_FOUND`. In both cases, assert that **no** pair was applied.
   - An unreadable tag gives `TOOL_TARGET_NOT_FOUND`.
   - 11 tags or 51 targets are rejected.
   - Duplicate inputs are deduped.
   
   Run them; they fail.
2. **Implement** pre-flight then apply (spec § Assignment algorithm), on `TagAssignmentService.loadTarget` / `assign` / `unassign` and `findByTarget`. Green.
3. Lint and type-check.

**Done when:** every assignment case passes, and the tag routes' own tests are untouched.

**Risk:** pre-flight must not apply anything on refusal. The "nothing applied" assertions are the check.

---

## Slice 5 — Administrate provisioning and the backfill

**Files**

- Edit: `apps/api/src/constants/provisioned-stations.constants.ts`. Administrate's `builtinSlugs` gains `tag_management`, and its description mentions tags.
- New: `apps/api/drizzle/0140_attach-tags-pack-to-administrate.sql` (the spec's SQL), plus the journal and snapshot, via `npm run db:generate -- --custom --name attach-tags-pack-to-administrate`.
- New: `apps/api/src/__tests__/__integration__/migrations/attach-tags-pack-to-administrate.integration.test.ts`.
- Edit: the existing provisioning integration case in `application.service.integration.test.ts`.

**Steps**

1. **Tests.**
   - Provisioning: a new org's Administrate lists `tag_management`.
   - Migration, run via `connection.unsafe()` over hand-built fixtures:
     - a renamed Administrate gets the pack;
     - Playground doesn't;
     - an org already holding the pack gets no duplicate and no error;
     - a soft-deleted org is skipped;
     - a second run is a no-op.
   
   Run them; they fail.
2. **Implement** the constant and the migration. Run `npm run lint:migrations` (no destructive DDL, `portalai_system_id()`). `npm run db:migrate` locally. Green.
3. Lint and type-check.

**Done when:** new and existing orgs' Administrate both carry the pack, and re-running is a no-op.

**Risk:** app-dev data the fixtures don't model (the #627 class). The org-deleted join and `ON CONFLICT` on the partial index cover the known shapes.

---

## Slice 6 — Turn-end refresh in the session

**Files**

- New: `apps/web/src/utils/tag-tools.util.ts` (`TAG_WRITE_TOOLS`, `changedTags`), plus `apps/web/src/__tests__/tag-tools.util.test.ts`.
- Edit: `apps/web/src/components/PortalSession.component.tsx` `handleTurnEnd`, plus its existing turn-end test.

**Steps**

1. **Tests.**
   - `changedTags` is true for each write tool and false for `tag_list` and unrelated tools.
   - A turn with `tag_assign` invalidates each key of `tagCatalogChangeKeys()`.
   
   Run them; they fail.
2. **Implement.** The invalidation sits in the turn-end handler (a page-level effect of the stream, not a per-call mutation callback), so `mutation-invalidate.guard` doesn't apply. Confirm it stays green. Green.
3. Lint and type-check.

**Done when:** after a turn that changed tags, the Tags page and object pages show the change without a reload.

**Risk:** none beyond the guard check.

---

## Slice 7 — Help copy

**Files**

- Edit:
  - `packages/core/src/content/glossary.util.ts`: the "Tag" entry mentions the Tags pack;
  - `packages/core/src/content/faq.util.ts`: "What are tool packs?" lists Tags and says every plan includes it, and the Administrate answers name tags;
  - `apps/web/src/utils/getting-started.util.ts` only if it lists Administrate's capabilities.
- Tests: `glossary.util.test.ts`, `faq.util.test.ts`, `help-findability.test.ts`, run as they stand.

**Steps**

1. **Tests.** Pin the new phrasing where the existing tests pin pack lists. Run them; they fail where they pin.
2. **Implement** the copy. Run the permission-copy guards (no role-framed phrasing). Green.
3. Lint and type-check.

**Done when:** Help and the marketing site describe the Tags pack, and the findability tests are green.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `EntityTagService` | Service tests plus unchanged route tests |
| 2 | `0139`, `sourcePortalId`, the chip | Model, service and TagCard tests; root build |
| 3 | The pack, `runTagTool`, four catalog tools, the catalog prompt section | Registry, parity, cost-wrap and session guards; catalog integration |
| 4 | `tag_assign` / `tag_unassign` | Assignment integration with the "nothing applied" assertions |
| 5 | Administrate provisioning, `0140` | Provisioning plus migration integration; `lint:migrations` |
| 6 | Turn-end refresh | `changedTags` and turn-end invalidation tests |
| 7 | Glossary and FAQ | Content and findability tests |

## Cross-slice notes

- **Migrations:**
  - `0139` (slice 2) and `0140` (slice 5) each commit their `.sql`, `meta/_journal.json` and snapshot together.
  - The dev server seeds but doesn't migrate, so run `npm run db:migrate` after each.
  - Nothing names an enum value added in the same migration.
- **Root build** after slices 2 and 3 (core changes). `npx portalai` and `npx portalops` aren't involved.
- **Partial module mocks** in web tests that fake `api/sdk` don't affect slice 6, which reads `utils/tag-invalidation.util`.
- **Doc sync:**
  - The tool surfaces (`.tool.ts`, the `builtin-toolpacks.ts` mirror, `system.prompt.ts`) move together in slices 3 and 4.
  - Help copy is slice 7.
  - No egress change (`DEPLOYMENT_SECURITY_REVIEW.md` untouched), no new page or route (ACR untouched; the chip is an existing component), and no README or CLAUDE.md convention change.
- **Review chain:** after slice 7, `/code-review`, `/security-review` (required: authorization and multi-tenancy), `/smoke`, `/adversarial-review`.

## Next step

Implementation begins on `feat/1071-tags-toolpack` with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
