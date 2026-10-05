# Gate station, portal, pin and view actions per object — Condensed design (#690)

**Issue:** [EnterpriseBT/portal-ai#690](https://github.com/EnterpriseBT/portal-ai/issues/690) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #684. Audit rows 4–12, 36, 39 in `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`.

**Why.** #688 put `capabilities` on every station, portal and pin row, and shipped the gate components and decider. The surfaces here still show actions their reader can't take: Delete on every station card and portal card, Unpin on every pin, Rename/Delete on a portal, and a pin page that auto-refreshes into a 403 for a read-only sharee. Two of the deletes still bypass the SDK. This ticket renders each of those actions from `capabilities` through `decideActionGate` / `useActionGate`. Mostly `apps/web` (see Decision 1 for the one exception).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Station card Delete / Set default | `components/StationList.component.tsx:87-103` (`StationCardUI`, pure) | ungated; the row type drops `capabilities` (`:65`) though the list payload carries it |
| Set default = org PATCH | `api/stations.api.ts:53-60` → server `organization.router.ts:172-176` | server checks **class** `resource.write {type:"station"}` (owner/admin); `canOnResource("station","write")` is true for any member, so it's too loose |
| Station detail Share/Edit/Delete | `views/StationDetail.view.tsx:206-239` | already reads `capabilities`, but via conditional spreads, with no `gate` |
| Portal card Delete + raw DELETE | `components/PortalCard.component.tsx:25-32`; `views/StationDetail.view.tsx:154-163` | ungated; `fetchWithAuth`, no `portalResults` invalidation |
| Recent portals Delete + raw DELETE | `components/RecentPortalsList.component.tsx:49-56`; `views/Dashboard.view.tsx:155-171` | ungated; `fetchWithAuth`; `sdk.portals.remove` exists (`api/portals.api.ts:58-62`) |
| Unpin on pin cards | `components/PinnedResultsList.component.tsx:45-51` (also `PinnedResultsListView.view.tsx:133`) | ungated; rows carry shareable `capabilities` |
| Pin detail actions | `views/PinnedResultDetail.view.tsx:133-190` | capability-driven via `canShare/canWrite/canDelete` props, but no `gate` |
| Pin widget auto-refresh | `utils/use-widget-refresh.util.ts:103-113` (mount), `:48`; fed by `blockRef {kind:"pin"}` (`PinnedResultDetail.view.tsx:226`) | refreshes on mount and shows the refresh button regardless of write → a read-only sharee gets a 403 |
| Portal Rename / Delete / touch | `views/Portal.view.tsx:356-372`, touch `:297-307` | ungated; `item.portal.capabilities` unused |
| Pin result (create) | `components/PortalMessage.component.tsx:240-255` | ungated; server rule = own create on `pin` (`canOnResource("pin","write")` matches it) |
| Tier-limited toolpack options | `CreateStationDialog.component.tsx:233-260`, `EditStationDialog.component.tsx:54-63` | disabled with "Not included in your plan", no way to upgrade |
| Chat send while a job runs | `PortalSession.component.tsx:250,471`; `ChatWindow.component.tsx:280,300,318,338,349` | `usePortalChatLock` computes a `reason`, and it's dropped; Cancel is *enabled* while locked and idle |

## Decision 1 — "Set as default" needs a caller capability the client doesn't have

**Options:**
- (a) Gate it on `canOnResource("station","write")`. Wrong: it shows the action to members, who then 403.
- (b) Keep it visible and lean on `onPermissionDenied`. That's the anti-pattern #684 exists to remove.
- (c) Add `station.default.set` to core `CALLER_CAPABILITY_ACTIONS` (`packages/core/src/models/permission.model.ts:130-137`). The API computes it with the same class check the org PATCH runs, and the card gates on `can("station.default.set")`. This touches core and api (one constant plus one entry in the caller-capabilities map), so it's a contract addition beyond the `apps/web`-only sizing.

**Chosen: (c)**, pending confirmation. It's the only option where the button agrees with the server. It's a few lines, and its precedent is the existing six caller actions.

## Decision 2 — the read-only pin stops refreshing

The pin `blockRef` gains `canRefresh` (from `capabilities.write`). `useWidgetRefresh` skips the mount refresh and hides the manual button when it's false. The stale badge still shows, so a sharee knows the data's age. Chosen over a server change: the 403 is correct, and the client shouldn't ask.

## Decision 3 — the smaller calls (made)

- **Portal touch** (`lastOpened` PATCH): only with `write`, so an admin viewing someone else's portal doesn't write.
- **Unpin inside a portal** stays ungated: portals are per-user, so every pin in `pinnedBlocks` is the caller's own (or the caller is owner/admin).
- **Pin result** gates on `canOnResource("pin","write")`, as a create rule.
- **Tier options:** a one-line note under the pack picker ("Some tool packs aren't included in your plan." plus the shared `UpgradeLink` to Settings → Billing), shown when the plan leaves any built-in out. That's the `upsell` treatment for select options. *Amended in slice 4:* the link was meant for the disabled option's caption, but a disabled MUI option can't be clicked, so a link there is dead.
- **Chat lock:** `disable` with the lock's `reason`, shown as helper text under the input and as the Send tooltip. Cancel is enabled only while streaming.

## Plan — 4 slices (tests first in each)

1. **Stations.**
   - Core `station.default.set` and the API caller-capability entry (+ api unit test).
   - `StationCardUI` takes `capabilities` and `canSetDefault`: Delete by `capabilities.delete`, Set default by `can("station.default.set")`.
   - StationDetail's spreads become `gate`s.
   - Tests: `__tests__/StationList.test.tsx`, `StationDetail.view.test.tsx`, plus the api caller-capabilities test.
2. **Portals.**
   - `PortalCardUI` and `RecentPortalsList` gate Delete by the row's `capabilities.delete`.
   - Both raw DELETEs move onto `sdk.portals.remove`, invalidating `portals.root` + `portalResults.root`, with `onPermissionDenied`.
   - `Portal.view` Rename/Delete come from `item.portal.capabilities`, and the touch is skipped without write.
   - Tests: `RecentPortalsList.test.tsx`, `DashboardView.test.tsx`, `Portal.view.test.tsx`, a new `PortalCard.test.tsx`.
3. **Pins.**
   - Card Unpin gated by `capabilities.delete`.
   - Detail actions through `gate`.
   - `canRefresh` on the pin `blockRef`.
   - Pin result gated.
   - Tests: `PinnedResultsList.test.tsx`, `PinnedResultsListView.test.tsx`, `PinnedResultDetail.test.tsx`, `use-widget-refresh.util.test.ts`, `PortalMessage.test.tsx`.
4. **Tier + chat lock.**
   - The upgrade note under the pack picker (see Decision 3).
   - The lock reason reaches `ChatWindowUI`, and Cancel follows streaming only.
   - Tests: `CreateStationDialog.test.tsx`, `EditStationDialog.test.tsx`, `ChatWindowUI.test.tsx`, `PortalSession.test.tsx`.

Run via `npm run test:unit` in `apps/web` (and `apps/api` for slice 1). Lint, type-check, and the action-gate guard at each boundary.

## Smoke (manual, against your dev stack)

**Preflight:**
- **Stack:** `npm run dev` on this branch, with core rebuilt. If `GET /api/organization/current` lacks `station.default.set`, the API is stale: touch `apps/api/src/index.ts`.
- **Sessions:** `e2e:auth:all`.
- **Fixtures (e2e-fixture org):**
  - **Member Station** is the member's own station; **My Station** is readable but not writable by the member.
  - **Member portals** with text blocks, e.g. `5070f8f0`.
  - **"smoke690 table pin"** is a data-table pin the owner made on an admin portal. It's shared Read with the member, and its `snapshot_updated_at` is backdated two days so it's stale.
- **Reset:** delete the pin, which also removes its share.


1. As **member**, `/stations`: Delete shows only on the member's own stations; **Set as default** shows on none. As **owner**: both show on every card, and Set default works.
2. As **owner**, share a station with the member at Read. As **member**, open it: no Share, Edit or Delete in its menu.
3. As **member**, on the Dashboard and the station's portal cards: Delete shows on the member's own portals. Deleting one removes it, and its pins vanish from Pinned results (the invalidation).
4. As **owner**, share a pin with the member at Read. As **member**, open it: no Rename, Share, Delete or Unpin, no refresh button, no 403 in the network panel, and the stale badge is still shown. On `/pinned` the card has no Unpin.
5. As **member** in their own portal: Rename/Delete show, and Pin result shows on a chart block.
6. As a caller on a tier without a pack, Create Station: the unentitled pack shows "Not included in your plan", the picker has the note "Some tool packs aren't included in your plan. View plans", and the link lands on Settings → Billing — manual (needs a tier without a builtin pack)
7. With a bulk job running against a portal's station, the chat input is disabled with the job reason shown, Send's tooltip names it, and Cancel is disabled — manual (needs a long job)

## Out of scope

- Data, connector, org and access surfaces (#689, #691).
- Any server authorization change. Decision 1 adds a *read* of an existing rule, not a new rule.
- Per-pin capabilities inside the portal session (`pinnedBlocks` is the caller's own).
