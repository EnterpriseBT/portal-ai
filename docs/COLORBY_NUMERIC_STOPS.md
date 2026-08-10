# colorBy numeric-string stops render grey — Condensed design (#346)

**Issue:** [EnterpriseBT/portal-ai#346](https://github.com/EnterpriseBT/portal-ai/issues/346) · Bug · epic [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `colorBy` on a numeric column renders every feature **grey** with a per-value legend. The `visualize_map` stop back-fill runs `SELECT DISTINCT <col>` and the Postgres driver returns numeric columns as **strings**, so `colorBy.stops` are numeric-*string* values (`"640"`, `"355.15"`). `resolveColorBy` decides "graduated" via `typeof value === "number"` — the strings fail it → it builds a categorical `["match", ["get", col], "640", …]`. But the rendered feature carries the column as a **number** (`1309.05`), so the match never hits a string stop → every feature falls to `UNMATCHED_COLOR` (grey), while the 100 string stops still produce a 100-item legend. This is the gap left by #335 (which routed *number*-typed stops to `step`). Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `graduated` detection | `apps/web/src/modules/MapWidget/utils/map-config.util.ts:~244` | `pairs.every(([v]) => typeof v === "number")` — **misses numeric strings**. |
| `step` build (graduated) | `map-config.util.ts:243-256` | breakpoints from `sorted[i][0]`; input already `["to-number", ["get", col], 0]` (so a numeric feature coerces fine — the step side is already type-tolerant). |
| categorical `match` (fallback) | `:259-267` | where string stops wrongly land → `["match", ["get", col], "640", …]` vs a number feature → `UNMATCHED_COLOR`. |
| stop back-fill (source of string stops) | `apps/api/src/tools/visualize-map.tool.ts:225-241` | `values` come straight from the driver (numeric → string) into `cb.stops`. |

## Decision — coerce numeric-string stops to numbers → `step`

In `resolveColorBy`, treat a stop value that is a **finite numeric string** as numeric: detect `graduated` with a coercion helper, and build the `step` breakpoints from the coerced numbers. The step's existing `to-number` input then matches the feature value (number *or* string), so **fills color correctly and match the legend** — eliminating the grey.

- A genuinely categorical column of numeric *codes* (e.g. `"1"`–`"18"`) would now render as a `step` (graduated bands) rather than a `match`. Accepted: it still colors correctly (bands over the codes), which is strictly better than grey; a true categorical-vs-continuous distinction isn't recoverable from stop *values* alone.
- **Not in scope:** the dense per-value legend (100 entries) and a smooth sequential ramp for continuous measures — that's the smooth-gradient work ([#336](https://github.com/EnterpriseBT/portal-ai/issues/336), parked), which adds `interpolate` + a gradient-bar legend. #346 makes the existing binned/step path *correct* (fills match the legend); #336 makes a continuous measure *pretty*.

## Plan — 1 slice

**Files**
- Edit `apps/web/src/modules/MapWidget/utils/map-config.util.ts` — add a `numericStop(v)` helper (finite number, or a finite numeric string → number, else `null`); `graduated = pairs.every(([v]) => numericStop(v) != null)`; build `sorted` from the coerced numbers.
- Edit `apps/web/src/modules/MapWidget/__tests__/map-config.util.test.ts` — tests below.

**Tests** (`cd apps/web && npm run test:unit`)
- Numeric-**string** stops (`[["640","#a"],["480","#b"]]`) → a `step` (not `match`), breakpoints are **numbers** sorted ascending, wrapped in the `case(has, …, UNMATCHED)` null-guard.
- Number stops (existing) → still `step` (regression).
- Genuinely non-numeric string stops (`[["vacant","#a"]]`) → still `match` (regression).
- Mixed (`[["640","#a"],["vacant","#b"]]`) → `match` (not all numeric → categorical).

## Smoke (manual, against your dev stack)

1. On the `GIS smoke` station, ask for *"map the 100 largest parcels by acreage"* (or any map colored by a numeric column).
2. **Expected:** parcels are **shaded by value** and the fills **match the legend colors** — no all-grey map.
3. Regression: a map colored by a **string** category (e.g. property class) still renders categorical colors; a map with no `colorBy` renders a solid color.

## Out of scope

- Reducing the 100-item legend / a smooth sequential ramp for continuous measures — #336 (smooth-gradient `interpolate` mode + gradient-bar legend).
- Casting numeric columns to `number` in the server back-fill — the web coercion fixes it regardless of the stored stop type; a back-fill cast is a redundant belt-and-braces, deferred.
