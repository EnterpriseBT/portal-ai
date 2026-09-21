# rbac-object-grants — Smoke Suite

Manual smoke test for [#621](https://github.com/EnterpriseBT/portal-ai/issues/621) — object grants + sharing: a `permission_grants` table the engine unions in, `assertWithinBoundary`, station/pin object-enforcement wiring, the `/api/grants` API, member own-object `delete`/`share` seed+backfill, and the `ShareDialog`. **Branch under test:** `feat/621-rbac-object-grants` (PR [#625](https://github.com/EnterpriseBT/portal-ai/pull/625)).

The walkthrough exercises three authenticated identities in one org — **owner**, **admin**, **member** — via the multi-user `@portalai/e2e` harness. Switch the active browser identity with `npm run --workspace @portalai/e2e e2e:use <admin|member>` (owner is the plain `storageState.json`; `e2e:use owner`/removing the copy restores it), then in the MCP browser **`browser_close` + `browser_navigate`** so the new `storageState` is reloaded. `/smoke-walk` may drive the browser steps; DB-truth (`audit_log`, `permission_grants`) and cross-identity steps that need a re-auth are tagged where they need a human.

## Preflight

### Environment

- [ ] `git checkout feat/621-rbac-object-grants && git pull --ff-only`
- [ ] `npm install`
- [ ] **Migrate** — `cd apps/api && npm run db:migrate` applies `0105_add_permission_grants` (new table) + `0106_backfill-member-share-delete` (member `delete`/`share` on own station/pin for existing orgs). Confirm both print as applied.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] Seeded multi-user org — `npm run --workspace @portalai/e2e e2e:seed` provisions the **e2e-fixture** org with an owner, an admin, and a member. Auth sessions cached for all three: `npm run --workspace @portalai/e2e e2e:auth:all` (or `e2e:auth` / `e2e:auth:admin` / `e2e:auth:member` individually).
- [ ] As **owner**, create one station named **`Owner Station`** and pin one result named **`Owner Pin`**. As **member**, create one station named **`Member Station`** and pin one result named **`Member Pin`**. (These are the objects the sharing/visibility checks move around.)

### Reset between runs

- [ ] Grants hard-delete, so re-running is clean once you **revoke every share** created during the walk (or `e2e:seed` again for a fresh org). No tombstones to sweep.

## §1 — Share entry point & the ShareDialog (slice 4) — AC: sharing conveys exactly one object

- [ ] As **owner**, open `Owner Station`'s detail. **Expected:** a **Share** action is present (secondary action / kebab). It renders because the detail response's `canShare` is `true` for the owner.
- [ ] As **member**, open `Member Station`'s detail. **Expected:** **Share** is present (the member created it → `canShare` true, from the backfilled `share` on `created_by_caller`).
- [ ] As **member**, open a station the member did **not** create and has no grant on — if none is visible, this is covered by §2. **Expected (where such an object is reachable):** no **Share** action (`canShare` false).
- [ ] As **owner**, click **Share** on `Owner Station`. **Expected:** the ShareDialog opens titled `Share "Owner Station"`, with a **Share with** picker (options: **The team** + each member by email/name), an **Access** select (**Read** / **Read & write**, default Read), and a **Shared with** list reading **"Not shared with anyone yet."**
- [ ] In the dialog, pick the **member** as grantee, leave **Read**, click **Share**. **Expected:** a success toast; the **Shared with** list now shows the member's email with a **Read** chip and a **Revoke** button. Dialog stays open.

## §2 — Grantee scoped visibility & access levels (slices 1+3) — AC1, AC2

- [ ] Switch to **member** (`e2e:use member` → `browser_close` + `browser_navigate`). Open the stations list. **Expected:** `Member Station` **and** the just-shared `Owner Station` appear; **no other** owner/admin-only station appears (visibility reflects the grant — exactly the one shared object, no siblings).
- [ ] As **member**, open the shared `Owner Station` detail. **Expected:** it loads (read granted); an **edit/save** affordance is **absent or disabled** (read-only grant → no `resource.write`).
- [ ] Switch back to **owner**, re-open `Owner Station` → **Share**, change the member's access to **Read & write** (revoke + re-share as read-write, or the access control if present). **Expected:** the member's row now shows a **Read & write** chip.
- [ ] Switch to **member** again, open `Owner Station`, make an edit (e.g. rename) and save. **Expected:** the edit succeeds (read-write grant conveys `resource.write`).

## §3 — Owner controls own objects; grantee cannot delete/share/re-share (slice 2+3) — AC4, AC3

- [ ] As **member**, on `Member Station` (created by the member): **Expected:** **Delete** and **Share** both work — deleting removes it; sharing opens the dialog. (Recreate `Member Station` afterward for later sections.)
- [ ] As **member**, on the shared `Owner Station` (created by owner, shared to member): **Expected:** **no Delete** affordance, and **no Share** affordance (a grantee of a shared object gets neither — `canShare` false, delete not permitted). Attempting `DELETE /api/stations/:id` directly returns **403**. — manual (raw API call)
- [ ] Confirm the grantee cannot re-share: the absent Share action in the step above is the UI proof; a direct `POST /api/grants` as the member for `Owner Station` returns **403**. — manual (raw API call)

## §4 — Boundary & error cases (slice 2) — AC1 (deny), AC3

- [ ] **Grant-exceeds-boundary:** as an identity whose own allow-set does **not** include `resource.write` on the target (e.g. a member sharing an object they only have **read** on — set this up by having owner share `Owner Station` read-only to the member, then as member attempt to share it read-write is blocked by the missing Share affordance; for the API-level check) `POST /api/grants` requesting an access the granter can't themselves perform. **Expected:** **403 `RBAC_GRANT_EXCEEDS_BOUNDARY`**, surfaced in the dialog's `FormAlert` where reachable via UI. — manual (raw API call for the pure boundary case)
- [ ] **Grantee-not-member:** `POST /api/grants` with a `user` grantee whose `userId` is **not** an active member of the org. **Expected:** **400 `RBAC_GRANTEE_NOT_MEMBER`**. — manual (raw API call)
- [ ] **Explicit deny overrides a capable role:** as **owner**, share `Owner Station` to the **member** read-write, then (model/engine support a deny grant even though the dialog doesn't author one — OQ1) confirm that a `deny read` grant row for that member+station makes the station **disappear** from the member's list and 404/403 on direct fetch, even though the member's read-write grant would otherwise allow it (deny wins). — manual (requires a deny grant row, no UI authoring path)

## §5 — "The team" grant (slice 2+3) — team share = role:member

- [ ] As **owner**, Share `Owner Station` → grantee **The team** → **Read** → Share. **Expected:** success; the **Shared with** list shows a **The team** row (Read chip, revocable).
- [ ] Switch to **member**, open the stations list. **Expected:** `Owner Station` is visible to the member via the team grant (a `role:member`-principal grant), even without a per-user grant.
- [ ] Verify DB: `permission_grants` holds a row with `principal_type='role'`, `principal_id` = the org's base member role id (`sysrole:<org>:member`), `resource_type='station'`, `resource_id` = `Owner Station`'s id, `verb='read'`. — manual (DB inspection via `db:studio` / psql)

## §6 — Pinned-result (pin) parity (slice 3b) — AC across the pin resource type

- [ ] As **owner**, open `Owner Pin` detail → **Share** → share **Read** to the **member**. **Expected:** the pin ShareDialog behaves identically to the station one; success toast + Shared-with row.
- [ ] Switch to **member**, open the pinned-results list. **Expected:** `Owner Pin` and `Member Pin` appear; other owner-only pins do not. Opening `Owner Pin` loads read-only.
- [ ] As **member**, on `Member Pin` (own): **Delete** and **Share** work. On shared `Owner Pin`: no Delete/Share. — manual for the direct 403 checks

## §7 — Lifecycle & audit (slice 2) — AC5

- [ ] **Revoke:** as **owner**, on `Owner Station`'s ShareDialog, click **Revoke** on the member's row. **Expected:** success toast; row disappears. Switch to **member** → `Owner Station` no longer appears in the list / 403s on fetch.
- [ ] **Member removal cascades grants:** re-share `Owner Station` to the member, then as **owner/admin** remove the member from the org (Members settings). **Expected:** the member's grant rows are hard-deleted — `permission_grants` has no rows for that `principal_id`. — manual (DB inspection + settings action)
- [ ] **Object hardDelete cascades grants:** with a share active on a station, hard-delete that station (org-delete path or the hardDelete route). **Expected:** its `permission_grants` rows are gone. — manual (DB inspection)
- [ ] **Audit:** every share and revoke above wrote an `audit_log` row — `grant.create` on each share, `grant.revoke` on each revoke, attributed to the acting user. **Expected:** the counts match the shares/revokes performed. — manual (DB inspection: `audit_log.action`)

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/user/station/pin/grant ids):
