# Pinning refactor: pin any durable block, live data — Plan

**TDD-sequenced implementation of the widened pinnable contract, pin-time materialization with persist-back refresh, the pin-addressed refresh route, and the live-data pinned detail view.**

Spec: `docs/PINNING_REFACTOR.spec.md`. Discovery: `docs/PINNING_REFACTOR.discovery.md`. Issue: #312. Builds on **shipped #270/#280** (durable `pipeline` descriptor + widget-refresh path) and **#283** (widget chrome/freshness) — all on `main`. Coordination seam with in-flight #84: only the `PINNED_CONTENT_SCHEMAS` registry (geo entry arrives with #84).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/pinning-refactor`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — contract first, server materialization before server refresh (refresh persists back what materialization defines), web plumbing before web surfaces:

- **Slice 1** — the widened contract + migration; flips GATE_VIZ_PINNING's derivation pins deliberately (the rejection regression case moves to a still-unpinnable type).
- **Slice 2** — materialization service + pin route: the row becomes self-contained; d3/handle-backed pins land end-to-end.
- **Slice 3** — refresh service split + pin refresh route + persist-back (writes the shape slice 2 defined).
- **Slice 4** — web plumbing: `BlockRef` union, hook promotion, SDK endpoint. No visible behavior change yet.
- **Slice 5** — visible surfaces: pin affordance fix, detail-view live data + hardening, list icons.
- **Slice 6** — SDK-bypass cleanup + doc-sync (a stale-doc bug is a bug in this PR).

---

## Slice 1 — Widened contract, `snapshotUpdatedAt`, migration

Core enum + row field + snapshot cap constant; DB enum values + column; dual-schema checks; the deliberate GATE_VIZ_PINNING flip.

**Files**

- Edit: `packages/core/src/models/portal-result.model.ts` — enum `["text","data-table","d3","geo"]`; `snapshotUpdatedAt: z.number().int().nullable()`.
- Edit: `packages/core/src/constants/large-data-ops.constants.ts` — `PIN_SNAPSHOT_ROW_CAP = TABLE_DISPLAY_ROW_LIMIT`.
- New: `packages/core/src/contracts/pinned-result.contract.ts` — `PinnedDataTableContentSchema`, `PinnedD3ContentSchema`, `PINNED_CONTENT_SCHEMAS` (no `geo` entry), `PinRefreshResponseSchema`; barrel export.
- Edit: `apps/api/src/db/schema/portal-results.table.ts` — enum values + `snapshot_updated_at`; `zod.ts` + `type-checks.ts` re-derive.
- New migration: `npm run db:generate -- --name widen-portal-result-type-live-pins`.
- Edit tests: `packages/core/src/__tests__/contracts/portal.contract.test.ts`, `models/portal-result.model.test.ts`; new `contracts/pinned-result.contract.test.ts`; **edit** `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts` — the d3-rejection regression case becomes a `bulk-job-progress`-rejection case (still asserting `PORTAL_RESULT_TYPE_NOT_PINNABLE`); d3 *acceptance* waits for slice 2.

**Steps**

1. **Tests (spec core cases, ≈8).** Enum membership; `PINNABLE_BLOCK_TYPES` contains `d3`/`geo`; `snapshotUpdatedAt` nullable parse; schema registry accepts/rejects per spec; `PinRefreshResponseSchema` ≡ `WidgetRefreshResponseSchema`; flipped integration rejection case. Run; fail.
2. **Implement** the core edits, table edits, regenerate zod/type-checks, generate + apply the migration. Green.
3. Lint + type-check (monorepo — the dual-schema check is the real gate here).

**Done when:** core suite + the flipped integration case pass; pin route still copies verbatim (materialization is slice 2) but accepts `d3` without asserting its stored shape yet.

**Risk:** PG enum `ADD VALUE` is one-way — confirm the generated migration matches the `drizzle/0027`/`0028` precedent shape before applying.

---

## Slice 2 — Materialization service + pin route

The pin route stops copying verbatim: per-type validation, snapshot hydration ≤ cap, pipeline derivation, expired-handle handling, `PORTAL_RESULT_CONTENT_EXPIRED`.

**Files**

- New: `apps/api/src/services/portal-result-pin.service.ts` — `PortalResultPinService.materialize(type, blockContent, scope, deps?)` per spec.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `PORTAL_RESULT_CONTENT_EXPIRED` (+ message).
- Edit: `apps/api/src/routes/portal-results.router.ts` — pin route calls `materialize`, persists `content` + `snapshotUpdatedAt`; `@openapi` request/response refs updated (`swagger.config.ts` components).
- New: `apps/api/src/__tests__/services/portal-result-pin.service.test.ts`; extend the portal-results integration suite.

**Steps**

1. **Unit tests (spec materialize cases, ≈9).** text pass-through; inline table/d3 as-is; handle-backed hydrates ≤ `PIN_SNAPSHOT_ROW_CAP` with `truncated`; pipeline derived from envelope `sql`, not from `sql: null`; expired handle + pipeline → re-execute; expired + no pipeline → `PORTAL_RESULT_CONTENT_EXPIRED`; unregistered type → `PORTAL_RESULT_TYPE_NOT_PINNABLE`. DI seam fakes the handle reader + `resolveSqlDelivery`. Run; fail.
2. **Implement** the service (pure orchestration over the two injected deps), wire the route, add the ApiCode + swagger component. Green.
3. **Integration tests (≈3).** Pin a `d3` block end-to-end (stored shape = `PinnedD3ContentSchema`, `snapshotUpdatedAt` set); pin a handle-backed table (rows + pipeline stored); progress-block rejection unchanged. Green.
4. Lint + type-check.

**Done when:** a d3/handle-backed pin persists a validated, self-contained snapshot; nothing reads `snapshotUpdatedAt` yet.

**Risk:** the handle snapshot reader's exact paging surface — reuse the same service `sdk.portalSql.handleSnapshot` hits server-side; if its signature resists a 5 000-row read, cap at its page size in a loop (implementation detail, contract unchanged).

---

## Slice 3 — Refresh service split + pin refresh route + persist-back

`PortalVizRefreshService` gains the shared `executePipeline` core and `refreshPinnedResult`; the new route mounts with the shared rate-limit block.

**Files**

- Edit: `apps/api/src/services/portal-viz-refresh.service.ts` — extract `executePipeline`; add `refreshPinnedResult` (org gate → 404 `PORTAL_RESULT_NOT_FOUND`; no pipeline → 422 `VIZ_WIDGET_NOT_REFRESHABLE`; persist-back rows/`rowCount`/`truncated`/`snapshotUpdatedAt`; persist-back failure logged, response still 200).
- Edit: `apps/api/src/routes/portal-results.router.ts` — `POST /:id/refresh` with the `viz-refresh:<orgId>` rate window verbatim from `portal-sql-handle.router.ts:188-205`; `@openapi` reusing the `WidgetRefreshResponse` component.
- Extend: `apps/api/src/__tests__/services/portal-viz-refresh.service.test.ts`; portal-results integration suite.

**Steps**

1. **Unit tests (spec refresh cases, ≈7).** Happy inline + handle deliveries; cross-org → 404; pipeline-less pin → 422; persist-back writes the row; persist-back failure still returns the delivery; existing message-block `refresh` behavior regression-pinned unchanged. Run; fail.
2. **Implement** the split + the pin addresser. Green.
3. **Integration tests (≈4).** `POST /:id/refresh` happy / 404 (foreign org) / 422 / 429 (window exhausted via seeded Redis counter). Green.
4. Lint + type-check.

**Done when:** a pinned d3/table refreshes server-side and its row updates; no web caller exists yet.

**Risk:** keep `refresh` (message path) byte-identical — the extraction must not change its 404/422 semantics (the regression-pin case guards this).

---

## Slice 4 — Web plumbing: `BlockRef` union, hook promotion, SDK endpoint

Type-level rewire with no visible behavior change: every current producer becomes `kind: "message"`.

**Files**

- Edit: `packages/core/src/ui/ContentBlockRenderer.tsx` — `BlockRef` union per spec.
- Move: `apps/web/src/modules/D3Widget/utils/use-widget-refresh.util.ts` → `apps/web/src/utils/use-widget-refresh.util.ts` — `WidgetRef` → `BlockRef`; freshness keys `message:<id>:<idx>` / `pin:<id>`; per-kind dispatch. D3Widget imports update; no re-export shim (`feedback_no_compat_aliases`).
- Edit: `apps/web/src/api/portal-results.api.ts` — `refresh` mutation (id-in-variables, no body).
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — passes `kind: "message"` (affordance fix waits for slice 5).
- New: `apps/web/src/__tests__/use-widget-refresh.util.test.ts`; existing D3Widget/PortalMessage suites updated for the union.

**Steps**

1. **Tests (spec hook cases, ≈4).** Key discrimination (two refs never collide); message-branch dispatches to `sdk.portalSql.widgetRefresh`; pin-branch to `sdk.portalResults.refresh`; failure → keep-last-data semantics preserved (regression). Run; fail.
2. **Implement** the union + move + endpoint. Green — including every pre-existing D3Widget test.
3. Lint + type-check.

**Done when:** repo compiles with the union everywhere; chat widgets behave exactly as before; pin refs exist but nothing constructs one yet.

**Risk:** the move is the churn point — TypeScript finds every consumer, but watch test-file `jest.unstable_mockModule` paths that name the old module location.

---

## Slice 5 — Visible surfaces: affordance, live detail view, hardening

The user-facing payoff: pin anything durable in chat; the detail view goes live.

**Files**

- Edit: `apps/web/src/components/PortalMessage.component.tsx` — pin affordance renders for every pinnable type incl. web-rendered + handle-backed blocks (`shouldRenderViaWeb` no longer short-circuits it).
- Edit: `apps/web/src/views/PinnedResultDetail.view.tsx` — pin `blockRef` + `dataUpdatedAt = snapshotUpdatedAt ?? created`; data-table live path via the promoted hook (fresh-over-stored rows, refresh control, truncated note, failure notice); type-chip map; tombstoned-portal handling; legacy expired-data notice; `onSuccess` invalidates `queryKeys.portalResults.get(id)`.
- Edit: `apps/web/src/components/PinnedResultsList.component.tsx` — `d3`/`geo` icon entries.
- Extend: `PortalMessage.test.tsx`, `PinnedResultDetail.test.tsx`, `PinnedResultsList.test.tsx`.

**Steps**

1. **Tests (spec view cases, ≈10).** Affordance on d3 + handle-backed table; detail: pin-ref threading, auto-refresh when stale, manual refresh, failure keeps stored rows + notice, truncated note, tombstone link handling, legacy notice, chip map, invalidation spy (via the test-utils `queryClient`). Run; fail.
2. **Implement**. Green.
3. Lint + type-check.

**Done when:** the #312 acceptance walkthrough works in the app: pin a d3 widget, open it in pinned results, watch it auto-refresh; break the source and see stored rows + notice.

**Risk:** none structural — the heavy lifting landed in slices 2–4.

---

## Slice 6 — SDK-bypass cleanup + doc-sync

**Files**

- Edit: `apps/web/src/views/Dashboard.view.tsx`, `apps/web/src/views/PinnedResultsListView.view.tsx` — unpin via `sdk.portalResults.remove()` + house toast pattern; raw `fetchWithAuth` deleted.
- Edit: `docs/GATE_VIZ_PINNING.md` — superseded-by-#312 note (its tests were deliberately flipped in slices 1–2).
- Edit: `apps/web/src/utils/glossary.util.ts` / `faq.util.ts` — pin copy, if it states the old "visualizations can't be pinned" rule (check both).
- Extend: `PinnedResultsListView.test.tsx`, `Dashboard`-adjacent suite (spec cleanup cases, ≈2).

**Steps**

1. **Tests.** Both views unpin through the SDK (spy) and raise `toast.error` on failure. Run; fail.
2. **Implement**; sweep the doc surfaces (CLAUDE.md needs no change — pinning isn't a documented convention there). Green.
3. Full-monorepo `npm run lint && npm run type-check && npm run test`.

**Done when:** no raw `fetchWithAuth` for portal-results remains; docs match shipped behavior.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Widened enum + `snapshotUpdatedAt` + migration + flipped pins | core suite + dual-schema type-check |
| 2 | Materializing pin route + `PORTAL_RESULT_CONTENT_EXPIRED` | pin unit + integration cases |
| 3 | Pin refresh route + persist-back | refresh unit + integration cases |
| 4 | `BlockRef` union + promoted hook + SDK endpoint | hook tests + zero D3Widget regressions |
| 5 | Affordance + live detail view + hardening | view suites; manual walkthrough possible |
| 6 | SDK cleanup + doc-sync | full monorepo green |

## Cross-slice notes

- **Migration ordering:** slice 1's migration must be applied before slice 2's integration tests run (`npm run db:migrate` in the dev/test DB).
- **Transitional window (slices 1→2):** the route accepts `d3` pins as verbatim copies until materialization lands — fine inside one PR; no test asserts the stored shape until slice 2.
- **#84 seam:** only `PINNED_CONTENT_SCHEMAS` (slice 1). If #84 merges first, its geo entry is added there; if #312 merges first, #84 adds it in its own branch. Neither blocks the other.
- **Doc-sync inventory (slice 6):** `GATE_VIZ_PINNING.md`, glossary/FAQ; `PIN_DIALOG_ERRORS.md`/`UNPIN_SDK_BYPASS.md` stay accurate (the dialog contract and the id-in-variables shape are unchanged; the bypass doc's "remaining bypasses" note is resolved by slice 6 — add a one-line closure note).
- **Spec case totals:** ≈44 across slices (8 + 12 + 11 + 4 + 10 + 2), matching the spec's test plan.

## Next step

Implementation begins on `feat/pinning-refactor` — slice 1, tests-first, one commit per slice — once you confirm discovery + spec + plan.
