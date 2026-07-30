# Stations cache key drops query params — Condensed design (#300)

**Issue:** [EnterpriseBT/portal-ai#300](https://github.com/EnterpriseBT/portal-ai/issues/300) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `queryKeys.stations.get(id)` ignores the query params that `stations.get` puts in the URL, so four call sites share one react-query entry holding two different payload shapes. When an un-enriched fetch owns the entry, `Portal.view`'s connector chip falls through to `?? inst.connectorInstanceId` and renders a raw UUID where a connector name belongs. Frontend-only (`apps/web`), one file changed plus its test — no contract change, no API change. Found while walking #284's smoke (§7); pre-existing on `main`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The key, params dropped | `apps/web/src/api/keys.ts:160` | `get: (id: string) => [...root, "get", id]` |
| The call, params used | `apps/web/src/api/stations.api.ts:30-40` | key gets `id`; `buildUrl(..., params)` gets both |
| The param that diverges | `packages/core/src/contracts/station.contract.ts:40-42` | `StationGetRequestQuerySchema` = `{ include?: string }` |
| The visible fallback | `apps/web/src/views/Portal.view.tsx` (Connectors chip) | `label={inst.connectorInstance?.name ?? inst.connectorInstanceId}` |
| The pattern to match | `apps/web/src/api/keys.ts:166` | `portals.get: (id, params?) => [...root, "get", id, params]` — already correct |

Four consumers, two shapes:

| Call site | `include` |
|---|---|
| `components/DefaultStationCard.component.tsx:38` | none |
| `components/DefaultStationMeta.component.tsx:22` | none |
| `views/StationDetail.view.tsx:52` | `connectorInstance` |
| `views/Portal.view.tsx:141` | `connectorInstance` |

A **second, latent instance of the same shape** exists at `keys.ts` → `connectorInstanceLayoutPlans.detail(connectorInstanceId)`, consumed by `connector-instance-layout-plans.api.ts:25-35` (`getCurrent`), whose URL takes `params?: { include?: string }`. It cannot currently misbehave — no call site passes params today — but the defect is identical and one line from the same edit. (`entityGroups.listByEntity` looks similar and is **not** a defect: its `buildUrl(ENTITY_GROUPS_URL, { connectorEntityId })` params are derived entirely from the id already in the key, so the key fully determines the URL.)

## Decision — thread `params` into the key

Two candidates were weighed in the issue:

- **Always return `connectorInstance` from the station GET and drop the `include` for it.** Removes the divergence by removing the parameterization. **Rejected** — `include` is deliberately an optional per-call parameter (`CLAUDE.md` → Include / Join Convention), and these are genuinely different pages: the dashboard card doesn't need the join and shouldn't pay for it. It would also be a response-shape change, which a `condensed` bug fix has no business making.
- **Put `params` in the key**, matching `portals.get`. **Chosen.** The parameterization is correct; the cache key simply failed to reflect it. One line, consistent with the sibling that already does it right.

**Consequence, accepted deliberately:** two distinct keys means the dashboard and the portal each fetch rather than sharing one entry. That is the correct behavior — they are requesting different payloads — at the cost of one additional request on the dashboard path. `invalidateQueries({ queryKey: queryKeys.stations.root })` keeps catching both, since `root` remains a prefix of both keys; the ten call sites that invalidate by root are unaffected.

`connectorInstanceLayoutPlans.detail` gets the same treatment in the same edit — fixing a known-identical latent defect while the file is open is cheaper than a second ticket, and it is covered by the same test shape.

## Plan — one slice

**Files**

- Edit: `apps/web/src/api/keys.ts` — `stations.get: (id: string, params?: StationGetRequestQuery) => [...root, "get", id, params]`; `connectorInstanceLayoutPlans.detail: (connectorInstanceId: string, params?: { include?: string }) => [...root, "detail", connectorInstanceId, params]`. Import `StationGetRequestQuery` from `@portalai/core/contracts` alongside the existing query types.
- Edit: `apps/web/src/api/stations.api.ts:36` — pass `params` through: `queryKeys.stations.get(id, params)`.
- Edit: `apps/web/src/api/connector-instance-layout-plans.api.ts` — same, for `getCurrent`.

No call-site changes: every consumer already passes (or omits) params at the `sdk` layer, and the key now derives from what they pass.

**Tests**

- Edit: `apps/web/src/__tests__/api/stations.api.test.ts:49-68` — the existing `get` cases assert `queryKeys.stations.get("station-123")` with no params; they keep passing (both sides gain `undefined`). Add a case proving the divergence is gone: `stations.get(id)` and `stations.get(id, { include: "connectorInstance" })` produce **different** keys, and the second key's URL carries the param.
- Add: a case asserting `queryKeys.stations.root` is still a prefix of both keys — that is what keeps the ten root-invalidation sites working, and it is the one thing a future refactor could silently break.
- Edit (if it asserts the key): the layout-plans api test, same shape.
- `cd apps/web && npm run test:unit`, then `npm run lint && npm run type-check` from the root.

## Smoke (manual, against your dev stack)

1. `npm run dev`. Open the **dashboard** first and let the default-station card render (that's the un-enriched fetch that poisons the shared entry today).
2. Open a portal on a station with a connector instance attached → the header's **Connectors** chip shows the connector **name**, not a UUID. Before the fix, this is where the UUID appears.
3. Navigate dashboard → portal → dashboard → portal a few times, and in both orders relative to `/stations/<id>`. The chip stays correct every time — the pre-fix bug was order-dependent, so repetition in both directions is the test.
4. DevTools → Network: the dashboard's station GET has **no** `include`, the portal's has `include=connectorInstance`, and both are cached separately (a repeat visit to either doesn't refetch within staleTime).
5. Invalidation still reaches both: edit the station (rename it in Edit Station), then confirm the new name appears on **both** the dashboard card and the portal header without a manual reload.
6. Open the layout-plan editor for a spreadsheet connector instance (`/connectors/<id>/layout-plan/edit`) and confirm it still loads — the second key change touches its query.

## Out of scope

- Auditing every other `queryKeys.*` entry for the same defect. A scan found only these two of the ~50 factories (plus one false positive), so a sweep isn't warranted; if a third appears, that argues for a `full`-sized ticket with its own survey.
- Removing `getCurrent` from `connector-instance-layout-plans.api.ts` despite finding no call sites. Absence in a point-in-time grep is not evidence of disuse, and deleting a public SDK method is a different decision than fixing its key.
- Changing the `?? inst.connectorInstanceId` fallback in `Portal.view`. It is a correct defensive default; the bug is that it was being reached, not that it exists.
- Any API, contract, or schema change — `include` semantics are unchanged.
