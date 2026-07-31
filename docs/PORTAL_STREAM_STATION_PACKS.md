# Portal stream station packs — Condensed design (#307)

**Issue:** [EnterpriseBT/portal-ai#307](https://github.com/EnterpriseBT/portal-ai/issues/307) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The per-message streaming path builds its `StationContext` from `(station as any).toolPacks` — a field that does not exist on a station row. So every streamed turn passes `[]`, `splitBuiltinPacks` short-circuits, and `effectiveToolPacks` is empty. That silently defeats #284's invariant that the prompt only claims capabilities for effective packs: no per-pack guidance renders, on any turn, on any station. Tools still work (they are derived independently), so the symptom is an agent operating without the instructions the prompt exists to give it. Single package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The phantom read | `portal-events.router.ts:99` | `((station as any).toolPacks as string[]) ?? []` → always `[]`. The `as any` is what let a wrong field name past `tsc`. |
| The row it reads from | `portal-events.router.ts:85-87` → `db/schema/stations.table.ts:13-19` | `repo.stations.findById` returns a `stations` row: base columns + `organizationId`, `name`, `description`. **No pack column.** The table's own comment (`:9-11`) says packs live in `station_toolpacks` and names the real payload field `enabledToolpacks`. |
| Where `enabledToolpacks` actually lives | `station.router.ts:202`, `:321`, `:497` | Hydrated per-response by the station router only — never by `findById`. |
| The short-circuit | `entitlement.service.ts:47-49` | `configuredSlugs.length === 0` returns `{ effective: [], unentitled: [], tier: "" }` — so the bug degrades silently instead of throwing. |
| The invariant it breaks | `system.prompt.ts:74-91` | "Everything the prompt says the agent CAN DO … emitted only for packs in `effectiveToolPacks`." Also `sqlAuthoringAvailable` (`:126-131`) and the `entity_management` gate (`portal.service.ts:1078`). |
| The correct derivation | `portal.service.ts:333-335` (`createPortal`) | Reads `station_toolpacks` and maps `builtinSlug`. `tools.service.ts:408-414` does the same for tool construction — which is why tools work. |
| The param that enabled it | `portal.service.ts:1054-1062` | `buildStationContext` takes `toolPacks` from the caller "to avoid re-fetching them when they're already in scope". |

## Decision — make `buildStationContext` derive its own packs

**Options.** (A) Fix the caller: derive from `station_toolpacks` in the router, mirroring `createPortal`. Minimal, but leaves the same footgun for the next caller and keeps two derivations. (B) Make `buildStationContext` query `station_toolpacks` itself and **remove the `toolPacks` parameter**. (C) Keep the param but type it so `undefined` is a compile error — narrower than B and still trusts callers to pass the right thing.

**Chosen: B.** The parameter is the bug: a function that takes "the station's configured packs" from its caller can be handed the wrong array, and here it was handed a phantom field. It already receives `station.id`, so it can derive the packs itself and cannot be lied to. Cost is one redundant query on the `createPortal` path (which fetches the rows anyway for its own `PORTAL_STATION_NO_TOOLS` validation) — negligible against a per-message LLM call, and #306 will collapse the derivation into `resolveStationPacks` at this one site.

The `as any` cast is deleted with the parameter, restoring type-checker coverage at the call site.

## Plan — 1 slice

**Files.**
- Edit `apps/api/src/services/portal.service.ts` — `buildStationContext` drops `toolPacks` from its args and derives from `DbService.repository.stationToolpacks.findByStationId(station.id)`, mapping `builtinSlug`; update the doc comment that documents the removed param. `createPortal` (`:363-367`) stops passing it.
- Edit `apps/api/src/routes/portal-events.router.ts` — delete `:98-99` (the eslint-disable and the phantom read) and the `toolPacks` argument at `:104-108`.

**Tests** (`apps/api/src/__tests__/services/portal.service.test.ts` — `buildStationContext` is exported and `mockFindByStationId_toolpacks` already exists at `:15`/`:24`). Run: `cd apps/api && npm run test:unit`.
- `buildStationContext` returns the station's configured built-in slugs in `effectiveToolPacks` **without being passed any packs** — the regression pin. Fails before the change (the arg is required), passes after.
- It ignores rows whose `builtinSlug` is null (custom-pack rows) rather than emitting `null` entries — pins current behavior; #306 changes what happens to those rows.
- A station with no rows still yields `{ effective: [], unentitled: [] }` and does not throw.
- Unentitled built-ins still land in `unentitledToolPacks` (the #284 split is unchanged by this fix).

## Smoke (manual, against your dev stack)

1. `npm run dev`, open a portal session on a station with `data_query` + `visualize` enabled.
2. Prompt **"what can you do on this station?"** → the reply describes the station's actual **built-in** capabilities (querying, charting, entities, stats, web search). Before the fix the prompt carried no pack guidance at all, so this answer was assembled from the tool list alone. *Weak evidence on its own — the tool list can carry a plausible answer either way; step 4 is what proves the invariant.*
   - **Expected gap:** an attached **custom** toolpack is still absent from this answer. That is #306, not a regression here — this ticket restores the built-in list only.
3. Prompt a chart over an entity → still works (it did before; this pins that the fix didn't regress tool availability).
4. On a station with **only** `data_query` enabled, ask **"can you make me a chart?"** → the agent does not claim charting. This is #284's invariant working again: guidance is emitted per effective pack.
5. On an org whose plan excludes a configured pack, confirm the agent still distinguishes "your plan doesn't include this" from "this station doesn't have it" (the `unentitledToolPacks` copy, unchanged here).

## Out of scope

- **Custom packs in the inventory** — #306. This ticket restores the built-in list; #306 adds custom packs and collapses the derivation into `resolveStationPacks`.
- **Auditing other `as any` reads against repository rows.** Worth doing (the issue notes it), but a codebase-wide cast audit is its own chore ticket, not a rider on a one-file fix.
- **A test harness for `portal-events.router.ts`.** Still none; the pin sits on the exported `buildStationContext`, which is where the defect actually lives. Adding router-level SSE integration coverage is separate work.
