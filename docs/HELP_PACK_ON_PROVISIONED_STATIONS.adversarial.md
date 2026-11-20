# help-pack-on-provisioned-stations — Adversarial Review

Adversarial probes for [#1044](https://github.com/EnterpriseBT/portal-ai/issues/1044):
- new and reset organizations' Administrate and Playground stations start with the Help pack;
- the empty portal conversation shows a Help line where `enabledToolpacks` includes `help`.

**Branch under test:** `feat/1044-help-pack-on-provisioned-stations` (PR [#1095](https://github.com/EnterpriseBT/portal-ai/pull/1095)).

The surfaces these probes target:
- **provisioning (`PROVISIONED_STATIONS`, org create and reset):** can it double-attach, leak across orgs, or depend on the tier?
- **the empty state's `helpAvailable` flag:** can something other than the built-in `help` pack turn it on, and does it go stale?
- **the agent on a provisioned station:** does Help being always entitled hold when the tier grants nothing?

## Preflight

### Environment
- [ ] Same as `HELP_PACK_ON_PROVISIONED_STATIONS.smoke.md` §Preflight: branch checked out, core built, `npm run dev` up, and the API restarted after the core build.

### Fixtures
- [ ] **Org A:** `npx portalai org create --name "Adv 1044 A" --owner-email qa@portalsai.io --env local --yes --json`. Switch qa into it. — backend
- [ ] **Org B:** "My Organization" (`386466d9-…`), qa's existing org, provisioned before this branch.
- [ ] **A bearer token for qa**, for the API probes. Capture it from any `/api/*` request into a scratch file, and never print it.

### Reset between runs
- [ ] Delete org A (`npx portalai org delete <A> --env local --yes`), and switch qa back to org B. Delete any custom toolpack or tier a probe created (each probe names its undo). — backend

## §1 — Boundary & limit inputs
- [ ] **Add Help to a station that already has it.**
  - Probe: `PATCH /api/stations/<A's Playground>` with `{"toolPackChanges":{"add":["help"]}}`.
  - Expected SAFE: 200 (or a clean no-op), still exactly one live `help` row (`select count(*) from station_toolpacks where station_id='<id>' and builtin_slug='help' and deleted is null` = 1), and no duplicate chip.
  - — backend
- [ ] **A tier that grants no packs at all.**
  - Probe: point org A at a scratch tier whose `builtin_toolpacks` is `[]`, then open a portal on Administrate.
  - Expected SAFE: Help is still active, the empty state shows the Help line, and "How do I create a station?" is answered by `platform_help`. `rbac_management` reads as not in the plan.
  - Undo: put org A back on `standard`, then delete the scratch tier.
  - — backend + portal

## §2 — Malformed & injection input
- [ ] **A custom toolpack named "Help".**
  - Probe: register an org custom toolpack whose name is "Help" (any reachable schema endpoint, or a row inserted for the test), attach it to org A's Playground, and detach the built-in Help.
  - Expected SAFE: the empty state shows **no** Help line, because its ref is `org:<uuid>`, not `help`. The agent has no `platform_help`.
  - Undo: delete the custom pack, and re-attach Help.
  - — backend + portal

## §3 — Concurrency & races
- [ ] **Detach Help while a portal is open.**
  - Probe: open a new portal on org A's Playground; it shows the Help line. In a second tab, detach Help and save. Back in the portal, ask *"How do I create a station?"*.
  - Expected SAFE: the turn has no `platform_help`, since tools are built per turn, and the agent says to attach the Help tool pack. The empty state is already replaced by the conversation, so a stale Help line can't mislead after the first send. Nothing errors.
  - Re-attach Help afterwards.
- [ ] **Two resets back to back.**
  - Probe: run `npx portalai org reset <A> --env local --yes` twice in quick succession.
  - Expected SAFE: org A ends with exactly two stations, each with exactly one live `help` row (no duplicates), and the second run either succeeds or refuses cleanly.
  - — backend

## §4 — Auth & permission boundaries
- [ ] **A member who can't edit a provisioned station can't detach Help.**
  - Probe: as the e2e member in an org where Administrate is system-owned and not shared for edit, `PATCH` Administrate to remove `help`.
  - Expected SAFE: 403 (or 404 if unreadable), and the `help` row is unchanged.
  - — manual (member fixture token)
- [ ] **A portal on a station the caller can't read.**
  - Probe: open a portal whose station returns 404 for the caller, e.g. after its share is revoked.
  - Expected SAFE: the composer is locked with "This portal's station isn't available to you.", and there's **no** Help line, because an unreadable station reads as no pack.
  - — manual (needs a revoked share)

## §5 — Multi-tenant isolation
- [ ] **Provisioning and reset stay in their org.**
  - Probe: record org B's `help` count (`0`), then create and reset org A.
  - Expected SAFE: org B's count is still `0`, and its two stations' pack lists are unchanged.
  - — backend
- [ ] **Org A's station from org B.**
  - Probe: as qa in org B, `GET /api/stations/<A's Playground>`, and `POST /api/portals` on it.
  - Expected SAFE: 404 both times, with no `enabledToolpacks` leaked.
  - Note: qa is the owner of both orgs, but the API scopes to the current org. — backend

## §6 — State & lifecycle abuse
- [ ] **Reset after a user detached Help.**
  - Probe: detach Help from org A's Administrate, then `org reset <A>`.
  - Expected: Administrate has Help again, because a reset org matches a fresh one (#295). That's documented behavior; record it, not a defect.
  - — backend
- [ ] **A soft-deleted tier at provisioning.**
  - Probe: create a scratch tier, then soft-delete it; create org C on it (or move org A onto it, then `org reset`).
  - Expected SAFE: provisioning succeeds, falls back to the default tier, and both stations have `help` active.
  - Undo: delete org C and the scratch tier.
  - — backend

## §7 — Misuse sequences
- [ ] **A data question on Administrate.**
  - Probe: in org A, ask Administrate *"How many contacts do I have?"*.
  - Expected SAFE: the agent says this station has no data (from `station_context`'s status), with no invented numbers. It doesn't answer through `platform_help` as if it were product help.
- [ ] **Asking the product-help line's question literally.**
  - Probe: on a Help station, send *"Ask how anything in Portals works."* verbatim.
  - Expected SAFE: a sensible product orientation via `platform_help`, or a clarifying question. No error or loop.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro (exact prompt / request): · Identifiers (org / station / portal ids):
