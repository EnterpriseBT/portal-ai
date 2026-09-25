# group-member-editing — Smoke Suite

Manual smoke test for [#637](https://github.com/EnterpriseBT/portal-ai/issues/637) — a group's membership is now loadable and editable (a dedicated `GET /api/groups/:id/members`, the dialog seeds + saves membership on edit). **Branch under test:** `fix/637-group-member-editing` (PR [#639](https://github.com/EnterpriseBT/portal-ai/pull/639)).

## Preflight

### Environment

- [ ] `git checkout fix/637-group-member-editing && git pull --ff-only`
- [ ] `npm install`
- [ ] **Rebuild core** — this branch adds a core contract export (`GroupMembersResponse`): `npx turbo run build --filter=@portalai/core`. **No migration** (`memberUserIds` is derived at read time; no schema change).
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] The `@portalai/e2e` seeded org with **`customRbac`** on its tier (Settings → **Access** reachable) and an **owner/admin** login (`e2e:auth`).
- [ ] At least **two org members** (so the group's Members picker has options): the fixture owner + one added member. Add one via Settings → **Members** if needed.

### Reset between runs

- [ ] §2/§3 create + mutate groups → delete the created group (Access → Groups → delete) or re-seed (`e2e:seed`) between runs. §1 is read-only once a group exists.

## §1 — Load members on edit (acceptance: re-open shows members)

- [ ] As **owner/admin**, Settings → **Access** → **Groups** → **New group**, name it, add **one member** in the Members field, Save.
- [ ] Re-open that group via **Edit**. **Expected:** the Members field shows the member you added (a chip with their email) — **not** an empty field.

## §2 — Save members on edit (acceptance: edit persists to `user_group`)

- [ ] Edit the group from §1, **add a second member**, Save. Re-open → **both** members show.
- [ ] Edit again, **remove one member** (delete its chip), Save. Re-open → only the remaining member shows.
- [ ] (DB truth, optional) In `db:studio`, `user_group` for that group id has one live row (`deleted IS NULL`) per current member.

## §3 — Create with members still persists (acceptance)

- [ ] **New group** with **two members** selected, Save. Re-open → both members show (create path still persists membership).

## §4 — Members endpoint + gate — `— manual (API)`

- [ ] Authed `GET /api/organization`… then `GET /api/groups/<id>/members` returns `{ "userIds": [ … ] }` matching the group's members.
- [ ] `GET /api/groups/<a-group-id-from-another-org>/members` → **404** (no cross-tenant read).
- [ ] As a **plain member** (no owner/admin role, org without needing customRbac for this read) → `GET /api/groups/<id>/members` still returns **200** (the members-read gate is org membership, not the authoring gate). Contrast: `GET /api/groups/<id>` (detail) stays authoring-gated.

## §5 — Group list stays lean — `— backend (API)`

- [ ] `GET /api/groups` returns each group with `memberCount` but **no** member-id array (`GroupView` unchanged) — the list payload doesn't grow with membership size.

## §6 — Error & edge cases (the code-review fixes)

- [ ] **No wipe on save-before-seed:** open a group with members for **Edit**; while the members are still loading (throttle the network, or a slow read), **Save is disabled** until the members appear. `— manual` (timing).
- [ ] **Members-load error surfaced:** if `GET /api/groups/:id/members` fails (block it / force a 500), the dialog shows *"Couldn't load the current members — saving will leave membership unchanged"*, and a Save leaves the membership intact (no wipe). `— manual` (network fault injection).
- [ ] **Removal cascade:** add member M to a group; then Settings → **Members** → remove M from the org. Re-open the group (or `GET …/members`) → M is **gone** from the roster (no stale id), and the group still edits/saves without a `RBAC_GRANTEE_NOT_MEMBER` error.

## Sign-off

- [ ] Every section above verified
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / group / member ids):
