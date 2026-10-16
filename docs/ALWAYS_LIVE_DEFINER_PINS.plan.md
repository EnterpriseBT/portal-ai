# Always-live definer's-rights pins — Plan

**This plan turns data pins into recipes with a definer, test-first. The new pieces are added alongside the old ones first: definer, handles, data route, tiles, web. One cutover slice then removes the stored rows, the refresh route and the snapshot column.**

Spec: `docs/ALWAYS_LIVE_DEFINER_PINS.spec.md`. Discovery: `docs/ALWAYS_LIVE_DEFINER_PINS.discovery.md`. Issue: #640 (epic #578). It builds on #599's `resolveViewsForSession`, #660's reader-role session, #621 sharing and #643 tile scoping, all shipped.

There are 7 slices. Each one sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/640-always-live-definer-pins`**: one feature, one PR (#819).

Run tests from each package (never invoke jest directly):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Do a focused run.
4. At the boundary, run `npm run build && npm run lint && npm run type-check` from the root. A core model change reaches web/site fixtures, so per-package checks miss it.
5. Move to the next slice.

**One deliberate refinement of the spec:** the migration splits in two. **0124** adds the definer columns in slice 1, because slices 2–5 need them. **0125** strips content and drops `snapshot_updated_at` at the cutover (slice 6). Doing everything in one migration up front would break the refresh route, materialize and the web in the same commit. Slice 1 also updates the spec's Migration section to match.

Sequencing rationale:
- **S1, definer + hardening.** Purely additive. Every later slice reads `definerPrincipalId` or calls `assertDefinerActive`.
- **S2, pin-owned handles.** S3's large results need them, so they must exist before the data route can return one.
- **S3, data route.** The new read path, which works alongside the old refresh until the web switches over.
- **S4, tiles/dissolve under the definer.** Server-only; independent of the web.
- **S5, web switches to the data route.** After S3/S4, so every state it renders is already produced by the server.
- **S6, cutover.** Once nothing reads rows or calls refresh, removing them is a pure deletion plus migration 0125.
- **S7, docs.** Last, describing shipped behavior.

---

## Slice 1 — Definer columns, `PinDefinerService`, `removeMember` hardening

Pins get a first-class definer, backfilled from `created_by`. A service resolves the definer and checks their membership, and GET/list return the definer. Removing a member now drops that user's direct policy attachments.

**Files**

- Edit:
  - `packages/core/src/models/portal-result.model.ts`: add `PinDefinerPrincipalTypeSchema`, `definerPrincipalType` and `definerPrincipalId`. `snapshotUpdatedAt` stays for now.
  - `packages/core/src/contracts/portal.contract.ts`: add `definer` + `viewerIsDefiner` to the GET payload and list item.
  - `apps/api/src/db/schema/portal-results.table.ts`: the two columns + `portal_results_definer_idx`.
  - `zod.ts`, `type-checks.ts`.
  - `apps/api/drizzle/0124_pin-definer-columns.sql` + `meta/_journal.json` + `meta/0124_snapshot.json` (`npm run db:generate -- --name pin-definer-columns`). Hand-order it: add nullable → backfill `= created_by` → `SET NOT NULL` → index.
  - `routes/portal-results.router.ts`: create sets the definer; GET/list attach `describe` / `describeMany`.
  - `services/seat.service.ts`: `softDeleteByPrincipal("user", …)` in `removeMember`.
  - `config/swagger.config.ts`: the payload component.
  - `docs/ALWAYS_LIVE_DEFINER_PINS.spec.md`: the Migration section becomes 0124 + 0125.
  - Fixtures in core/web/site tests that build a `PortalResult`: add the two fields.
- New:
  - `apps/api/src/services/pin-definer.service.ts`.
  - `apps/api/src/__tests__/services/pin-definer.service.test.ts`.
  - `apps/api/src/__integration__/db/migrations/0124-pin-definer-columns.integration.test.ts`.

**Steps**

1. **Write the tests first.** Each is listed with the number of spec cases it covers:
   - core model: definer required (2);
   - `pin-definer.service.test.ts`, all 7 cases;
   - `seat.service.integration.test.ts`: user attachment soft-deleted, then `loadSet` is empty (2);
   - `portal-results.router.integration.test.ts`: create sets the definer; GET/list carry `definer` + `viewerIsDefiner` (3);
   - 0124 migration test: backfill equals `created_by`, NOT NULL, no row skipped (2).
   
   Run them; they fail.
2. **Implement:** the migration, the model, the service, the router wiring and the `removeMember` line. Green.
3. Root build + lint + type-check.

**Done when:** every pin row has a non-null definer equal to its creator. GET/list return `definer` and `viewerIsDefiner`. A removed member's user-principal attachments are tombstoned. No execution path uses the definer yet.

**Risk:** typed `PortalResult` fixtures in web/site break on the new required fields. The root build catches it.

---

## Slice 2 — Pin-owned query handles

A handle can belong to a pin. Every read re-checks pin read for the caller and the definer's membership.

**Files**

- Edit:
  - `services/portal-sql-handle.service.ts`: `ProduceOptions.portalResultId?` and `StoredHandleMeta._portalResultId?`, written in `stage()` beside `_userId`.
  - `tools/result-sink.ts`: `ResultSinkContext.portalResultId?`, forwarded to `produce`.
  - `routes/portal-sql-handle.router.ts`: the pin-owned branch of the owner check (`:103`) on every `getMeta` read route.
  - `constants/api-codes.constants.ts`: add `PORTAL_RESULT_DEFINER_ACCESS_LOST` and `PORTAL_RESULT_DATA_UNAVAILABLE`, plus their recommendations.
- Tests: `__tests__/services/portal-sql-handle.service.test.ts`, `__tests__/routes/portal-sql-handle.router.test.ts`.

**Steps**

1. **Tests:**
   - the 5 handle-router cases: a non-definer reader can read; unshare → 404; definer removed → a 422 code that depends on the caller; cross-org → 404; a user handle keeps the old rule;
   - `stage` persists `_portalResultId` (1).
   
   Fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** a pin-owned handle behaves as specified, and user-owned handles are unchanged. Nothing produces pin-owned handles yet. They're exercised through `produce` directly.

**Risk:** a `getMeta` read route left on the old check. Mitigation: grep every `getMeta` call site in the router, and test each route path.

---

## Slice 3 — `executePin` + `GET /api/portal-results/:id/data`

This is the always-live read path. It runs as the definer, persists nothing, and maps access loss to the caller-dependent codes.

**Files**

- Edit:
  - `services/portal-viz-refresh.service.ts`: `executePin`, plus `handleOwner` threaded through `runPipeline`/`executePipeline`. `refreshPinnedResult` stays for now.
  - `routes/portal-results.router.ts`: `GET /:id/data`, with the rate window (shared helper extracted from refresh), the read check and `setDbCancelPolicy("always")`.
  - `api-codes.constants.ts`: add `PORTAL_RESULT_NOT_REEXECUTABLE`.
  - `packages/core/src/contracts/pinned-result.contract.ts`: add `PinDataResponseSchema` (the old name stays until S6).
  - `config/swagger.config.ts`: the `PinDataResponse` component + `@openapi` block.
  - `__tests__/config/route-authorization.map.ts`: the new GET.
- New: `__integration__/routes/portal-pin-data.integration.test.ts`.
- Tests: `__tests__/services/portal-viz-refresh.service.test.ts`.

**Steps**

1. **Tests:**
   - the 8 `executePin` unit cases;
   - the 8 data-route integration cases: sharee sees the definer's rows and columns; a narrowed filter shows on the next call; removing the definer → DATA_UNAVAILABLE / ACCESS_LOST; zero rows → 200; org B → 404; 429; a large result returns a pin-owned handle that the sharee can page.
   
   Fail.
2. **Implement.** Green.
3. Lint + type-check, plus the route-authorization guard.

**Done when:** a read-only sharee receives the definer's live data from `/data`, and revocation empties it. Refresh still works, and the web still uses it.

**Risk:** the integration fixture needs two members with different curated views on one station. Reuse the #599/#643 view-scoping fixtures rather than building new ones.

---

## Slice 4 — Map tiles, dissolve and layer count under the definer

**Files**

- Edit:
  - `services/portal-map-tile.service.ts`:
    - `resolvePipeline` returns `executeAs`;
    - `renderTile` and its callees use it;
    - add `countLayer` with a Redis cache keyed by `(owner, scopeHash)` and a 60 s TTL;
    - delete `layerCountFromContent`.
  - `services/dissolve-precompute.service.ts`: `reenqueueAllDissolvable` selects `definer_principal_id`.
  - `routes/portal-results.router.ts`: the create and refresh dissolve enqueues pass the definer.
- Tests:
  - `__tests__/services/portal-map-tile.service.test.ts`;
  - `__integration__/routes/portal-map.router.integration.test.ts`;
  - `__integration__/queues/dissolve-precompute.processor.integration.test.ts`.

**Steps**

1. **Tests:**
   - the 6 tile unit cases (the ETag case waits until S6, since `snapshotUpdatedAt` still exists);
   - integration: two viewers get identical pin tiles; a revoked definer → 422 (2);
   - dissolve under the definer's scopeHash (2).
   
   Fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** every viewer of a pinned map gets the definer's tiles and shares one dissolve scope. Message-block tiles are unchanged.

**Risk:** a cold `countLayer` adds a COUNT under `statement_timeout` to the first tile. Keep it inside the existing `AdmissionGate` run.

---

## Slice 5 — Web: data query, states, caption, Pin gate, map notice

**Files**

- Edit:
  - `apps/web/src/api/portal-results.api.ts`: add `data(id)` (`refresh` stays until S6).
  - `api/keys.ts`: `portalResults.data(id)`.
  - `utils/use-widget-refresh.util.ts`: the pin branch reads the query.
  - `packages/core/src/ui/ContentBlockRenderer.tsx`: drop `canRefresh` from the pin `BlockRef`.
  - `views/PinnedResultDetail.view.tsx`: the three Alerts and the caption.
  - `components/PinnedResultsList.component.tsx` and the list views: the caption.
  - `components/PortalMessage.component.tsx`: the `disable` gate and the 422 toast.
  - `modules/MapWidget/MapWidget.component.tsx`: the `unavailable` tile status.
- Tests:
  - `use-widget-refresh.util.test.ts` (5);
  - `PinnedResultDetail.test.tsx` (7);
  - `PinnedResultsList.test.tsx` (2);
  - the PortalMessage test (3);
  - `MapWidget.test.tsx` (1);
  - `portal-results.api.test.ts` + `cache-invalidation.test.tsx` (2).

**Steps**

1. **Tests:** the 20 web cases. Fail.
2. **Implement.** Green.
3. Root build + lint + type-check.

**Done when:** the web reads pin data only from `/data`. Nothing in `apps/web` calls `refresh` for a pin or reads `content.rows` of a pin.

**Risk:** the effect-mutation guard. The pin branch must be a `useAuthQuery`, never a mutation fired from an effect.

---

## Slice 6 — Cutover: strip stored data, remove refresh, refuse static pins

This slice removes the old path: the stored rows, the refresh route and the snapshot column.

**Files**

- Edit:
  - `packages/core/src/contracts/pinned-result.contract.ts`: rows-free schemas with a required `pipeline`; export `D3BaseContentSchema` / `GeoBaseContentSchema`; remove `PinRefreshResponseSchema`.
  - `portal-result.model.ts`: remove `snapshotUpdatedAt`.
  - `portal-results.table.ts`, `zod.ts`, `type-checks.ts`.
  - `apps/api/drizzle/0125_strip-pin-snapshots.sql` + meta: strip the content keys on data types (including soft-deleted rows), and `DROP COLUMN snapshot_updated_at` with `-- destructive-ok`.
  - `services/portal-result-pin.service.ts`: no rows; a meta failure means no pipeline.
  - `routes/portal-results.router.ts`: create refuses with `NOT_REEXECUTABLE`; delete `POST /:id/refresh` and its `@openapi`.
  - `portal-viz-refresh.service.ts`: delete `refreshPinnedResult` and the write-back.
  - `portal-map-tile.service.ts`: the ETag drops `snapshotUpdatedAt`.
  - `route-authorization.map.ts`: remove refresh.
  - Web: remove `sdk.portalResults.refresh`, `isSnapshotless` and the expired notice, and every `snapshotUpdatedAt` reference.
  - Update the 42 `snapshotUpdatedAt` test references (spec list).
- New: `__integration__/db/migrations/0125-strip-pin-snapshots.integration.test.ts`.

**Steps**

1. **Tests:**
   - core contract (6);
   - materialize (4);
   - create refuses a static block, `POST /:id/refresh` → 404 (2);
   - the ETag case (1);
   - 0125 migration: data rows, legacy `queryHandle`, text untouched, soft-deleted stripped (4).
   
   Fail.
2. **Implement.** Then `grep -rn "snapshotUpdatedAt\|refreshPinnedResult\|PinRefreshResponse" apps packages` must return nothing. Green.
3. Root build + lint + type-check, plus `npm run lint:migrations`.

**Done when:** no data-type `portal_results` row holds rows, counts or `queryHandle`. The refresh route is gone. A static block can't be pinned. The whole API, core and web suites are green.

**Risk:** this is the largest slice and the only destructive one. Keep it to deletions plus the migration; any new behavior belongs in S1–S5.

---

## Slice 7 — Help / FAQ copy

**Files**

- Edit: `packages/core/src/content/faq.util.ts` ("What do people see when I share a pin?") and `glossary.util.ts` (the "Pin" definition). The marketing site renders these too.
- Tests: `faq.util.test.ts`, `glossary.util.test.ts`.

**Steps:** update the pinned tests, then the copy. Green. Lint + type-check.

**Done when:** Help describes live, definer's-rights pins and what a revoked pin shows.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Definer columns (0124), `PinDefinerService`, `removeMember` hardening, definer on GET/list | migration + service + seat tests; root build |
| 2 | Pin-owned handles | handle router tests |
| 3 | `GET /:id/data` (`executePin`) | data-route integration (sharee/revocation/org B) |
| 4 | Tiles/dissolve/count under the definer | tile + dissolve integration |
| 5 | Web data query, states, caption, Pin gate | web suites; no pin `refresh`/`rows` reads |
| 6 | Cutover: 0125 strip + drop, refresh removed, static pins refused | 0125 migration test; `lint:migrations`; grep clean |
| 7 | Help/FAQ copy | content pin tests |

## Cross-slice notes

- **Migrations:** commit each `.sql` with its `_journal.json` and `<n>_snapshot.json`. `npm run dev` doesn't migrate, so run `npm run db:migrate` locally after S1 and after S6.
- **Rebasing:** if `main` lands a migration numbered 0124 or 0125 first, regenerate rather than renumber by hand.
- **Cache invalidation:** `portalResults.data(id)` sits under `portalResults.root`, so the existing pin delete/rename/share invalidations cover it. No new invalidation calls are needed.
- **Authorization map:** S3 adds and S6 removes a route; the guard fails on any mismatch.
- **Docs-sync:** S7 covers Help/FAQ. The tool descriptions, `system.prompt.ts`, READMEs and `CLAUDE.md` describe nothing about pin storage or refresh, so none of them change. Re-check at S6 with `grep -rn "refresh" docs/*.md apps/*/README.md`.
- **Local smoke:** walking the revocation steps needs two identities. The e2e member fixture can't read entities (memory: e2e member fixture limits), so the smoke will use an admin definer and a member sharee.

## Next step

Once you confirm the plan, implementation starts on this branch with slice 1, tests first, one commit per slice.
