# action-gates-foundation — Adversarial Review

Adversarial probes for [#688](https://github.com/EnterpriseBT/portal-ai/issues/688). Per-object `capabilities` on 12 payload types, gated core CTAs, `decideActionGate` / `useActionGate`, `onPermissionDenied`, and the Views adoption. **Branch under test:** `feat/688-action-gates-foundation` (PR [#696](https://github.com/EnterpriseBT/portal-ai/pull/696)).

The premise every probe tests: **`capabilities` is advisory UI, and the server is the boundary.** Hiding or disabling an action must never be the thing that stops it. A probe that drives a hidden action anyway must be refused by the server, with nothing written.

Tags: untagged = agent-walkable in the browser · `— backend` = API/DB probe (curl with an identity's session token) · `— manual` = needs a human.

## Preflight

### Environment
- [ ] Same stack as `ACTION_GATES_FOUNDATION.smoke.md` §Preflight (branch checked out, core built, `npm run dev`, core Storybook on :7006).
- [ ] Session tokens for owner and member: the `access_token` in `packages/e2e/.auth/{owner,member}.storageState.json` (refresh with `e2e:auth:all`).

### Fixtures
- [ ] The smoke fixtures: **Owner Shared** (shared Read with member), **Owner Private**, and **Member Own** (`created_by` = member).
- [ ] An id from **another org**: `psql "$DATABASE_URL" -Atc "select id from curated_views where organization_id <> '<e2e-fixture org id>' and deleted is null limit 1"`, and the same for `stations` and `connector_entities`.

### Reset between runs
- [ ] Re-create any fixture a probe deleted. Revert any label a probe changed (only on a failure: every probe expects no write).

## §1 — Boundary & limit inputs
- [ ] `GET /api/field-mappings?include=connectorEntity&limit=100` and `GET /api/connector-entities?include=fieldMappings,tags` (owner): every top-level row carries `capabilities`, and no nested relation does. Variant payload shapes don't drop the field — backend
- [ ] `GET /api/curated-views?limit=1&offset=<total>` (past the end): `curatedViews: []`, 200, no error. `capabilities` attachment copes with an empty page — backend
- [ ] `GET /api/toolpacks?kind=custom` and `?search=zzz-no-match` (owner): 200 with `toolpacks: []` or only custom rows, each with `capabilities`. Filtering before the capability map doesn't crash on a missing `createdBy` — backend

## §2 — Malformed & injection input
- [ ] Mass-assignment: `PATCH /api/curated-views/<Owner Shared>` as **member** with `{"label":"pwned","capabilities":{"read":true,"write":true,"delete":true,"share":true}}`. Refused (403/404), and the label is unchanged in the DB. A client-sent `capabilities` grants nothing — backend
- [ ] `PATCH /api/curated-views/<Member Own>` as **member** with `{"label":"ok","capabilities":{"share":true}}`. Either 400 (strict body) or 200 with the label changed. Then `POST /api/grants` sharing it is still **403**: the injected field persisted nothing — backend

## §3 — Concurrency & races
- [ ] Stale capability: as **member**, open **Owner Shared** after the owner has granted Write (so Edit shows). Open Edit. As **owner**, revoke the grant. As **member**, Save. The server refuses (403), the dialog stays open showing the permission FormAlert, and after Cancel the Edit button is gone. The label is unchanged — manual (two live identities)
- [ ] Double-submit a delete: on **Member Own** (member), open Delete and press the confirm button twice fast. Exactly one DELETE succeeds, a second (if sent) is 404, and the UI navigates once with no error toast loop — manual

## §4 — Auth & permission boundaries (driving hidden actions anyway)
- [ ] As **member**, `DELETE /api/curated-views/<Owner Shared>` (Delete is hidden for them). Refused 403/404, and the view still lists for the owner — backend
- [ ] As **member**, `POST /api/grants` sharing **Owner Shared** with the admin at `read-write` (Share is hidden). Refused 403/404, and the owner's share list for the view is unchanged — backend
- [ ] As **owner**, `DELETE /api/toolpacks/builtin:data_query` (a builtin, `capabilities.write/delete:false`). Refused (4xx), and the toolpack still lists — backend
- [ ] As **member**, open **Owner Shared**'s page and, in DevTools, un-hide nothing: there's no Edit/Delete element to force. Then `GET /api/curated-views/<Owner Shared>` shows `write:false`. The page offers no editor route (`/views/<id>/edit` → not found / redirects); the editor is reachable only through the gated button

## §5 — Multi-tenant isolation
- [ ] As **owner** (e2e-fixture), `GET /api/curated-views/<other-org view id>`. 404 with no `capabilities` and no row data in the body — backend
- [ ] As **owner**, `GET /api/stations/<other-org station id>` and `GET /api/connector-entities/<other-org entity id>`. 404, and the body carries no `capabilities` or fields of the foreign row — backend
- [ ] As **owner**, the `/views` list contains no view from another org (compare the ids against the other-org query) — backend

## §6 — State & lifecycle abuse
- [ ] Deleted underneath: as **member**, open **Member Own**. As **owner** (API), `DELETE` it. As **member**, click Delete, or Edit then Save. The server 404s, and the UI shows a clean error (FormAlert or toast) with no crash. On reload the page reads "View not found" — manual
- [ ] Stale tab after a role change: change the member's org role so their own views' `capabilities` differ (or revoke a grant), then refocus the member's open `/views` tab. After the refetch (refocus or reload) the actions match the new `capabilities`. A stale tab acting on old capabilities is refused by the server, never honoured — manual
- [ ] Soft-deleted view by URL: after deleting a fixture view, `GET /api/curated-views/<id>` → 404 for both identities, and the list no longer carries it — backend

## §7 — Misuse sequences
- [ ] Keyboard on a disabled gate: in Storybook **Components/GatedButton → Disabled**, focus the button and press **Enter**, then **Space**. The Actions panel logs nothing (no `onClick`), and focus stays on the button
- [ ] Keyboard on an upsell: **Upsell** story, focus and press **Enter**. The Actions panel logs `onUpgrade` once and never `onClick`
- [ ] Disabled menu item: **Components/PageHeader → SecondaryActionsOnly** (its menu holds a disabled item, "A sync is running"). Open the menu, arrow onto the disabled item, press **Enter**. Its action doesn't run, and the menu stays open (it doesn't close as if the action ran)
- [ ] Hidden-everything menu: as **member** on `/views`, the **Owner Shared** card (every action hidden) renders **no** actions trigger. There's no empty menu to open

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / view / station / entity ids, identity):
