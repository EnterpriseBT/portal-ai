# PER_OBJECT_ACTION_AFFORDANCES — Epic Smoke Suite

Epic-level smoke for [#684](https://github.com/EnterpriseBT/portal-ai/issues/684). Every action in the web app is shown, hidden, disabled or upsold from the caller's capabilities on **that** object. Refusals name the permission. A refused action re-fetches its object.

Each child passed its own smoke and adversarial gates on its branch: #688 → PR #696, #689 → #707, #690 → #697, #691 → #700, #708 → #709, #711 → #712. This suite checks the **epic's acceptance criteria end to end**, on the integrated branch, and where children meet: a #688 gate rendering a #708 create capability with #711 copy, and a #690 station refusal that #711 re-fetches. **Branch under test:** `epic/per-object-action-affordances` (final PR to `main`: to be opened at close-out).

Untagged steps can be walked in the browser (`/smoke-walk`). `— backend` is an API or DB probe. `— manual` needs a human.

**Epic acceptance criteria → sections:**
- AC1 (an action the grants never allow isn't rendered; an all-hidden menu hides its trigger; read-only vs writable views) → §1
- AC2 (tier → visible with upgrade; state → `aria-disabled`, focusable, tooltip naming the reason) → §4, §5
- AC3 (per-object capabilities equal what the server enforces) → §7 (CI agreement suites) plus §1.6 spot check
- AC4 (a read-only caller never reaches an editable form) → §2
- AC5 (revoked mid-session: the refusal surfaces, then the affordance is gone) → §6
- AC6 (audit table complete) and AC7 (`CLAUDE.md` + mirror) → §7
- Cross-child: create gates (#708) with permission-named hints (#711) → §3; org and access surfaces (#691) driven by capabilities, not role → §8

## Preflight

### Environment

- [ ] `git checkout epic/per-object-action-affordances && git pull --ff-only`
- [ ] `npm install`, then `npm run build --workspace @portalai/core`. No new migration beyond what's on `main` (`npm run db:migrate --workspace @portalai/api` if your DB is behind).
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] `npm run --workspace @portalai/e2e e2e:auth:all`. Switch owner, admin and member into **e2e-fixture** (`POST /api/organization/switch`).

### Fixtures

- [ ] e2e-fixture is on the **enterprise** tier; the owner's personal org **My Organization** is on **standard** (for §4).
- [ ] e2e-fixture has the owner's views **Smoke Contours** and **Smoke Polygons** and the **Sandbox** connector (write flag on). Create them as owner if missing.
- [ ] Bearer tokens `$OWNER`, `$ADMIN`, `$MEMBER` from `packages/e2e/.auth/*.storageState.json`; the member's and admin's user ids. — backend
- [ ] As **owner**, share with the member (`POST /api/grants`):
  - **Smoke Contours** → `read`
  - **Smoke Polygons** → `read-write`
- [ ] As **owner**, create station **epic684** and share it with the member at `read-write`.
- [ ] As **member**, create a station **epic684-own** (the member's own).

### Reset between runs

- [ ] Revoke the two view shares. Delete **epic684** and **epic684-own**. Turn the Sandbox write flag back on. Restore the admin to `admin`. — backend

## §1 — Per-object affordances (#688, #690)

- [ ] As **member**, open **Views**. The **Smoke Contours** row shows no Edit, Share or Delete, and no row actions trigger at all if every item is hidden.
- [ ] Same list: the **Smoke Polygons** card (read-write) offers neither **Delete** (read-write never conveys delete) nor **Share** (not granted). List cards only ever carry Share and Delete; Edit lives on the view's page (§2.2).
- [ ] Open **Smoke Contours**. The page header shows no Edit, Share or Delete, and no "More actions" trigger.
- [ ] As **member**, open **Stations**. **epic684-own** offers Edit, Share and Delete; **epic684** (shared read-write) offers Edit only.
- [ ] As **owner**, open **Views**. Both views offer Edit, Share and Delete.
- [ ] `GET /api/curated-views/<Smoke Contours id>` as member → `capabilities: {read: true, write: false, delete: false, share: false}`; as owner → all true. — backend

## §2 — Read-only callers get read-only views (#688, #690)

- [ ] As **member**, on **Smoke Contours**, there is no way to open the editor: no Edit in the header, the row, or any menu. Navigating to the page renders it read-only.
- [ ] As **member**, on **Smoke Polygons** (read-write), **Edit** opens the editor. Cancel without saving. Write access is per object: Contours is read-only, Polygons editable, for the same caller.

## §3 — Create gates and their hints (#708 with #711)

- [ ] As **member**, open **Views**. **Create View** is `aria-disabled`, stays focusable, and its tooltip reads "Ask for access to create views". Clicking opens nothing. `GET /api/organization/current` as member gives `resourcePermissions.curated_view.create: false`.
- [ ] As **owner**, **Create View** is enabled and opens the create flow (cancel it).
- [ ] As **member**, **Stations → Create** is enabled (members create their own stations), and **epic684-own** exists from the fixtures to prove it.

## §4 — Tier: visible with the upgrade affordance (#688, #691)

- [ ] As **owner**, switch to **My Organization** (standard tier). Open **Settings → Access**. Custom-RBAC authoring is visible with an upgrade affordance, not hidden. Following it lands on **Settings → Billing**.
- [ ] Same org: **Toolpacks**. Registering a custom toolpack shows the upgrade affordance if the standard tier excludes custom toolpacks, not a dead button. Record what renders.
- [ ] Switch the owner back to **e2e-fixture**. The same actions render as plain enabled actions (enterprise tier).

## §5 — State: disabled, focusable, with a reason (#689)

- [ ] As **owner**, on the **Sandbox** connector page, turn off its **write** capability flag.
- [ ] **Create Entity** is now `aria-disabled`, focusable (Tab reaches it), and its tooltip reads "Writes are disabled on this connector". Clicking opens nothing.
- [ ] Turn the write flag back on. **Create Entity** is enabled again.

## §6 — Revoked mid-session (#688, #690, #711)

- [ ] As **member**, open **epic684** (read-write). Leave the page open.
- [ ] As **owner**, downgrade the member's share on **epic684** to `read`. — backend
- [ ] As **member**, on the open page, **Edit** → change the name to "epic684 renamed" → **Save**. Expected:
  - the dialog stays open, with one alert: "You don't have permission to edit this station. (PERMISSION_DENIED)";
  - after Cancel, the "More actions" trigger is gone;
  - the name is unchanged.
- [ ] Toast path. As **admin**, open **Settings → Members**. As **owner**, change the admin's roles to `member`. As the (former) admin, on the open page, change the member's **groups**. Expected:
  - an error toast reading "You don't have permission to manage roles and access.";
  - the member's groups are unchanged.
  - Restore the admin to `admin` afterwards.
  - (The Members page itself isn't re-fetched. That's the waived #711 §6.1 limit.)

## §7 — Contract, audit and convention (CI and docs)

- [ ] The epic branch's latest CI run is green, including the agreement suites: `object-capabilities.agreement.integration.test.ts` (per-object capabilities vs each mutation route) and `create-capability.agreement.integration.test.ts` (`create` vs each create route). — backend
- [ ] The guards are green: `action-gate.guard.test.ts` (`KNOWN_VIOLATIONS` empty), `permission-copy.guard.test.ts` (api and web), `toast-error-message.guard.test.ts` and `permission-denied-invalidation.guard.test.ts`. — backend
- [ ] `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`'s audit table: every non-conforming row is marked fixed by a child or filed. — manual
- [ ] `CLAUDE.md` → "Action Affordances & Permissions" and `.github/copilot-instructions.md` carry the convention:
  - per-object capabilities;
  - `create` for creates;
  - derived capabilities;
  - hide / disable / upsell precedence;
  - permission-named refusals;
  - `onPermissionDenied`.
  - — manual

## §8 — Organization surfaces follow capabilities, not role (#691, #711)

- [ ] As **member**, open **Settings**. **Members** shows **Invite member** (the member holds `member.invite` in e2e-fixture). It shows no **Remove** buttons and no role menus (no `member.remove` or `member.role.assign`).
- [ ] As **member**, the Danger Zone's **Delete organization** isn't offered, and **Activity** (the audit log) isn't shown (no `org.delete`, `org.audit.read`).
- [ ] As **admin**, **Members** shows Remove buttons and role menus. Danger Zone **Delete organization** isn't offered (admin lacks `org.delete`).

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/user/station/view ids, response body):
