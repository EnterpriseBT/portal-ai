# tool-authorization-gate — Smoke Suite

Manual smoke test for [#629](https://github.com/EnterpriseBT/portal-ai/issues/629) — the per-caller, per-object **tool-authorization gate** on every write the portal agent attempts, plus the **`rbac_management`** built-in toolpack (the agent-facing companion to the RBAC admin UI). **Branch under test:** `feat/629-tool-authorization-gate` (PR [#631](https://github.com/EnterpriseBT/portal-ai/pull/631)).

Run **§Preflight** once. Then the walk is organized by axis: §1 pack presence, §2–§4 the `rbac_management` tools across the **entitlement × capability** matrix, §5 the data-plane per-object gate, §6 bulk admin-only, §7 cost ordering, §8 the coverage guard, §9 post-conditions. Sections are independent after preflight, but the **tier** a section assumes is called out in its header — set it before that section.

Steps tagged **— manual** are operator/DB/CLI actions a human runs (tier changes, identity swaps, `db:studio` inspection); the rest are **agent-walkable** in the browser (drive the portal chat, read the response, verify in the Access & Roles / Members UI). Because the agent is an LLM, "the agent calls tool X" is checked against the **tool-call panel** in the transcript, not inferred from prose — and a re-prompt is fair game if the model narrates instead of calling the tool.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/629-tool-authorization-gate && git pull --ff-only` — **manual**
- [ ] `npm install && npm run build --workspace=packages/core` — **manual**. `tool-capability.model.ts` + the registry gained the pack; the running API needs the rebuilt core dist.
- [ ] **No migration** — this PR ships none; do not run `db:migrate` for it.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`), no worker retry errors. — **manual**

### Fixtures & identities

The e2e fixture org (`e2e-fixture`) with its three roles is the substrate. Each identity is a real login captured by `e2e:auth`; swap the active one with `e2e:use`.

- [ ] **manual** — Re-seed the fixture so the pack is enabled on its station (this PR's `--all-toolpacks`):
  ```
  npm run --workspace @portalai/e2e e2e:seed
  ```
  Without this the station is `data_query`-only and **no** `rbac_management` tools appear — the whole suite would false-negative.
- [ ] **manual** — Confirm the three identities exist (`e2e:auth`, `e2e:auth:admin`, `e2e:auth:member` run at least once). Active identity swap: `npm run --workspace @portalai/e2e e2e:use <admin|member>` (owner is the plain `storageState.json`), then **close the browser and re-navigate** so the new `storageState` loads.

| Identity | Role | Has `member.role.assign`? | Swap |
|---|---|---|---|
| **owner** | owner | yes | default `storageState.json` |
| **admin** | admin | yes | `e2e:use admin` |
| **member** | member | no | `e2e:use member` |

### Tier axis (custom-RBAC entitlement)

The `rbac_management` **pack** is baseline on every tier, but the policy/role/group tools (incl. their `*_list` reads — `PolicyService.list` self-gates) require the **`customRbac` entitlement**, which only `enterprise` carries. `member_set_roles` and the grant tools do **not** need it. Set the fixture org's tier per section:

- [ ] **manual** — Find the org id: `portalai org list --env local --json` (or `org get`). Set enterprise: `portalai org set-tier <orgId> enterprise --env local --yes`; set standard: `portalai org set-tier <orgId> standard --env local --yes`. (`--env local` needs `DATABASE_URL` in the shell.)

### Reset between runs

- [ ] **manual** — `npm run db:studio` (from `apps/api/`) for the `audit_log`, `permission_policies`, `roles`, `permission_grants`, `entity_records`, `usage`, and `jobs` tables.
- [ ] **manual** — Custom policies/roles/groups the agent creates persist; delete leftovers in the Access & Roles UI (or DB) before re-running §2 so name-collision (`409`) doesn't mask a real result. Reset the tier to your starting point when done.

---

## §1 — Pack presence & entitlement baseline (AC4)

*Tier: standard is fine here.* As **owner**, open a portal session on the fixture station.

- [ ] The station's toolpack set includes **Access & Roles** — its chip renders the **admin-panel** icon (not the puzzle-piece custom-pack fallback). (Station toolpack picker / pack modal.)
- [ ] Prompt: **"What can you do to manage roles, groups, and sharing here?"** — the agent describes RBAC-admin abilities (create policies/roles/groups, assign members, share stations/pins), i.e. the `rbac_management` tools are in its toolset. It does **not** claim it cannot manage access at all.
- [ ] Prompt: **"List the roles in this organization."** On **standard** the agent relays a permission error naming the plan (custom-RBAC not included) — because `role_list` self-gates on the entitlement. (This is the baseline that §2 flips.)

---

## §2 — RBAC admin happy path (AC4) — **enterprise**, owner/admin

*Tier: set the org to `enterprise` first.* As **owner** (repeat any one step as **admin** to confirm admin parity).

- [ ] **Create a policy.** Prompt: **"Create a custom policy named 'Read Stations' that allows read on all stations."** The agent calls `policy_create`; result `success: true`. Verify: the policy appears in the **Access & Roles → Policies** UI, and `db:studio → permission_policies` has a `kind = custom` row named "Read Stations".
- [ ] **Create a role bundling it.** Prompt: **"Create a role called 'Station Reader' that uses the Read Stations policy."** Agent calls `role_list`/`policy_list` to resolve ids, then `role_create`. Verify the role shows in **Roles** with the policy attached (`roles` table row, `kind = custom`).
- [ ] **Create a group.** Prompt: **"Create a group named 'Analysts' with the Read Stations policy."** `group_create` → `success`. Verify in **Groups**.
- [ ] **Set group members.** Prompt: **"Put the member user (<member email>) in the Analysts group."** Agent resolves the user, calls `group_set_members`. Verify the member count / membership in the Groups UI.
- [ ] **Assign a role to a member.** Prompt: **"Give <member email> the Station Reader role in addition to their current roles."** Agent calls `role_list` then `member_set_roles` with the **complete** slug set (member keeps ≥1 system role). Verify in **Members** the member now carries Station Reader.
- [ ] **Set a member's groups.** Prompt: **"Set <member email>'s groups to just Analysts."** `member_set_groups` → `success`.
- [ ] **Share an object.** Prompt: **"Share this station with <member email> as read-only."** `grant_share` → `success`. Verify in the station **Share** dialog / `permission_grants` (a `read` grant for that principal). Then **"Who is this station shared with?"** → `grant_list` returns the member at read.
- [ ] **Revoke.** Prompt: **"Stop sharing this station with <member email>."** `grant_revoke` → the share disappears from the Share dialog.
- [ ] **Audit stamp — manual.** In `db:studio → audit_log`, every mutation above wrote a row (`policy.create`, `role.create`, `group.member.add`, …) with **`user_agent = 'portal-agent'`** and `source_ip = null` — the agent-initiated stamp — and `user_id` = the acting owner/admin.

---

## §3 — Capability denial: member lacks `member.role.assign` (AC1, AC2 — service-403 path)

*Tier: still `enterprise` (so the denial is the capability gate, not entitlement).* Swap to **member** (`e2e:use member`, re-navigate).

- [ ] Prompt: **"Create a role called 'Sneaky Admin' that can do everything."** The agent **relays a permission denial** (it does not create the role). Tool-call panel shows `role_create` returning a `TOOL_PERMISSION_DENIED` result — this is the service-thrown-403 → typed-refusal path (AC2, path b).
- [ ] Verify **no** "Sneaky Admin" row in `db:studio → roles`. — **manual**
- [ ] Prompt: **"Make me an owner."** (`member_set_roles` on self) → denied; the member's roles are unchanged in the **Members** UI.
- [ ] Prompt: **"Delete the Analysts group."** → denied; the group still exists.

---

## §4 — Entitlement denial + the availability≠entitlement split (AC4)

*Tier: set the org to `standard`.* As **owner** (has the capability, but the org lacks `customRbac`).

- [ ] **Custom-RBAC tools deny on entitlement.** Prompt: **"Create a policy that allows delete on all pins."** The agent relays a denial that names the **plan** ("your plan does not include custom RBAC authoring"), i.e. `RBAC_CUSTOM_NOT_ENTITLED` surfaced as `TOOL_PERMISSION_DENIED`. No policy created.
- [ ] Same for **"list the groups"** (`group_list` self-gates on entitlement) → plan denial.
- [ ] **But member-assignment still works on standard.** Prompt: **"List the members and give <member email> the member role only."** `member_set_roles` (gates on `member.role.assign` only, **not** `customRbac`) → `success`; the change shows in **Members**. This proves the pack is *available* and non-custom-RBAC ops work even where custom authoring isn't entitled.
- [ ] **And sharing still works on standard.** Prompt: **"Share this station with <member email> as read-write."** `grant_share` → `success` (gates on `resource.share`, not `customRbac`). Verify the grant, then revoke it.

---

## §5 — Data-plane per-object gate (AC1, AC2 — pre-flight `can` path)

*Tier-agnostic; standard is fine.* This exercises the **pre-flight** per-object authorization on the `entity_management` write tools (member write is `created_by_caller`; delete/share only on station/pin). Use an entity on the fixture station with at least one **owner-created** record and mapped columns.

As **owner**: create a record via the agent (**"Add a record to <entity>: …"**) so there's an owner-owned row. Note its `_record_id` (ask **"show me <entity> with its record ids"**). Then swap to **member**:

- [ ] **Member creates its own record — allowed.** Prompt: **"Add a record to <entity>: …"** → `entity_record_create` succeeds (new rows are caller-owned; the create check carries `createdBy = caller`). Confirm the row exists and its `created_by` = the member (`db:studio → entity_records`). — DB check **manual**; the create is agent-walkable.
- [ ] **Member updates its own record — allowed.** Prompt: **"Update the record I just added: set <field> to <value>."** → `entity_record_update` succeeds.
- [ ] **Member updates the owner's record — denied.** Prompt: **"Update record `<owner _record_id>`: set <field> to <value>."** → `TOOL_PERMISSION_DENIED`; the owner's row is unchanged. This is the pre-flight `can` on the resolved `createdBy` (AC2, path a).
- [ ] **Member deletes any record — denied.** Prompt: **"Delete record `<owner _record_id>`."** and **"Delete the record I added."** → both denied (MemberAccess grants no `delete` on `entity_record`). Rows unchanged.
- [ ] **Owner updates/deletes any record — allowed.** Swap back to **owner**; repeat an update + delete against the member-created row → both succeed.

---

## §6 — Bulk scan is admin-only (AC3)

*Tier-agnostic.* The bulk scanners (`bulk_geocode_records`, `transform_entity_records`) are whole-entity writes → a **class-level** admin gate. Use an entity the fixture has that supports geocoding (an address column) or a transform.

- [ ] **Member — denied.** As **member**, prompt: **"Geocode every record in <entity>."** (or **"Transform every record in <entity> to …"**). → `TOOL_PERMISSION_DENIED`; **no `bulk_geocode` / bulk-transform job row** appears in `db:studio → jobs`. A member's `created_by_caller` write does not satisfy the class-level check.
- [ ] **Owner/admin — allowed.** Swap to **owner**; same prompt → the job enqueues (a `bulk_geocode`/transform `jobs` row appears, `status` progresses). The whole-entity scan is admitted.
- [ ] **O(1) note — CI-covered.** The "one class-level check, zero per-row `resolveCreatedBy`" invariant is enforced by `permission-gate.service.test` (unit) and `rbac-tools.integration.test`; there is no browser-observable per-row behavior to walk. — **manual/skip**

---

## §7 — A denied call is never charged (AC6)

*Tier-agnostic.* Authorization runs **outside** (before) the cost gate, so a denied call never reaches cost admission.

- [ ] **manual** — Note the org's usage balance before: `db:studio → usage` (metered/expensive counters) or **Settings → Usage** in-app.
- [ ] As **member**, trigger a denied **expensive** tool: the §6 member bulk-geocode denial (bulk_geocode is `expensive`). The agent relays the permission denial.
- [ ] **manual** — Re-read the usage balance: it is **unchanged** — the denied call consumed no metered/expensive units (the gate short-circuited before admission). Contrast: an *admitted* expensive call (§6 owner path, if it runs to success) does move the balance.

---

## §8 — Coverage guard (AC5) — CI-covered

- [ ] **CI-covered / manual-optional.** "A new write tool that skips the authorization descriptor/wrapper fails the coverage guard" is enforced by `tools.service.test` (every `writes[]` tool has a `TOOL_AUTHORIZATION` descriptor or is a self-gating rbac tool). No browser step. Optional manual proof: add a throwaway `writes: ["entity_records"]` capability with no descriptor and run `cd apps/api && npm run test:unit -- --testPathPattern tools.service` → the guard fails; revert.

---

## §9 — Post-conditions & cleanup

- [ ] **manual** — `db:studio → jobs`: no `bulk_*` job left non-terminal after §6.
- [ ] **manual** — Delete the custom policies/roles/groups created in §2 (Access & Roles UI or DB), and revoke any lingering grants, so the fixture is clean for the next walk.
- [ ] **manual** — Reset the fixture org's tier to its starting value.
- [ ] **manual** — `audit_log` carries the agent-stamped rows for every successful mutation in §2 and §4 (nothing for the denied calls in §3/§4/§6 — denials write no data and no audit).

---

## Sign-off checklist

After every section above is verified against your own running stack:

- [ ] §1 — pack present with the right icon; baseline entitlement behavior.
- [ ] §2 — every `rbac_management` tool succeeds for owner/admin on enterprise; audit rows stamped `portal-agent`.
- [ ] §3 — a member is denied every custom-RBAC + assignment write with the typed refusal (service-403 path); nothing mutates.
- [ ] §4 — on standard, custom-RBAC tools deny on entitlement while `member_set_roles` + grants still succeed (availability ≠ entitlement).
- [ ] §5 — data-plane per-object gate: own-record writes allowed, another's write/any delete denied (pre-flight path); owner unrestricted.
- [ ] §6 — bulk scanners admin-only: member denied (no job row), owner/admin admitted.
- [ ] §7 — a denied expensive call leaves the usage balance unchanged.
- [ ] §8 — coverage guard acknowledged (CI-enforced).
- [ ] §9 — no non-terminal jobs; fixture + tier reset; audit trail present.
- [ ] ____-__-__ / __________ — confirmed against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread, or file follow-up bugs for any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Identity / tier:** <owner|admin|member> / <standard|enterprise>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <agent transcript + tool-call panel, screenshots, db row inspections>
**Repro:** <exact prompt + preconditions>
**Identifiers:** <org id / role id / grant id / job id / _record_id from db:studio>
```
