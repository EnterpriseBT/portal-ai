# Message-block polygon-map precompute — Spec

Pins the contract for giving un-pinned **message-block** polygon maps the same precompute-backed never-drop serve pins get (#532/#541), by generalizing the pin-only precompute key to also key on `(messageId, blockIndex)`. Builds on `docs/MESSAGE_MAP_PRECOMPUTE.discovery.md`. Issue: [#542](https://github.com/EnterpriseBT/portal-ai/issues/542).

## Key decisions (from discovery, confirmed — with one refinement)

1. **Generalize the key** (D1-A): `map_dissolve_geometries.portal_result_id` becomes **nullable**; add nullable `message_id` + `block_index`; a CHECK enforces exactly-one-owner. The serve/processor key on whichever owner the tile ref carries. No synthetic "shadow pin" rows in the user-facing `portal_results`.
2. **Refinement to retention (supersedes discovery D3's "orphan purge"):** `message_id` gets a **FK to `portal_messages(id) ON DELETE CASCADE`**. Message deletion (`deleteByPortal`) then cleans message-owned coverage **for free**, exactly like a pin's cascade — so the maintenance purge is **age-only**, not orphan-cleanup. (The discovery assumed no cascade was possible; adding the FK is strictly better and removes the `deleteByPortal` hook it proposed.)
3. **Enqueue eagerly, size-gated** (D2-A): at `visualize_map` message-create, enqueue a precompute for a polygon block whose persisted count exceeds `MAP_TILE_FEATURE_CAP`. Lazy backstop deferred (Open Q2).
4. **Retention window ~30 days** (Open Q1): a maintenance purge deletes message-owned coverage older than the window; aged-out maps serve raw on re-view (pinning stays durable).
5. **Advisory lock** keys on `message:<id>:<blockIndex>` for a message owner (Open Q4).
6. **Reuse #541 wholesale** — bounded per-band snap+union, count-driven serve, never-blank fallback — unchanged once the key is generalized.

## Scope

### In scope
- Schema: generalize `map_dissolve_geometries` ownership (nullable `portal_result_id` + `message_id`/`block_index` + CHECK + FK cascade + index).
- Serve: a message tile ref serves precomputed coverage (`renderTile`/`runDissolveTile`/`hasDissolvePrecompute` key on the owner).
- Processor: read content from a message block; lock on the message key.
- Enqueue: `enqueueForMessageBlock` at message-create, size-gated.
- Retention: age-only maintenance purge (FK cascade handles deletion).

### Out of scope
- Points/lines message blocks (already count-driven raw, #532 slices 3–4).
- Lazy enqueue-on-serve backstop (Open Q2).
- Making messages mutable / per-message soft-delete.

## Surface

### `apps/api/src/db/schema/map-dissolve-geometries.table.ts`
- `portalResultId`: drop `.notNull()` → nullable (keep FK `portalResults.id` `onDelete:"cascade"`).
- New `messageId: text("message_id").references(() => portalMessages.id, { onDelete: "cascade" })` (nullable).
- New `blockIndex: integer("block_index")` (nullable).
- New index `map_dissolve_geometries_message_lookup_idx` on `(messageId, blockIndex, columnName, zoomBand, merged)` — the message serve lookup, mirroring the pin `lookup_idx`.
- drizzle-zod (`zod.ts`) + type-checks pick up the three column changes automatically.

### Migration — `npm run db:generate -- --name generalize_dissolve_ownership`
- `ALTER COLUMN portal_result_id DROP NOT NULL`; `ADD COLUMN message_id text`; `ADD COLUMN block_index integer`; FK `message_id → portal_messages(id) ON DELETE CASCADE`; the new index.
- **Hand-add the CHECK** (drizzle-kit doesn't model CHECK): `CHECK ((portal_result_id IS NOT NULL AND message_id IS NULL) OR (portal_result_id IS NULL AND message_id IS NOT NULL AND block_index IS NOT NULL))`. Existing pin rows satisfy it (portal_result_id set, message_id null). No backfill.

### `packages/core/src/models/job.model.ts` — `DissolvePrecomputeMetadataSchema` (`:542`)
Generalize to carry either owner:
```
z.object({
  organizationId: z.string(),
  portalResultId: z.string().optional(),
  messageId: z.string().optional(),
  blockIndex: z.number().int().nonnegative().optional(),
}).refine(exactly-one-owner: portalResultId XOR (messageId && blockIndex !== undefined))
```

### `apps/api/src/services/dissolve-precompute.service.ts`
- `enqueueForMessageBlock(params: { messageId; blockIndex; organizationId; userId; content })`: guard `isDissolvable("geo", content)` **and** `layerCountFromContent(content).matchedCount > MAP_TILE_FEATURE_CAP` (size gate; small layers serve raw fine); enqueue `dissolve_precompute` with the message metadata. Best-effort (swallow), same as `enqueueForPin`.
- `reenqueueAllDissolvable` (`:84`) unchanged (pins); message coverage is rebuilt via re-generation, not this op.

### `apps/api/src/queues/processors/dissolve-precompute.processor.ts`
- `runDissolve` takes the owner from `bullJob.data`: a pin → read content from `portal_results WHERE id` (today, `:88`); a message → read `portal_messages.blocks[blockIndex].content`. Everything downstream (individuals + bounded merged pass) is unchanged, writing rows with the owner columns set.
- Advisory lock (`:298`): `portalResultId` for a pin, `sql`message:${messageId}:${blockIndex}`` namespace for a message.
- Idempotency: per-owner delete-then-insert (the existing pattern), scoped by the owner columns.

### `apps/api/src/services/portal-map-tile.service.ts`
- `renderTile` (`:1041`): for a message ref, pass the message owner (not `null`) into the tile-query args so `dissolveReady` can be true.
- `runDissolveTile` / `hasDissolvePrecompute` (`:871`,`:835`): accept an **owner** (pin id OR `{messageId, blockIndex}`) and key the WHERE on it instead of `portal_result_id` only. The count-driven fallback (#541) is unchanged.
- `defaultRunTileQuery` `dissolveReady` (`:661`): a message owner is dissolve-ready when its coverage exists; drop the `portalResultId != null` requirement in favour of "an owner is present".

### `apps/api/src/services/portal.service.ts` — enqueue hook
At the `repo.portalMessages.create` sites (`:565`, `:779`), after a message with geo polygon block(s) is persisted, call `enqueueForMessageBlock` per qualifying block (size-gated).

### Retention — `apps/api/src/queues/processors/message-dissolve-retention-purge.processor.ts` (new)
A third `maintenance`-queue purge (pattern: `entity-record-retention-purge.processor.ts`): batched drain-delete of `map_dissolve_geometries` rows where `message_id IS NOT NULL` AND the owning message's `created` is older than the window (join `portal_messages`). Env-configured window (default 30d). Registered as a daily scheduler; run summary as the BullMQ return value (surfaces in `GET /api/admin/maintenance`). FK cascade already covers deletion, so this is age-only.

## Migration / Seed
Migration above. **No seed.** No backfill (existing pin rows satisfy the CHECK).

## TDD test plan

### `apps/api` unit
- `dissolve-precompute.service.test.ts`: `enqueueForMessageBlock` enqueues for an over-cap polygon block, skips under-cap / non-polygon / non-geo; metadata carries `messageId`+`blockIndex`. (3)
- `job.model` (core) `job.model.test.ts`: `DissolvePrecomputeMetadataSchema` accepts a pin owner and a message owner, rejects both-set / neither-set. (2)

### `apps/api` integration
- `dissolve-precompute.processor.integration.test.ts`: a **message-owner** job reads the block's pipeline and writes individuals + merged rows keyed by `(message_id, block_index)`; recompute replaces; two blocks of one message dissolve independently. (3)
- `portal-map.router.integration.test.ts`: a **message tile ref** over-cap serves merged coverage (`aggregated`); with coverage absent → area-ranked individuals (never blank, #541 fallback via the message owner); under-cap → individuals. (3)
- retention: `message-dissolve-retention-purge` deletes coverage past the window; leaves in-window + pin-owned rows. (1) · FK cascade: deleting a message removes its coverage. (1)

Run via `npm run test:unit` / `npm run test:integration` from `apps/api` (never raw jest). **Totals ≈ 13 cases.** Migration correctness (nullable + CHECK + FK) verified by the processor/serve integration tests exercising real rows; no standalone migration test.

## Acceptance criteria

- [ ] A large polygon layer rendered in the **message feed** (not pinned) shows a filled coverage at low zoom (no empty swathes, no `504`) and resolves to individuals on zoom-in — matching a pinned map.
- [ ] With message coverage absent (mid-build), an over-cap message tile serves area-ranked individuals — never blank.
- [ ] Deleting a portal/message removes its message-owned coverage (FK cascade); pin coverage is untouched.
- [ ] Message-owned coverage older than the retention window is purged; pins are never purged by it.
- [ ] Small message polygon layers (≤ cap) still serve raw (no needless precompute).

## Risks & rollback

- **Fail mode: graceful** — during the eager-precompute window (or failure), an over-cap message tile serves the raw clip, then the #541 area-ranked fallback once individuals land, then merged coverage. Never a hard failure. Rollback: the schema is additive (nullable + new cols); reverting the serve/enqueue leaves pins working and message blocks back on the raw path.
- **CHECK/FK correctness** — a bad owner combination is rejected at write; the processor always sets exactly one owner. The FK cascade must not touch pin rows (message_id null there).
- **Enqueue fan-out** — every large message map enqueues a precompute; the size gate + retention bound it; noisy-neighbor is the shared deferred concern.

## Files touched

- Edit: `map-dissolve-geometries.table.ts`, `db/schema/zod.ts` (auto), `db/schema/type-checks.ts` (auto).
- New: `apps/api/drizzle/00XX_generalize_dissolve_ownership.sql` (+ hand-added CHECK).
- Edit: `packages/core/src/models/job.model.ts` (metadata schema).
- Edit: `dissolve-precompute.service.ts` (`enqueueForMessageBlock`), `dissolve-precompute.processor.ts` (owner read + lock), `portal-map-tile.service.ts` (owner-keyed serve), `portal.service.ts` (enqueue hook).
- New: `message-dissolve-retention-purge.processor.ts` + registration in `maintenance.queue.ts`/`maintenance.worker.ts`.
- Edit tests: the suites above.

## Next step

`docs/MESSAGE_MAP_PRECOMPUTE.plan.md` — TDD slices on this branch: (1) generalize the key (migration + metadata + owner-keyed serve/processor/`hasDissolvePrecompute`, so a message ref serves coverage + the #541 fallback); (2) eager size-gated `enqueueForMessageBlock` at message-create; (3) age-only retention purge (FK cascade covers deletion). Each a green-testable commit reusing #541's precompute.
