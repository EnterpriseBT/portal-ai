# Message-block polygon-map precompute — Discovery

**Issue:** [EnterpriseBT/portal-ai#542](https://github.com/EnterpriseBT/portal-ai/issues/542)

**Why this exists.** #532 + #541 gave **pinned** polygon maps a never-drop serve: a per-pin dissolve precompute (`map_dissolve_geometries`) feeds over-cap tiles a bounded merged coverage, and a degraded/missing coverage falls back to area-ranked individuals instead of blanking. A polygon map delivered as a transient **message block** (the agent's `visualize_map` output, not pinned) has **no precompute** — the serve forces `portalResultId = null`, `dissolveReady` is false, and the tile falls to the raw clip (arbitrary `LIMIT 10k` → empty swathes, `504` on a large layer). Pinning is today's only fix. This ticket gives message-block polygon maps the same precompute-backed serve, keyed by the message block rather than a pin — this is the work that makes never-drop hold **before** the user pins.

## The current shape

### Serve path — the message-vs-pin split
| Piece | Location | Note |
|---|---|---|
| `TileRef` union | `portal-map-tile.service.ts:106` | `{kind:"message",messageId,blockIndex}` \| `{kind:"pin",portalResultId}` |
| `resolvePipeline` | `:406-451` | message ref → `portalMessagesRepo.findById`, index `blocks[blockIndex]`, parse `.pipeline`; **no `portalResultId`** |
| `renderTile` | `:1041` | `portalResultId = ref.kind==="pin" ? ref.portalResultId : null` |
| `dissolveReady` gate | `:661-665` | requires `portalResultId != null` → a message ref can never be dissolve-ready today |
| `runDissolveTile` / `hasDissolvePrecompute` | `:871`, `:835` | key strictly on `portal_result_id` |
| message tile route | `portal-map.router.ts:154` | `/tiles/message/:messageId/:blockIndex/:z/:x/:y` |

### Precompute keying + enqueue (pin-only)
| Piece | Location | Note |
|---|---|---|
| `enqueueForPin` / `isDissolvable` | `dissolve-precompute.service.ts:44,27` | metadata `{portalResultId, organizationId}`; `isDissolvable` = geo + any polygon layer |
| `reenqueueAllDissolvable` | `dissolve-precompute.service.ts:84` | scans `portal_results WHERE type='geo'` |
| processor | `dissolve-precompute.processor.ts:88-90,298-303` | reads `portal_results WHERE id=portalResultId`; advisory-locks on `portalResultId`; delete-then-insert keyed by `portal_result_id` |
| enqueue callers | `portal-results.router.ts:224,344` | pin create + refresh |

### Storage schema (the crux)
`map-dissolve-geometries.table.ts:44-46` — `portalResultId` is **`.notNull().references(portalResults.id, {onDelete:"cascade"})`**. Both indexes lead with it (`:63,:69`). No unique key by design (`:26-28`) — idempotency is the processor's per-owner delete-then-insert. A message block has **no `portal_results` row**, so the key must generalize.

### Message-block lifecycle (drives retention)
| Fact | Location |
|---|---|
| messages are **immutable** (create/read only), `blocks jsonb`, **no `deleted` column** | `portal-messages.table.ts:27`, `portal-messages.repository.ts:3` |
| a geo block's content = `visualize_map` return (`pipeline.sql`, `stationId`, count envelope) | `visualize-map.tool.ts:343-349` |
| messages created via `repo.portalMessages.create` | `portal.service.ts:565,779` |
| messages **hard-deleted only in bulk by portal** (`deleteByPortal`) — **no per-message TTL, no cascade to any dissolve table** | `portal-messages.repository.ts:63`; callers `portal.service.ts:620`, `portal.router.ts:681`, `station.router.ts:840`, `reset.service.ts:139`, `organization-delete.service.ts:186` |
| pinning a block → `portal_results` row + `enqueueForPin` | `portal-results.router.ts:108-230` |

### Retention precedent
`maintenance.queue.ts`/`maintenance.worker.ts` (concurrency 1, daily cron) + the batched drain-loop purge processors `entity-record-retention-purge.processor.ts` / `ledger-retention-purge.processor.ts` (`PURGE_BATCH_SIZE = 10_000`, drain to zero, typed summary). The pattern to copy for orphaned message-block coverage.

## The design space

### Decision 1 — How to key a message-block precompute

- **A. Generalize the key: nullable `portalResultId` + `messageId` + `blockIndex`**, with a CHECK that exactly one owner is set. The processor, `runDissolveTile`, and `hasDissolvePrecompute` key on whichever owner the ref carries. FK-cascade cleanup is lost for message rows → covered by Decision 3's purge.
- **B. Synthetic "shadow" `portal_results` row** per message block — reuses *all* pin machinery (keying, FK cascade, enqueue, serve) unchanged. But `portal_results` is user-facing (pins render in the UI), so a shadow row leaks unless flagged + filtered everywhere.
- **C. Polymorphic `owner_type` + `owner_id`** — one discriminator column pair instead of two nullable keys. Cleanest discriminator, but a bigger schema change + rewrites every `portal_result_id` reference.

| | A nullable + msg keys | B shadow pin | C polymorphic owner |
|---|---|---|---|
| Reuses serve/processor | mostly (key generalized) | fully | mostly (rename) |
| Pollutes a user-facing table | no | **yes** (shadow pins) | no |
| Cleanup | purge (no cascade) | FK cascade (but shadow-row lifecycle) | purge |
| Schema churn | + 2 nullable cols + CHECK | none | + 2 cols, rewrite refs |

**Lean: A.** Add nullable `message_id` + `block_index` alongside a now-nullable `portal_result_id`, CHECK exactly-one-owner; the serve already has `messageId`/`blockIndex` on the ref. No synthetic rows in a user-facing table; the lost FK cascade is the purge's job (Decision 3).

### Decision 2 — When to enqueue the message-block precompute

- **A. Eager on message create**, gated by size: when `visualize_map` persists a geo polygon block whose layer is **over the fast-path cap**, enqueue a precompute for `(messageId, blockIndex)`. A small layer serves raw fine (the count-driven fast path) and needs nothing.
- **B. Lazy on first tile miss**: the serve, on an uncovered over-cap message polygon tile, enqueues a precompute and serves raw (or the #541 fallback once individuals exist) until it lands.
- **C. Both**: eager for the common "view right after generation" case, lazy as a backstop for a re-view after retention aged the coverage out.

| | A eager+gated | B lazy | C both |
|---|---|---|---|
| Coverage ready when first viewed | usually (races the immediate view) | never on first view (window) | usually |
| Wasted precompute (unviewed maps) | some (bounded by retention) | none | some |
| Serve-path complexity | none | enqueue-from-serve | enqueue-from-serve |

**Lean: A.** A message map is almost always viewed immediately after the agent generates it, so eager+size-gated readies coverage for that view; the inherent precompute-duration window serves raw/fallback and resolves on completion. Lazy (B/C) adds enqueue-from-serve complexity for the rare aged-re-view — deferred (Open Q2).

### Decision 3 — Retention / cleanup

- **A. Maintenance-queue purge** (third purge processor): delete `map_dissolve_geometries` rows whose `message_id` no longer exists in `portal_messages` (orphan — the bulk `deleteByPortal` leaves these) **or** whose message is older than a retention window. Batched drain loop + typed summary, per the existing pattern.
- **B. Immediate cleanup in `deleteByPortal`**: delete the portal's message-owned dissolve rows in the same transaction message deletion runs.

**Lean: A primary, B as a cheap add-on.** The purge is the correctness backstop (orphans + aging); wiring `deleteByPortal` to also delete message-owned rows makes the common deletion immediate rather than waiting a day. Pin-owned rows keep their FK cascade untouched.

## Tradeoff comparison

| | D1: nullable + msg keys | D2: eager+gated enqueue | D3: purge + deleteByPortal |
|---|---|---|---|
| Spreads to spec | migration (nullable + CHECK + index) + serve/processor key generalization | a new enqueue hook at message create + a size gate | a maintenance purge processor + a `deleteByPortal` hook |
| Independently shippable | slice 1 (key + serve) | slice 2 (enqueue) | slice 3 (retention) |

## Recommendation

1. **Generalize the precompute key (D1-A):** `map_dissolve_geometries.portal_result_id` becomes nullable; add nullable `message_id` + `block_index`; CHECK exactly-one-owner; index the message owner. `runDissolveTile`/`hasDissolvePrecompute`/the processor key on the ref's owner; `renderTile` passes the message owner for a message ref.
2. **Enqueue eagerly, size-gated (D2-A):** a `DissolvePrecomputeService.enqueueForMessageBlock` fired where `visualize_map` blocks are persisted, only for a polygon layer whose persisted count exceeds the fast-path cap.
3. **Retain via a maintenance purge (D3-A) + a `deleteByPortal` hook (D3-B):** orphan + age-window purge; immediate delete of a portal's message-owned rows on message deletion.
4. **Reuse #541 wholesale:** the bounded per-band snap+union precompute + the count-driven serve + the never-blank fallback all apply unchanged once the key is generalized.

## Open questions

1. **Retention window for message-block coverage.** Pins keep coverage until deleted; a message map is transient. **Lean: an age window (~30 days) plus orphan cleanup** — a re-view of an aged-out message map serves raw (or re-precomputes if lazy is later added). Bounds storage without a lazy backstop.
2. **Lazy backstop (D2-B/C).** Ship eager-only first? **Lean: yes, defer lazy** — add it only if aged-re-view of message maps proves common; eager covers the dominant "view right after generation" path.
3. **Size gate threshold.** Which count triggers a message-block precompute? **Lean: the same `MAP_TILE_FEATURE_CAP` fast-path threshold** — below it the raw fast path already never-drops, so precompute only above it (consistent with the pin path's implicit behavior).
4. **Advisory-lock key for message blocks.** The processor locks on `portalResultId`. **Lean: lock on a composite `message:<id>:<blockIndex>` namespace** so two precomputes of the same block can't race, mirroring the pin lock.

## Enterprise-scale considerations

- **Data lifecycle** — the defining dimension. Message blocks are immutable + bulk-deleted with **no cascade**, so message-owned coverage needs explicit orphan + age retention (D3). Pins are unaffected (FK cascade intact). Windows are business-aligned (a transient message vs a durable pin), not arbitrary.
- **Concurrency & correctness** — generalize the advisory lock to the message-block key (Open Q4); the delete-then-insert idempotency pattern is preserved per owner.
- **Failure modes** — graceful degradation inherited from #541: during the eager-precompute window (or on failure) an over-cap message tile serves the raw clip today, and the #541 area-ranked fallback once individuals exist. `Lean: acceptable` — the window is the precompute duration, and never-blank holds once individuals land.
- **Scale & unbounded growth** — eager precompute on every large message map is fan-out; the **size gate** (Open Q3) + retention (D3) bound it. Noisy-neighbor on the shared jobs queue is the same deferred concern as #541.
- **Multi-tenancy** — per-org, per-message; the message tile route is already org-scoped (`getApplicationMetadata`).
- **Contract stability** — the key generalization is additive (nullable columns + CHECK); the `visualize_map` block shape is unchanged. `Lean: additive`.
- **Accuracy & auditability** — `N/A` — coverage is a derived render artifact; the message block's pipeline remains the source of truth.

## What this doesn't decide

- **Points/lines message blocks** — already count-driven raw with a cheap per-tile probe (#532 slices 3–4); no precompute needed, out of scope.
- **Making messages mutable / per-message soft-delete** — out of scope; retention works with the immutable + bulk-delete model via the purge.
- **A dedicated dissolve queue** for noisy-neighbor isolation — deferred (shared with #541's deferral).

## Next step

Write `docs/MESSAGE_MAP_PRECOMPUTE.spec.md` (the key-generalization migration + CHECK, the serve/processor owner-keying, `enqueueForMessageBlock`, the purge + `deleteByPortal` hook) and `.plan.md`. The plan slices: (1) generalize the key (migration + serve/processor/`hasDissolvePrecompute` owner-keying, message ref serves coverage); (2) eager size-gated enqueue at message create; (3) retention purge + `deleteByPortal` cleanup — each a green-testable commit reusing #541's bounded precompute + fallback.
