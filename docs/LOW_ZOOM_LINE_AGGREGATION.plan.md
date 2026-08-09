# Low-zoom aggregation treatment for line (and point) layers — Plan

**Implements the per-kind low-zoom treatment TDD-first: a shared `treatment` contract + resolver, then the server routing/ranking, then the web kind-gate, then the agent guidance — each a green, compilable commit.**

Spec: `docs/LOW_ZOOM_LINE_AGGREGATION.spec.md`. Discovery: `docs/LOW_ZOOM_LINE_AGGREGATION.discovery.md`. Issue: #337 (epic #84; UI settings deferred to #338). Builds on #330 (aggregation block + tile query) and #335 (render).

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/low-zoom-line-aggregation`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 (core) defines the field + `resolveAggTreatment` that both server and web import, so it must land first (no forward deps). Slice 2 (server) is the behavioral core — routing + ranking — and depends only on core. Slice 3 (web) consumes the same resolver for the paint gate + notice, independent of the server slice. Slice 4 (agent guidance + doc-sync) is prose/pinning only and rides last so the contract it describes is already real.

---

## Slice 1 — Core contract field + shared resolver

Adds `treatment` to the aggregation schema and the single-source-of-truth `resolveAggTreatment` both stacks share.

**Files**

- Edit: `packages/core/src/contracts/map-spec.contract.ts` — add `treatment: z.enum(["bins","none"]).optional()` to `MapLayerAggregationSchema`; export `type MapLayerKind`, `type AggTreatment`, and `resolveAggTreatment(kind, treatment?)`.
- Edit: `packages/core/src/__tests__/contracts/map-spec.contract.test.ts` — the core cases.

**Steps**

1. **Tests (spec: core cases).** `treatment:"bins"`/`"none"` accepted, invalid rejected, absent still valid (existing spec unchanged); `resolveAggTreatment` — `lines`→`none`, `points`/`polygons`/`heatmap`/`cluster`→`bins`, explicit `treatment` overrides each kind. Run; fail.
2. **Implement** the schema field + the resolver (explicit wins, else `kind === "lines" ? "none" : "bins"`). Green.
3. Lint + type-check (`packages/core`).

**Done when:** all core cases pass; `map-spec.contract.ts` exports `resolveAggTreatment`/`MapLayerKind`/`AggTreatment`; api + web still compile (new export + optional field are additive, nothing consumes them yet).

**Risk:** none — purely additive.

---

## Slice 2 — Server routing + importance ranking

Line layers route to the raw path (`enabled:false`) and the raw query orders by length so the per-tile cap keeps major features.

**Files**

- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `TileAggregation` gains `kind: MapLayerKind | null` + `rankByLength: boolean`; `aggregationFromSpec` reads the representative layer's `kind`/`treatment` (via `resolveAggTreatment`) → folds into `enabled` + `rankByLength`; `buildRawTileSql` gains a final `rankByLength` param inserting `ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC` before `LIMIT`; `defaultRunTileQuery` passes `aggregation.rankByLength`.
- Edit: `apps/api/src/__tests__/services/portal-map-tile.service.test.ts` — service unit cases.
- Edit: `apps/api/src/__tests__/__integration__/db/map-aggregation.integration.test.ts` — integration cases.
- Edit: `apps/api/src/scripts/postgis-benchmark.ts` — low-zoom ranked line-tile timing.

**Steps**

1. **Tests (spec: api unit + integration).** Unit: `aggregationFromSpec` line→`{enabled:false,rankByLength:true,kind:"lines"}`, polygon→`{enabled:true,rankByLength:false}`, `treatment:"bins"` on a line→`enabled:true`, `treatment:"none"` on a polygon→`enabled:false`, explicit `enabled:false` on a bins layer stays disabled; `buildRawTileSql` emits the `ORDER BY` iff `rankByLength`, byte-identical otherwise; `shouldAggregate` regression with the new interface. Integration: a tiled line layer at z<threshold returns raw line features (not bin polygons), longest-first over the cap with the truncation flag set; a tiled polygon at low zoom still returns bins; the ranked low-zoom line tile completes under `TILE_STATEMENT_TIMEOUT_MS`. Run; fail.
2. **Implement** the interface + `aggregationFromSpec` + `buildRawTileSql` param + `defaultRunTileQuery` wiring; update every other `TileAggregation` constructor (tests/fixtures) to set the two new fields. Green.
3. Lint + type-check (`apps/api`); run the benchmark once to capture the timing artifact.

**Done when:** unit + integration cases pass; a line layer renders raw+ranked at low zoom server-side; polygon/point bins unchanged; the benchmark shows the ranked line tile within budget.

**Risk:** every `TileAggregation` literal must gain the two fields or the build breaks — grep for constructions before implementing. Sort cost at z≲6 is the ceiling — the benchmark case is the gate; rollback lever is gating the `ORDER BY` to `z < zoomThreshold`.

---

## Slice 3 — Web kind-gate + kind-aware notice

The aggregate fill is only emitted for `"bins"` layers; line layers render real lines at all zoom, and the truncation copy reads as "most prominent features."

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — import `resolveAggTreatment`; gate the aggregate block (`:352-383`) on `treatment === "bins"`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — kind-aware truncation copy from `spec.layers`.
- Edit: `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` — layer cases.
- Edit: `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx` — notice-copy cases.

**Steps**

1. **Tests (spec: web cases).** Tiled line → no `-agg` fill + raw `-line` has no `minzoom`; tiled polygon/point → `-agg` fill + `minzoom` as today; `treatment:"bins"` on a line → `-agg` fill; `treatment:"none"` on a polygon → no `-agg` fill. Component: truncated + line → "most prominent features" copy; truncated + polygon → existing copy. Run; fail.
2. **Implement** the resolver-gated block + the kind-aware copy. Green.
3. Lint + type-check (`apps/web`).

**Done when:** web cases pass; a tiled line layer paints real lines at every zoom with no square-bin fill; polygon/point rendering is unchanged.

**Risk:** none beyond matching the existing `-agg`/`minzoom` assertions (regression cases guard them).

---

## Slice 4 — Agent guidance + doc-sync

Teach the agent the field exists and when to set it; keep the tool-description mirror + prompt pin in sync.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — Mapping block treatment guidance.
- Edit: `apps/api/src/tools/visualize-map.tool.ts` — spec `.describe` treatment note.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — mirror the `visualize_map` description (if it mirrors it).
- Edit: `apps/api/src/prompts/__tests__/system.prompt.test.ts` — prompt-pin case.
- (If mirrored) `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` guards the mirror automatically.

**Steps**

1. **Tests (spec: prompt pin).** Assert the Mapping block contains the treatment guidance (line layers stay a raw ranked network at low zoom by default; `treatment:"bins"`/`"none"` overrides). Run; fail.
2. **Implement** the prompt + tool-description text; update the `builtin-toolpacks.ts` mirror so its pinning test passes. Green.
3. Lint + type-check (`apps/api` + `packages/core`).

**Done when:** the prompt-pin + toolpack-mirror pinning tests pass; the agent-facing description names `aggregation.treatment`.

**Risk:** the mirror pinning test (`builtin-toolpacks.test.ts`) fails if the tool description changes without the mirror — update both in this slice.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | core `treatment` field + `resolveAggTreatment` | core cases green; api/web still compile |
| 2 | server routing (`enabled:false` for lines) + `ORDER BY ST_Length` ranking | api unit + integration green; benchmark within budget |
| 3 | web aggregate-block kind-gate + kind-aware notice | web cases green; lines paint raw at all zoom |
| 4 | agent guidance + tool-description mirror + prompt pin | prompt-pin + mirror pinning tests green |

## Cross-slice notes

- **`TileAggregation` constructors (slice 2):** the two new required fields (`kind`, `rankByLength`) must be set at every construction site — grep before implementing so the tree compiles at the slice boundary.
- **Shared resolver:** slices 2 + 3 both import `resolveAggTreatment` from `@portalai/core/contracts` (confirmed subpath). Rebuild `@portalai/core` after slice 1 before api/web type-check (`project_stale_core_dist_after_branch_switch`).
- **Doc-sync (per CLAUDE.md → "Keeping Documentation in Sync"):** the tool-description surfaces (`.tool.ts` + `builtin-toolpacks.ts` mirror + `system.prompt.ts`) all move in slice 4 — the pinning tests catch the mirror, the prompt-pin catches the prompt; the semantic "is the guidance right" check is manual.
- **No migration, no seed** — additive optional contract field only.
- **Smoke** (`/smoke 337` after implementation) walks the statewide-roads case + the `treatment` overrides against a recreated roads layer.

## Next step

Implementation begins on `chore/low-zoom-line-aggregation`, slice 1 first, tests-first, one commit per slice — only after discovery + spec + plan are confirmed.
