# Message-block polygon-map precompute — Plan

**Three TDD slices that give message-block polygon maps the pin-grade never-drop serve: generalize the precompute key to message owners first, then enqueue eagerly at message-create, then age-only retention.**

Spec: `docs/MESSAGE_MAP_PRECOMPUTE.spec.md`. Discovery: `docs/MESSAGE_MAP_PRECOMPUTE.discovery.md`. Issue: #542. Builds on #541 (bounded per-band snap+union precompute, count-driven serve, never-blank fallback) — all reused unchanged once the key is generalized.

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/message-map-precompute`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **Slice 1** generalizes the key end-to-end (schema + metadata + processor + serve) so a message-owned precompute can exist and be served; it's the foundation the other two build on and is testable on its own (insert a message-owned coverage → serve it; run a message-owner job). **Slice 2** wires the eager enqueue, depending on slice 1's processor handling message owners. **Slice 3** adds age-only retention, depending on slice 1's `message_id` column (FK cascade already covers deletion). No forward deps.

---

## Slice 1 — Generalize the precompute key to message owners

The schema, job metadata, processor, and serve all key on **either** a pin **or** a `(messageId, blockIndex)` message owner, so a message tile ref serves precomputed coverage (and the #541 fallback) exactly like a pin.

**Files**

- Edit: `apps/api/src/db/schema/map-dissolve-geometries.table.ts` — `portalResultId` nullable; add `messageId` (FK `portalMessages.id` `onDelete:"cascade"`) + `blockIndex`; add `message_lookup` index. (import `portalMessages`)
- New: `apps/api/drizzle/00XX_generalize_dissolve_ownership.sql` — the column/FK/index changes + **hand-added CHECK** (exactly-one-owner).
- Edit: `packages/core/src/models/job.model.ts` — `DissolvePrecomputeMetadataSchema` carries either owner + refine.
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts` — read content from a message block when the job is message-owned; lock on `message:<id>:<blockIndex>`; write rows with the owner columns.
- Edit: `apps/api/src/services/portal-map-tile.service.ts` — `renderTile` passes the message owner; `runDissolveTile`/`hasDissolvePrecompute` key on the owner; `dissolveReady` needs "an owner present", not `portalResultId != null`. Bump `AGG_TILE_VERSION` (message tiles change bytes).

**Steps**

1. **Tests (spec: unit metadata + Slice-1 integration + FK cascade).** core `job.model.test.ts`: metadata accepts a pin owner and a message owner, rejects both-set/neither-set (2). `dissolve-precompute.processor.integration.test.ts`: a message-owner job writes individuals + merged rows keyed by `(message_id, block_index)`; recompute replaces; two blocks of one message dissolve independently (3); deleting the `portal_messages` row cascade-removes its coverage (1). `portal-map.router.integration.test.ts`: a message tile ref over-cap → merged coverage (`aggregated`); coverage absent → area-ranked individuals (never blank); under-cap → individuals (3). Run; fail.
2. **Implement** the schema+migration+CHECK, metadata generalization, processor owner-read + lock, owner-keyed serve. Green.
3. Lint + type-check.

**Done when:** a message-owned coverage (inserted or via a message-owner job) serves through the message tile route with the same never-drop behavior as a pin; the CHECK rejects a bad owner combination; a deleted message's coverage cascades away.

**Risk:** the CHECK is hand-added (drizzle-kit won't generate it) — verify it's in the migration + satisfied by existing pin rows. The FK cascade must not touch pin rows (message_id null there).

---

## Slice 2 — Eager, size-gated enqueue at message-create

A `visualize_map` polygon block over the fast-path cap enqueues a message-owned precompute when the message is persisted.

**Files**

- Edit: `apps/api/src/services/dissolve-precompute.service.ts` — `enqueueForMessageBlock({ messageId, blockIndex, organizationId, userId, content })`: guard `isDissolvable` + `layerCountFromContent(content).matchedCount > MAP_TILE_FEATURE_CAP`; enqueue with message metadata; best-effort.
- Edit: `apps/api/src/services/portal.service.ts` — at the `repo.portalMessages.create` sites, call `enqueueForMessageBlock` per qualifying geo polygon block.

**Steps**

1. **Tests (spec: unit enqueue).** `dissolve-precompute.service.test.ts`: `enqueueForMessageBlock` enqueues for an over-cap polygon block; skips under-cap, non-polygon, non-geo; metadata carries `messageId`+`blockIndex` (3). (Spy `JobsService.create` — no DB/queue.) Run; fail.
2. **Implement** `enqueueForMessageBlock` + the message-create hook. Green.
3. Lint + type-check.

**Done when:** creating a message with an over-cap geo polygon block enqueues exactly one message-owned `dissolve_precompute`; a small or non-polygon block enqueues nothing.

**Risk:** the hook must fire for every qualifying block in the message (a message may hold multiple map blocks) and must never fail message creation (best-effort, like `enqueueForPin`).

---

## Slice 3 — Age-only retention purge

A maintenance-queue purge deletes message-owned coverage older than the retention window; deletion cleanup is already free via slice 1's FK cascade.

**Files**

- New: `apps/api/src/queues/processors/message-dissolve-retention-purge.processor.ts` — batched drain-delete of `map_dissolve_geometries` rows where `message_id IS NOT NULL` and the owning message's `created` is older than the env-configured window (default 30d); typed run summary.
- Edit: `apps/api/src/queues/maintenance.queue.ts` + `maintenance.worker.ts` — register the daily scheduler + processor.

**Steps**

1. **Tests (spec: retention integration).** integration: the purge deletes message-owned coverage past the window, leaves in-window message coverage AND all pin-owned rows untouched; the run summary reports the deleted count (1). Run; fail.
2. **Implement** the purge processor + registration (pattern: `entity-record-retention-purge.processor.ts`). Green.
3. Lint + type-check.

**Done when:** message-owned coverage past the window is purged on the maintenance schedule; pins and in-window message coverage are never touched; the run appears in `GET /api/admin/maintenance`.

**Risk:** the purge predicate must scope strictly to `message_id IS NOT NULL` (never a pin row) and join `portal_messages.created` for the window.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | owner-generalized key (schema + metadata + processor + serve) | message tile ref serves coverage + #541 fallback; CHECK + FK cascade hold |
| 2 | eager size-gated `enqueueForMessageBlock` at message-create | over-cap polygon block enqueues one message-owned job; small/non-polygon skip |
| 3 | age-only message-coverage retention purge | past-window message coverage purged; pins + in-window untouched |

## Cross-slice notes

- **Migration + CHECK ordering:** drizzle-kit generates the columns/FK/index; the CHECK is hand-added to the same migration. No backfill (existing pin rows satisfy it). Apply to dev + test DBs before the integration tests.
- **`AGG_TILE_VERSION` bump once (slice 1):** message polygon tiles change from the raw clip to coverage, so cached message tiles must refresh.
- **`@portalai/core` rebuild:** the metadata schema (slice 1) lives in core — rebuild dist so the API picks it up.
- **Doc sync (`CLAUDE.md` → "Keeping Documentation in Sync"):** update the `map-dissolve-geometries.table.ts` "Keyed by the pin" docstring, the `dissolve-precompute.service.ts` header (pin-only → pin-or-message), and any tile-serve comment that says a message ref can't be dissolve-ready. No user-facing/tool/help copy is affected.
- **Reuse, don't re-derive #541:** the bounded per-band snap+union and the count-driven fallback are unchanged — slice 1 only widens the key they read/write.

## Next step

Implementation begins on `feat/message-map-precompute`, Slice 1 first (tests-first, one commit per slice), only after discovery + spec + plan are confirmed.
