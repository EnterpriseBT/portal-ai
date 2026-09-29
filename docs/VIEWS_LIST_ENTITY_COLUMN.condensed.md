# Views list — readable Entity label — Condensed design (#646)

**Issue:** [EnterpriseBT/portal-ai#646](https://github.com/EnterpriseBT/portal-ai/issues/646) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The Views list shows Name / Key / Row filter / Description but nothing about *which entity* a curated view slices — the list payload carries only `connectorEntityId` (a raw UUID). Batch-load the entity's `key` + `label` into the list payload and surface the **label** on each Views card. Packages: `@portalai/api` (endpoint + repo), `@portalai/core` (contract), `@portalai/web` (card). Note (#212): the Views list became a **card list** in #642, so this lands in the card's `MetadataList`, not a table column.

## Current shape

| Piece | Location | Note |
|---|---|---|
| List endpoint | `apps/api/src/routes/curated-view.router.ts:141` | builds `where`, calls `curatedViews.findMany(where, …)` (`:194`) — returns raw view rows |
| Repository | `apps/api/src/db/repositories/curated-views.repository.ts` | base `findMany`; no entity join today |
| List payload | `packages/core/src/contracts/curated-view.contract.ts:38` | `curatedViews: z.array(CuratedViewSchema)` — only `connectorEntityId` |
| Card list | `apps/web/src/views/CuratedViews.view.tsx:121` | `MetadataList` with Key / Row filter / Description; `CuratedViewRow = CuratedViewListResponsePayload["curatedViews"][number]` |
| 1-to-1 join precedent | `connectorDefinition` on `connectorInstances` (CLAUDE.md → Include convention) | LEFT JOIN for a 1-to-1 relation |

## Decision — always-include the entity label via a LEFT JOIN repo finder

Always include (no `include` param): the entity is the list's single most useful context and there's one consumer. Add a dedicated `curatedViewsRepo.findManyWithEntity(where, opts)` that LEFT JOINs `connector_entities` and returns each view plus `entity: { key, label } | null` (the 1-to-1 LEFT JOIN pattern the Include convention names — isolated to this endpoint so the base `findMany` and other finders are untouched). The `count(where)` query is unchanged (no join needed). Contract gains a `CuratedViewListItemSchema = CuratedViewSchema.extend({ entity: {key,label}.nullable() })`; the card renders `entity.label` (fallback `entity.key`), hidden when absent.

*Rejected:* an `include=entity` param — one consumer, always wanted; a param is ceremony. *Rejected:* post-query batch-load via `connectorEntities.findMany` — its override also joins `connectorInstance` (extra work); a lean LEFT JOIN is cheaper and 1-to-1.

## Plan — 1 slice

**Files**
- Edit `packages/core/src/contracts/curated-view.contract.ts` — add `CuratedViewListItemSchema` (+ `entity`) and use it in `CuratedViewListResponsePayloadSchema.curatedViews`.
- Edit `apps/api/src/db/repositories/curated-views.repository.ts` — add `findManyWithEntity(where, opts)` (LEFT JOIN `connector_entities`, select view cols + `entity` key/label).
- Edit `apps/api/src/routes/curated-view.router.ts` — call `findManyWithEntity` in the list handler (`:194`); swagger response items reference the extended shape.
- Edit `apps/web/src/views/CuratedViews.view.tsx` — add an **Entity** row to the card `MetadataList` (`entity.label ?? entity.key`, hidden if null).

**Tests** (npm scripts, never raw jest)
- `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts` — the list response carries `entity: { key, label }` matching the view's connector entity.
- `apps/web/src/__tests__/CuratedViewsView.test.tsx` — a card renders the entity label.

## Smoke (manual, against your dev stack)

1. As admin, open **/views**. Each card shows an **Entity** line with the connector entity's **label** (e.g. "Contacts"), not a UUID.
2. A view whose entity was deleted (or an unresolvable entity) renders no Entity line (not a blank/`null`) — the field is hidden.
3. `GET /api/curated-views` (network tab or curl) — each item carries `entity: { key, label }`.

## Out of scope

- An `include=entity` toggle / other includes on this endpoint.
- The detail page (already shows the entity via records) and the create/edit dialogs.
- Sorting/filtering the list by entity.
