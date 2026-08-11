# Smooth-gradient (interpolate) colorBy mode — Plan

**Implements the `interpolate` colorBy scale TDD-first: core contract + palette, a behavior-preserving legend refactor, the interpolate render feature, the server back-fill, and the agent surfaces.**

Spec: `docs/SMOOTH_GRADIENT_COLORBY.spec.md`. Discovery: `docs/SMOOTH_GRADIENT_COLORBY.discovery.md`. Issue: #336 (epic #84). Builds on the `step` + null-guard from #330/#335/#346.

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/smooth-gradient-colorby`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"), base `epic/gis-toolpack`.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
cd apps/api && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **S1** lands the core contract field + `SEQUENTIAL_PALETTE` that both web (S3) and api (S4) import, so it must be first. **S2** is a mechanical, behavior-preserving refactor of the legend return type to the discriminated shape (all ripple sites at once, so the tree stays compilable) with no new behavior — isolating the type churn from the feature. **S3** is the actual interpolate render feature, depending on S1's field/palette and S2's `MapLegend` gradient variant. **S4** brings the server back-fill onto interpolate (needs S1). **S5** is text-only agent surfaces + doc-sync (needs S1's field to exist). No forward dependencies.

---

## Slice 1 — core: `scale` field + `SEQUENTIAL_PALETTE`

Adds the optional `colorBy.scale` enum and the shared sequential palette. Pure additive contract + constant; nothing consumes them yet.

**Files**

- New: `packages/core/src/constants/map-palette.constants.ts` — `SEQUENTIAL_PALETTE` (viridis 6-stop, `as const`).
- Edit: `packages/core/src/constants/index.ts` — re-export the palette.
- Edit: `packages/core/src/contracts/map-spec.contract.ts` — add `scale: z.enum(["categorical","step","interpolate"]).optional()` to `colorBy` (spec Surface §1).
- New: `packages/core/src/__tests__/constants/map-palette.constants.test.ts`.
- Edit: `packages/core/src/__tests__/contracts/map-spec.contract.test.ts`.

**Steps**

1. **Tests (spec: core contract ~3 cases + palette ~1 case).** `scale` omitted parses; each enum value parses; `scale:"foo"` fails; `SEQUENTIAL_PALETTE` ≥2 entries and every entry `#rrggbb`. Run; fail.
2. **Implement** the palette const + the optional enum field. Green.
3. Lint + type-check.

**Done when:** the contract accepts `scale` (absent-compatible) and `SEQUENTIAL_PALETTE` is exported + validated. Nothing else references either yet.

**Risk:** none — additive-optional; `npm run build` of core needed so web/api see the new export in later slices (dist is git-ignored).

---

## Slice 2 — web: discriminated `MapLegend` refactor (behavior-preserving)

Converts the legend return type from flat `LegendEntry[]` to the discriminated `MapLegend` (`swatches`-only path), updating **every** ripple site in one commit so the tree compiles. No new behavior — match/step render exactly as before.

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — add `GradientStop` + `MapLegend` types; `resolveColorBy`/`layerToMapLibre` return `{ …, legend: MapLegend | null }`; step/match branches return `{ kind:"swatches", entries }`; `buildLegend` returns `MapLegend[]` (skips `null`).
- Edit: `apps/web/src/modules/MapWidget/index.ts` — export `MapLegend`, `GradientStop`.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — memo types `legend: MapLegend[]`; the legend block switches on `kind` (only `swatches` implemented → the existing swatch markup, `data-testid="map-widget-legend"`).
- Edit: `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` — update existing legend assertions to the `{ kind:"swatches", entries }` shape.

**Steps**

1. **Tests (spec: map-config regression cases).** Update the existing categorical/step legend assertions to expect `MapLegend` (`kind:"swatches"`); `buildLegend` returns an array of them. Run; fail (shape mismatch).
2. **Implement** the type + convert all four ripple sites + the render switch. Green — all pre-existing MapWidget/map-config tests pass with the new shape.
3. Lint + type-check.

**Done when:** every legend flows as `MapLegend`; match/step maps render identically; no interpolate path yet.

**Risk:** the return-type change is compile-time enforced across `layerToMapLibre`/`buildLegend`/memo — TS catches any missed site. Keep the swatch markup byte-identical so the `map-widget-legend` render test is untouched.

---

## Slice 3 — web: `resolveColorBy` interpolate branch + gradient render (the feature)

The heart of #336: scale-forced resolution, the `interpolate` expression, the gradient legend variant + its bar render, and the `<2`-stop fallback.

**Files**

- Edit: `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — effective-scale resolution (`colorBy.scale ?? inferred`; absent never → interpolate); interpolate branch building `["case",["has",col],["interpolate",["linear"],["to-number",…],v,c,…],UNMATCHED]` over sorted/deduped numeric stops; gradient legend `{ kind:"gradient", min, max, stops }`; row-derived fallback uses `colorBy.palette ?? SEQUENTIAL_PALETTE`; `<2` distinct numeric → fall through to step/solid.
- Edit: `apps/web/src/modules/MapWidget/MapWidget.component.tsx` — add the `gradient` arm to the legend switch: a `linear-gradient` bar (`data-testid="map-widget-legend-gradient"`) + min/max caption labels.
- Edit: `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` — interpolate cases.
- Edit: `apps/web/src/modules/MapWidget/__tests__/MapWidget.test.tsx` — gradient render cases.

**Steps**

1. **Tests (spec: map-config ~8 cases + MapWidget ~2 cases).** interpolate expression shape + ascending breakpoints + `case/has/to-number` guard; 1-stop → step/solid fallback; no-stops row-derive uses `SEQUENTIAL_PALETTE`; `scale:"step"`/`"categorical"` force their mode; absent `scale` unchanged inference (regression); `buildLegend` mixed spec → both a swatches and a gradient legend; gradient legend renders the bar + min/max labels; swatch legend still renders. Run; fail.
2. **Implement** the interpolate branch + gradient render arm. Green.
3. Lint + type-check.

**Done when:** a numeric `colorBy` with `scale:"interpolate"` renders a continuous blend + gradient bar; every other scale unchanged; nulls → no-data, never black.

**Risk:** MapLibre requires strictly-ascending interpolate stops — dedupe equal values, and if `<2` remain fall back (tested). The `to-number` coercion must wrap the input exactly as `step` does (a raw interpolate throws on null → black layer).

---

## Slice 4 — api: server back-fill `MIN/MAX` interpolate anchors

Populates interpolate stops server-side (tile path has no inline rows) for raw + aggregate layers.

**Files**

- Edit: `apps/api/src/tools/visualize-map.tool.ts` — in the back-fill loop (`:219-243`), branch on `cb.scale === "interpolate"` → run `SELECT MIN/MAX`, emit `SEQUENTIAL_PALETTE.length` even-linear anchors from `cb.palette ?? SEQUENTIAL_PALETTE`; non-numeric / `hi===lo` → leave stops empty. Distinct-value path unchanged otherwise.
- Edit: `apps/api/src/__tests__/tools/visualize-map.tool.test.ts` — interpolate back-fill cases.

**Steps**

1. **Tests (spec: visualize-map ~2 cases).** With a mocked `sqlQuery` returning `{lo,hi}` for the `MIN/MAX` query, `scale:"interpolate"` → `cb.stops` are `SEQUENTIAL_PALETTE.length` ascending `[value,color]` anchors from the sequential palette; the categorical `GROUP BY` query is **not** run. Run; fail.
2. **Implement** the interpolate back-fill branch (imports `SEQUENTIAL_PALETTE` from core — needs S1's core build). Green.
3. Lint + type-check.

**Done when:** an interpolate layer gets sequential MIN/MAX anchors server-side, so the tile path colors correctly; categorical/step back-fill unchanged.

**Risk:** the mock must distinguish the `MIN`/`MAX` SQL from the existing `GROUP BY` SQL (match on `MIN(`); mirror the existing test's `sql.includes(...)` dispatch.

---

## Slice 5 — agent surfaces + doc-sync

Teaches the agent to choose `interpolate`, keeping the three tool/prompt surfaces in sync (per `CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit: `apps/api/src/tools/visualize-map.tool.ts` — `description` gains the `colorBy.scale` clause (spec Surface §5).
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — the mirror description, byte-identical where the pinning test compares.
- Edit: `apps/api/src/prompts/system.prompt.ts` — the "smooth gradient → `scale:"interpolate"`" sentence.
- Edit: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` + `apps/api/src/__tests__/prompts/system.prompt.test.ts` — update pinning/snapshot.

**Steps**

1. **Tests (spec: pinning surfaces).** The mirror/tool descriptions stay in sync and contain the `scale` clause; the system-prompt assertion covers the gradient sentence. Run; fail.
2. **Implement** the three text edits. Green.
3. Lint + type-check.

**Done when:** the agent can pick `interpolate` from a "smooth gradient" prompt; all pinning tests green.

**Risk:** the tool ↔ mirror pinning test compares descriptions — edit both identically or CI fails.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| S1 | core `scale` enum + `SEQUENTIAL_PALETTE` | contract + palette unit tests |
| S2 | discriminated `MapLegend` refactor (swatches-only) | existing map-config/MapWidget tests green on new shape |
| S3 | interpolate expression + gradient render + fallback | interpolate map-config + MapWidget gradient tests |
| S4 | server `MIN/MAX` interpolate back-fill | visualize-map back-fill tests (mocked SQL) |
| S5 | agent description + mirror + system prompt | pinning/snapshot tests |

## Cross-slice notes

- **Core rebuild between S1 and S3/S4.** `@portalai/core` dist is git-ignored; run `npm run build` in core after S1 so web (S3) + api (S4) type-check against the new `scale` field + `SEQUENTIAL_PALETTE` (`project_stale_core_dist_after_branch_switch`).
- **`MapLegend` spans S2→S3.** S2 introduces the type with only the `swatches` arm; S3 adds the `gradient` arm. The S2 render switch should be written so S3 only *adds* a case (exhaustive switch already in place).
- **Doc-sync is S5, not deferred.** The tool description, its `builtin-toolpacks.ts` mirror, and `system.prompt.ts` are the three surfaces from `CLAUDE.md`'s "what changed → what to check" (a tool's capability changed) — all land in this PR.
- **No migration / no DB test.** `scale` is JSON block content; the S4 back-fill test mocks `sqlQuery`. Nothing touches the schema.

## Next step

Once discovery + spec + plan are confirmed, implementation begins on `feat/smooth-gradient-colorby` — Slice 1 first, tests-first, one commit per slice, each PR'd into `epic/gis-toolpack` as the epic's final feature child before close-out.
