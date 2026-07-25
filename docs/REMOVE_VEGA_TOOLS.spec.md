# Remove Vega/Vega-Lite visualization tools — Spec

**Issue:** [EnterpriseBT/portal-ai#272](https://github.com/EnterpriseBT/portal-ai/issues/272) · **Epic:** #267 · **Discovery:** `docs/REMOVE_VEGA_TOOLS.discovery.md` · **Task**

Pins the total removal of Vega/Vega-Lite: the two tools + their compute/validators/rewrite util, the `vega`/`vega-lite`/`react-vega` dependencies, the block renderers (no replacement), the `vega`/`vega-lite` block/result **types** including the Postgres enum (destructive migration), the webhook Vega envelope, and every doc/test reference. End state: `visualize_d3` is the only chart tool and no Vega vocabulary survives outside historical `docs/*.md`.

## Key decisions (from discovery, all resolved)

1. **No replacement renderer** (D1-C) — delete the Vega renderers + deps; an unregistered block type already renders `null` via `ContentBlockRenderer`. No placeholder.
2. **Remove the types + pg enum** (D2-B) — drop `vega`/`vega-lite` from `PortalResultTypeSchema`, `PortalBlockTypeSchema`, and the `portal_result_type` pg enum via a hand-authored destructive migration; no backfill (no rows carry them). The dual-schema type-check (`type-checks.ts:603`) forces the Zod model and the Drizzle enum to move together.
3. **Total cut incl. webhook + custom-tool doc** (D3) — remove `webhook.tool.ts`'s Vega propagation and delete the Vega envelope sections of `CUSTOM_TOOLPACK_INTEGRATION.md`.
4. **Cross-ticket:** removing the types empties `PINNABLE_BLOCK_TYPES` of visualization types (`d3` was never pinnable) — flag #273 for re-scope; #272 does not touch pin-affordance code.

## Scope

### In scope
apps/api tool + compute + validator + util + dep removal; core registry/capability/pin + renderer + type removal + deps; web routing + `QueryResultDataBlock`/`PortalMessage` + webhook + deps; the enum migration + drizzle-zod/type-check regen; prompt + swagger + custom-tool-doc sync; test strip/delete.

### Out of scope
Converting historical Vega specs (none exist); the `visualize` *pack* / `visualize_d3` (untouched); pin-affordance changes (#273); any D3 change.

## Surface

### apps/api — tools + compute (delete)
- Delete files: `tools/visualize.tool.ts`, `tools/visualize-tree.tool.ts`, `utils/vega-spec-rewrite.util.ts`.
- `services/analytics.service.ts`: delete `visualize` (`:516-531`), `visualizeVega` (`:541-578`), `validateVegaLiteSpec` (`:264-271`), `validateVegaSpec` (`:273-283`), and the now-dangling `vega`/`vega-lite`/`VegaLiteSpecInput` imports (`:31-34`,`:40`).
- `services/tools.service.ts`: delete imports (`:23-24`), instantiation (`:510-514`), and `"visualize"`/`"visualize_tree"` from `BUILTIN_TOOL_NAMES` (`:169-170`). Keep `visualize_d3` (`:25`,`:171`,`:529-533`).
- `tools/webhook.tool.ts:198-213`: delete the `type:"vega-lite"`/`type:"vega"` propagation arms (keep the other result-type arms).
- `package.json`: remove `vega` (`:75`), `vega-lite` (`:76`).

### packages/core — registry + capability + renderer + types (edit/delete)
- `registries/builtin-toolpacks.ts`: delete the `visualize` (`:205-219`) and `visualize_tree` (`:221-235`) tool literals from the `data_query` pack; delete the `visualize`/`visualize_tree` `CAPABILITIES` entries (`:1089-1090`); reword the pack description (`:162`) to drop "Vega-Lite or Vega". Keep the `visualize` *pack* slug (`:39`) and `visualize_d3`.
- `ui/ContentBlockRenderer.tsx`: delete `LazyVegaLite`/`LazyVega` (`:12-18`), `ensureBaseDataset`/`fixForceLayout`/`fixStratifyRoots`/`normalizeVegaSpec`, `VegaErrorBoundary` (`:183-`), `renderVegaLite`/`renderVega` (`:240-280`), `CHART_BOUNDS` (`:234`), and the `["vega-lite",…]`/`["vega",…]` Map seeds (`:299-300`), plus the `react-vega` import (`:13,17`). **No replacement seed.**
- `models/portal-result.model.ts:13-19` — `PortalResultTypeSchema` becomes `z.enum(["text","data-table"])`.
- `contracts/portal.contract.ts:164-174` — `PortalBlockTypeSchema` drops `"vega-lite"`,`"vega"` (keeps `text`,`data-table`,`mutation-result`,`tool-call`,`tool-result`,`d3`); update the doc comment. `PINNABLE_BLOCK_TYPES` auto-narrows (derived).
- `package.json`: remove `react-vega`/`vega`/`vega-lite` from **both** the deps block (`:81,83,84`) and the peer/dev block (`:111,117,118`).

### apps/api — DB schema + enum
- `db/schema/portal-results.table.ts:10-15` — `portalResultTypeEnum` becomes `pgEnum("portal_result_type", ["text","data-table"])`.
- `db/schema/zod.ts` — `createSelectSchema(portalResults)` re-derives automatically; no manual edit beyond regen.
- `db/schema/type-checks.ts:603` — the `IsAssignable<PortalResultSelect, PortalResult>` pair keeps compiling once both sides drop the two values (this is the guardrail that the Zod + Drizzle enums moved together).
- `config/swagger.config.ts:1411-1412` — pinned-result response `enum`/`example`: drop `vega-lite` (align to `["text","data-table"]`).

### apps/web — routing (edit)
- `services/portal.service.ts` `resolveDisplayBlock`: delete the vega-lite arm (`:177-182`) and vega arm (`:183-188`); keep d3 + data-table.
- `utils/portal-stream.util.ts` `streamingBlockFor`: delete the `visualize`/`type:vega-lite` and `visualize_tree`/`type:vega` arms (`:47-50`) + the "legacy Vega path" comment (`:36`); keep d3 + data-table + mutation.
- `components/QueryResultDataBlock.component.tsx`: delete the chart/`spec` branch (`:97-116`) and the `spec` field from the content type/props (`:28,38,48,87,150`) — the component becomes data-table-handle-only.
- `components/PortalMessage.component.tsx`: narrow `renderWebBlock` (`:62`) and `shouldRenderViaWeb` (`:118`) from `"vega-lite" || "data-table"` to `"data-table"`.

### Prompt + docs
- `apps/api/src/prompts/system.prompt.ts`: in the Charting block, drop the "preferred over the older `visualize` / `visualize_tree` (Vega) tools, which are being retired" clause (`:304-305`) — state `visualize_d3` plainly as the chart tool.
- `docs/CUSTOM_TOOLPACK_INTEGRATION.md`: delete the `vega-lite`/`vega` webhook-envelope sections.

## Migration

`portal_result_type` is a Postgres enum with no in-place `DROP VALUE`. `db:generate` won't emit a value-drop, so: **(1)** edit `portalResultTypeEnum` to `["text","data-table"]` and run `cd apps/api && npm run db:generate -- --name remove_vega_portal_result_types` to advance the drizzle snapshot (`meta/`) to the 2-value enum; **(2)** replace the generated SQL body with the hand-authored recreate-type sequence:

```sql
ALTER TYPE "public"."portal_result_type" RENAME TO "portal_result_type_old";
CREATE TYPE "public"."portal_result_type" AS ENUM('text', 'data-table');
ALTER TABLE "portal_results" ALTER COLUMN "type" TYPE "public"."portal_result_type"
  USING "type"::text::"public"."portal_result_type";
DROP TYPE "public"."portal_result_type_old";
```

Migration index `0073`. **No backfill / no dual-write** — no row carries `vega`/`vega-lite` (no production data; ephemeral QA), so the `USING` cast cannot fail; if a stray row existed the cast errors loudly (fail-safe, not silent corruption). Rollback = `git revert` + the inverse `ADD VALUE` (values re-add cheaply; the tools do not come back).

## Seed
None — no seed references Vega.

## TDD test plan

Delete-heavy: the "tests" are largely removed assertions plus a few positive checks that the vocabulary is gone. Run via `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit && npm run test:integration`; `cd apps/web && npm run test:unit`.

### Layer 1 — core registry/capability/type pins
1. Delete `visualize`/`visualize_tree` from `EXPECTED_COST_HINTS` (`tool-capabilities.test.ts:124-125`) — the key-set equality assertion (`:137`) then passes; `visualize_d3:"expensive"` stays.
2. `builtin-toolpacks.test.ts`: `BUILTIN_TOOLPACKS` data_query pack no longer lists `visualize`/`visualize_tree` tools; globally-unique + capability-coherence suites stay green.
3. `portal-result.model.test.ts`: **delete** the `vega-lite`/`vega` accept cases (`:138-175`) + fixtures (`:21,47,284`); add a case asserting `PortalResultTypeSchema.safeParse("vega").success === false`.
4. `portal.contract.test.ts`: **delete** the `"vega"` block-type accept (`:153-155`) + `PINNABLE_BLOCK_TYPES.has("vega")` (`:167-168`); add `PortalBlockTypeSchema.safeParse("vega-lite").success === false` and `PINNABLE_BLOCK_TYPES` contains no visualization type.
5. `ContentBlockRenderer.test.tsx`: **delete** the entire vega/vega-lite render + repair-heuristic suite (~38 refs); add a case that `ContentBlockRenderer` renders `null` for a `{type:"vega-lite"}` block (unregistered) — no crash.

### Layer 2 — api tool/compute/route pins
6. `analytics.service.test.ts`: delete the 9 vega cases (visualize/visualizeVega/validators).
7. `tools.service.test.ts`: delete the `vega`/`vega-lite` module mocks (`:78-86`) and the `visualize`/`visualize_tree` registration assertions; the "wraps every built tool" + entitlement guards stay green (fewer tools).
8. `portal.service.test.ts`: delete the `resolveDisplayBlock` vega-lite/vega cases (19 refs); the d3 + data-table + mutation cases stay.
9. **Backward-compat deletions:** `portal-results.repository.integration.test.ts:99-114` (persists a `vega-lite` pinned result) — delete/rewrite to a valid type; it would otherwise fail the enum `CHECK`.

### Layer 3 — web routing pins
10. `portal-stream.util.test.ts`: delete the `visualize`/`visualize_tree`→vega mapping cases; the d3 + fallback + data-table cases stay; add that a `visualize`/`visualize_tree` toolName no longer maps to a block.
11. `QueryResultDataBlock.test.tsx`: delete the chart-path (spec) cases; keep the tabular-handle cases.
12. `PortalMessage.test.tsx`: delete/adjust the vega-lite routing cases; keep data-table + d3 + text.

### Layer 4 — migration + build
13. Migration integration probe: on a fresh migrated DB, `portal_result_type` has exactly `{text, data-table}`; inserting a `portal_results` row with `type='data-table'` succeeds and `type='vega'` is rejected by the enum.
14. Build/grep guard: `cd apps/api && npm run build` succeeds with no `vega`/`vega-lite` in `apps/api/package.json`; a repo grep `grep -rn "vega" apps packages --include=*.ts --include=*.tsx` returns nothing (outside comments removed by this change) — enforced manually in smoke, not a unit test.

**Totals ≈ 14 cases** (mostly deletions + a handful of positive "vocabulary-gone" assertions). Migration probe is the one net-new integration case.

## Acceptance criteria

- [ ] No `vega`/`vega-lite` vocabulary survives in source: not a tool, block/result type, pg enum value, renderer, dependency, webhook envelope, or prompt reference — `grep -rn vega apps packages --include=*.ts --include=*.tsx` is clean.
- [ ] `apps/api` builds with no `vega`/`vega-lite` deps; `apps/web` + `packages/core` build with no `react-vega`/`vega`/`vega-lite` deps.
- [ ] The agent is offered no `visualize`/`visualize_tree` tool; chart prompts route to `visualize_d3`.
- [ ] `npm run db:migrate` on a fresh DB yields `portal_result_type = {text, data-table}`; `PINNABLE_BLOCK_TYPES` contains no visualization type.
- [ ] A persisted/streamed block of type `vega-lite`/`vega` renders `null` (nothing), never a crash or blank-with-error.
- [ ] `npm run lint && npm run type-check && npm run test` green at root (the dual-schema type-check confirms the Zod + Drizzle enums moved together).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A real row carries `vega`/`vega-lite` and the enum migration's `USING` cast fails. | Precluded by "no production data / ephemeral QA"; the cast **errors loudly** rather than corrupting — fail-safe. Confirmed by the migration probe (test 13). |
| Dual-schema drift: Zod enum edited but pg enum not (or vice versa). | `type-checks.ts:603` fails `type-check` — the change can't merge half-done. |
| A dangling `react-vega`/`vega` import left after deletion. | `type-check` + `npm run build` fail on the missing module; grep-clean acceptance. |
| Removing types breaks #273's premise. | Flagged (discovery cross-ticket note): #273 re-scopes; #272 leaves pin-affordance code alone. |

**Rollback:** `git revert` the branch + re-add the enum values (`ALTER TYPE … ADD VALUE`); backward-incompatible but data-lossless (no rows depend on the removed values). Recorded backward-incompatible cut, justified by ephemeral-QA / no-prod-data.

## Files touched

**Delete:** `apps/api/src/tools/visualize.tool.ts`, `visualize-tree.tool.ts`, `utils/vega-spec-rewrite.util.ts`, `apps/api/src/__tests__/utils/vega-spec-rewrite.util.test.ts`.
**Edit (api):** `services/analytics.service.ts`, `services/tools.service.ts`, `tools/webhook.tool.ts`, `services/portal.service.ts`, `db/schema/portal-results.table.ts`, `config/swagger.config.ts`, `prompts/system.prompt.ts`, `package.json`, + new migration `drizzle/0073_remove_vega_portal_result_types.sql` + `meta/` snapshot; tests: `analytics.service.test.ts`, `tools.service.test.ts`, `portal.service.test.ts`, `__integration__/routes/portal-results.repository.integration.test.ts`.
**Edit (core):** `registries/builtin-toolpacks.ts`, `ui/ContentBlockRenderer.tsx`, `models/portal-result.model.ts`, `contracts/portal.contract.ts`, `package.json`; tests: `tool-capabilities.test.ts`, `builtin-toolpacks.test.ts`, `models/portal-result.model.test.ts`, `contracts/portal.contract.test.ts`, `ui/ContentBlockRenderer.test.tsx`.
**Edit (web):** `utils/portal-stream.util.ts`, `components/QueryResultDataBlock.component.tsx`, `components/PortalMessage.component.tsx`, `package.json`; tests: `portal-stream.util.test.ts`, `QueryResultDataBlock.test.tsx`, `PortalMessage.test.tsx`.
**Edit (docs):** `docs/CUSTOM_TOOLPACK_INTEGRATION.md`.

## Next step

`docs/REMOVE_VEGA_TOOLS.plan.md` slices it: (1) api tools + compute + validators + webhook + api deps (unit); (2) core registry/capability/pins + renderer + type enums + core deps (unit); (3) web routing + `QueryResultDataBlock`/`PortalMessage` + web deps (unit); (4) the pg-enum migration + drizzle-zod/type-check regen + swagger/prompt/custom-tool doc-sync (integration probe). Each a testable commit; the smoke verifies the inverse of #269 (chart → `visualize_d3`, no Vega offered) plus a clean `vega` grep and green build with the deps gone.
