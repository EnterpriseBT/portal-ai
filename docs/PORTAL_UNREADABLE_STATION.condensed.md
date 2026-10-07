# Portal on an unreadable station — Condensed design (#699)

**Issue:** [EnterpriseBT/portal-ai#699](https://github.com/EnterpriseBT/portal-ai/issues/699) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A member's portal can outlive their read on its station: a revoked share, a narrowed policy, or a deleted station. The station GET then correctly 404s, since #692 treats unreadable as absent. But `PortalHeaderMeta` returns `null` whenever it has no station, so the whole header disappears with no explanation, including the org usage rows that have nothing to do with the station.

The composer also stays enabled. `POST /api/portals/:id/messages` checks only write on the portal, so the member keeps running turns against a station they can no longer read. When the station is deleted, the message is accepted and then the stream 404s. The header should say why the station is gone and keep what isn't station-specific, and sending should stop, enforced by the server and explained in the UI.

Packages: `apps/web`, plus a one-route check in `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Header | `apps/web/src/views/Portal.view.tsx:141-283` (`PortalHeaderMeta`) | `sdk.stations.get(stationId, {include:"connectorInstance,curatedView"})` + `sdk.organizations.usage()`; `if (!station) return null` (:157) for loading and error alike. An inline container in a view file, which the Component File Policy disallows |
| Header tests | `apps/web/src/__tests__/Portal.view.test.tsx:140-230` | render the container with a mocked sdk |
| Composer lock | `apps/web/src/components/PortalSession.component.tsx:476,503-504` → `ChatWindowUI` `disabled` + `lockedReason` | `usePortalChatLock` (`utils/portal-chat-lock.util.ts:72-77`) locks only while an import job runs |
| Send | `apps/api/src/routes/portal.router.ts:743-` (`POST /:id/messages`) | `PortalAccessService.load(…, "write")` on the portal only; no station check |
| Stream | `apps/api/src/routes/portal-events.router.ts:156-164` | 404 `STATION_NOT_FOUND` only when the station row is gone, after the message was already accepted |
| Readability helper | `ObjectAccessService.readableInOrg(set, org, "station", row)` | the shared org + read check (#685) |

## Decision — the station is part of what a turn uses

A portal is the member's own, but each turn runs against the station: its context, attachments and tool packs. Reading the station is therefore part of being able to send.

Options:
- **(a)** Header only. Show the reason and keep usage, but leave sending alone.
- **(b)** Header, plus a server-enforced send check and a composer lock with a reason.

**Chosen: (b).**
- **Why not (a).** A revoked share should stop use, not just change the header. Under (a) the member could keep querying through a station they were cut off from. Sending to a deleted station would also stay accepted-then-failed.
- **Server.** `POST /:id/messages` loads the portal's station and requires it in the org and readable (`readableInOrg`). Otherwise it answers **404 `STATION_NOT_FOUND`**, the same code the stream uses for a missing station. That keeps unreadable == absent, so a revoked share and a delete read the same. The check runs before the turn ceiling and before the message row is written, so a refused send writes nothing.
- **Header.** When the station query fails with 404, the header renders a short line: "This portal's station isn't available to you." It also keeps the usage strip and drops the station-specific rows. While the query is loading it renders the usage strip alone, never `null`.
- **Composer.** `PortalSession` reads the same station query; React Query dedupes it because the key and include are identical. On a 404 it locks the composer with that reason through the existing `chatLocked`/`chatLockReason` props. The job lock keeps precedence when both apply, since it is the more transient state. History, pins and reading old answers are unchanged.
- **File policy.** `PortalHeaderMeta` moves to `apps/web/src/components/PortalHeaderMeta.component.tsx`, split into `PortalHeaderMetaUI` (props only) and the `PortalHeaderMeta` container, as the Component File Policy requires. The view imports it.

## Plan — 2 slices

**Slice 1 (api): send requires a readable station.**
- **Files:** `apps/api/src/routes/portal.router.ts` (POST `/:id/messages`), and `apps/api/src/__tests__/config/route-authorization.map.ts` (append the station check to the route's note).
- **Tests:** `apps/api/src/__tests__/__integration__/routes/read-access.authorization.integration.test.ts`.
  - The member's portal on an owner station shared Read returns 200.
  - After the share is revoked, the send returns 404 `STATION_NOT_FOUND` and writes no message row.
  - A soft-deleted station gives the same 404.

**Slice 2 (web): header and composer.**
- **Files:**
  - New `components/PortalHeaderMeta.component.tsx`. `PortalHeaderMetaUI` takes `station | null`, `stationUnavailable`, `usage`, `isEntitled`, `isMobile`.
  - Edit `views/Portal.view.tsx` to import it.
  - Edit `components/PortalSession.component.tsx` to add the station-unavailable lock reason.
- **Tests:**
  - New `__tests__/PortalHeaderMeta.component.test.tsx`, driving the UI through props:
    - the unavailable line plus usage, with no station rows;
    - loading shows usage only;
    - the existing station-row cases, moved from `Portal.view.test.tsx:140-230`.
  - A `PortalSessionUI` case: locked with the station reason, so the send button is disabled and the reason is shown.
- Run `npm run test:unit` for the touched files, plus `type-check` and `lint` in both packages.

## Smoke (manual, against your dev stack)

Run as owner and member of one org (`e2e:use <role>`).
1. The owner shares a station with the member at Read. The member opens a portal on it and sends one message: it answers normally.
2. The owner revokes the share. The member reloads the portal:
   - the header shows "This portal's station isn't available to you" and the usage rows;
   - there is no station link or chips;
   - the composer is disabled with that reason;
   - the conversation history is still readable.
3. As the member, `POST /api/portals/<id>/messages` directly returns 404 `STATION_NOT_FOUND`, and no new message appears in the portal.
4. The owner re-shares the station. The member reloads: the header and composer are back, and sending works.
5. As the owner, delete a station that has a portal, then open that portal. The header and composer behave as in step 2.

## Out of scope

- **Re-pointing a portal at another station.** No such affordance exists, and it's a feature, not this bug.
- **Turns posted before the revoke.** A pending turn whose stream starts after the revoke still runs once. The stream re-checks only that the station exists, and a turn already accepted is allowed to finish.
- **Hiding portals whose station is unreadable from the portals list.** The portal is still the member's own, and it stays readable.
