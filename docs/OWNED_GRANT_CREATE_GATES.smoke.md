# OWNED_GRANT_CREATE_GATES — Smoke Suite

Manual smoke test for [#708](https://github.com/EnterpriseBT/portal-ai/issues/708). Every Create in the app now decides from a server-computed `create` (each create route's own check) instead of the any-grant `write`. **Branch under test:** `fix/708-owned-grant-create-gates` (PR [#709](https://github.com/EnterpriseBT/portal-ai/pull/709)).

Untagged steps can be walked in the browser (`/smoke-walk`). `— manual` needs a human. `— backend` is an API or DB probe outside the browser.

**Acceptance criteria → sections:**
- AC1 (seeded member: Create View disabled with the hint) → §1
- AC2 (the owner: every Create enabled) → §2
- AC3 (custom owned-only grant: Create not enabled) → §3
- AC4 (instance-only grant: Create not enabled, route refuses) → §4
- AC5 (`create` agrees with each route) → §1.3, §3.3, §4.2, plus the CI matrix
- AC6 (no gate on `write`/`delete`; the guard) → §5
- AC7 (docs) → §5

## Preflight

### Environment

- [ ] `git checkout fix/708-owned-grant-create-gates && git pull --ff-only`
- [ ] `npm install`, then `npm run build --workspace @portalai/core` (the core contract changed). No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] `npm run --workspace @portalai/e2e e2e:auth:all`, then switch the admin and the member into **e2e-fixture** (`POST /api/organization/switch`)

### Fixtures

- [ ] The e2e-fixture org's tier includes custom RBAC and custom toolpacks (the fixture's does).
- [ ] As **owner**, the org has at least one connector with an entity (for the curated-view and entity pages). Upload a sample CSV if it doesn't.
- [ ] Note the member's user id: `GET /api/organization/current` as the member, or the Members tab. — backend

### Reset between runs

- [ ] Delete the **smoke708** group, policy and role. Restore the member's role to **member**. Delete the station **smoke708 shared**.

## §1 — The seeded member (the bug that motivated #708)

- [ ] As **member**, open **Views**.
- [ ] Expected: **Create View** is `aria-disabled`. Hovering shows "Ask an owner or admin for access to create views", and clicking opens nothing.
- [ ] As **member**: `curl -s localhost:3001/api/organization/current -H "Authorization: Bearer <member token>" | jq '.payload.resourcePermissions.curated_view'` gives `{"read": true, "write": true, "delete": true, "create": false}`. — backend
- [ ] As **member**, open **Entities**, then a connector you own, then an entity you own:
  - **Create Entity** and **Create** (record) are enabled (owned creates);
  - **Connect** on **Connectors → Catalog** is enabled.

## §2 — The owner

- [ ] As **owner**, these are all enabled, not `aria-disabled`:
  - Create View on Views;
  - Create Tag on Tags;
  - Create Column Definition on Column Definitions;
  - Create Group on Entity Groups;
  - Register on Toolpacks;
  - Create Entity on Entities;
  - Connect on the Catalog.

## §3 — A custom owned-only grant (owner/admin-only types)

- [ ] As **owner**, go to **Settings → Access**. Create a policy **smoke708** with these statements, then a group **smoke708** containing the member, with the policy attached:
  - `allow read tag`, `allow read column_definition`, `allow read entity_group`, `allow read toolpack`;
  - `allow write tag` (Ownership: **Created by caller**);
  - `allow write column_definition` (Created by caller);
  - `allow write entity_group` (Created by caller);
  - `allow write toolpack` (Created by caller).
- [ ] As **member**, reload, then open **Tags**, **Column Definitions** and **Entity Groups**. Expected:
  - each **Create** is `aria-disabled`;
  - the hovers read "Ask for access to create tags", "…column definitions" and "…entity groups";
  - **Toolpacks → Register** is absent (no permission, and Register has no plausible-primary state).
- [ ] As **member**: `resourcePermissions.tag` gives `write: true, create: false`, and `curl -X POST localhost:3001/api/entity-tags -d '{"name":"smoke708"}' …` returns `403 INSUFFICIENT_ROLE`. — backend

## §4 — An instance-only grant

- [ ] As **owner**, go to **Settings → Access**. Create a role **smoke708 bare** with **no** policies, and make it the member's only role (Members tab → roles).
- [ ] As **owner**, create a station **smoke708 shared** and share it with the member with **write**.
- [ ] As **member**: `resourcePermissions.station` gives `write: true, create: false`, and `POST /api/stations` `{"name":"x"}` returns `403 INSUFFICIENT_ROLE`. — backend
- [ ] Restore the member's role to **member** (Reset).

## §5 — Guard and docs

- [ ] In the PR's checks, **Unit Tests** includes `action-gate.guard.test.ts` → "a create gate reads `create`, never `write`/`delete` (#708)" passing. — backend
- [ ] `CLAUDE.md` → "Action Affordances & Permissions" and `.github/copilot-instructions.md` both state: a create reads `canOnResource(type, "create")`, and never `write`/`delete`. — manual

## §6 — Error & edge cases

- [ ] While `GET /api/organization/current` is still loading on a hard reload of **Views**, Create View never flashes enabled. It's absent until permissions load (fail closed). — manual (timing)
- [ ] With the dev tools offline after load, the member's Create View stays disabled (no client-side fallback to `write`). — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / user / policy / group ids):
