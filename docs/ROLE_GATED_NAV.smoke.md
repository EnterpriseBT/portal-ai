# role-gated-nav — Smoke Suite

Manual smoke test for [#630](https://github.com/EnterpriseBT/portal-ai/issues/630) — permission-gated navigation & object access (pages gate nav; objects gate data; unauthorized surfaces everywhere). **Branch under test:** `feat/630-role-gated-nav` (PR [#636](https://github.com/EnterpriseBT/portal-ai/pull/636)).

Walk against your own running dev stack. Boxes stay unchecked until **you** confirm each — the agent (`/smoke-walk`) produces evidence, you check the box. Role-switching uses the `@portalai/e2e` multi-role fixture (`e2e:use <role>`, close+navigate to reload the session).

## Preflight

### Environment

- [ ] `git checkout feat/630-role-gated-nav && git pull --ff-only`
- [ ] `npm install`
- [ ] **`cd apps/api && npm run db:migrate`** — applies `0110` (member nav grants), `0111` (member data-delete), `0112` (view→curated_view). **Required** — `npm run dev` seeds but does not migrate, so without this a member's nav shows only Dashboard.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] The `@portalai/e2e` seeded org with **at least two roles**: an **owner/admin** and a plain **member** (`npm run --workspace @portalai/e2e e2e:seed`; `e2e:auth`). §6 also needs the **customRbac** entitlement on the org's tier to author custom policies (Settings → Access).
- [ ] At least **two connector instances created by different users** (one by the member, one by the owner/another) so list-filtering is observable — or create one as each role during the walk.
- [ ] One **entity group** and one **column definition** (admin-created) for the admin-managed-type checks.

### Reset between runs

- [ ] Read-only for most steps. §7 (member delete) and §6 (authoring custom policies) mutate — delete the created objects / revert the custom role after, or re-seed (`e2e:seed`).

## §1 — Sidebar nav gating (page-view)

- [ ] As a **member**, the sidebar shows **Dashboard, Stations, Pinned Results, Jobs** — and **not** Connectors, Entities, Entity Groups, Tags, Column Definitions, Toolpacks.
- [ ] As an **owner/admin**, the sidebar shows **all** items (Dashboard + the 9 gated pages).
- [ ] Nav order is Dashboard, then Stations, Pinned Results, Jobs, Connectors, Entities, Entity Groups, Tags, Column Definitions, Toolpacks (derived from `NAV_PAGE_IDS`).

## §2 — Route access (ForbiddenView on a gated page)

- [ ] As a **member**, navigate directly to `http://localhost:3000/connectors`. Expected: the **Forbidden** view ("You don't have permission…"), not the Connectors page, not a blank redirect.
- [ ] As a **member**, `http://localhost:3000/toolpacks` and `/entities` likewise show **Forbidden**.
- [ ] As an **owner/admin**, `/connectors` renders the Connectors page normally.
- [ ] As a **member**, `/` (Dashboard) always renders (un-gated safe landing).

## §3 — List filtering (object read)

- [ ] As **member A**, open a page you *can* see whose list you partly own — e.g. create a connector as member A, then as **owner** open **Connectors → Connected**: the owner sees **all** instances; as member A (if granted a custom `view page:connectors`, or verify via the API in §8) the list shows **only member A's own + system** instances, never member B's.
- [ ] As an **owner/admin**, the Connectors **Connected** tab lists every instance; **Entities**, **Tags**, **Entity Groups**, **Column Definitions** lists populate.

## §4 — Connectors tabs (object read + UnauthorizedState) — some steps `— manual`

- [ ] As an **owner/admin**, Connectors shows **both** tabs — **Connected** (instances) and **Catalog** (definitions) — both populated.
- [ ] **(custom role) — manual:** author a role with `view page:connectors` + `read connector_instance` but **no** `read connector_definition` (§6). As that user, the Connectors page shows both tabs; **Catalog** renders an **"You don't have permission to view the connector catalog."** panel while **Connected** works. (Requires authoring + assigning the role, then re-login as that user.)

## §5 — Object detail & sibling routes (404 / 403)

- [ ] As **member A**, direct-nav to another member's connector detail `/connectors/<member-B-instance-id>` → **not found / 404** surface (invisible == absent). Your own instance's detail opens.
- [ ] **— manual (API):** as member A, `GET /api/connector-instances/<member-B-id>/impact` and `/running-jobs` return **404**; `POST …/sync` returns **403**. (Use the browser network tab or an authed curl.)
- [ ] **— manual (API):** as member A, `POST /api/jobs/<a-job-you-didn't-start>/cancel` returns **403** ("You can only cancel jobs you started"); a job **you** started cancels.

## §6 — Custom-policy authoring (StatementEditor modal)

- [ ] As **owner/admin**, Settings → **Access** → author/edit a custom policy. In the statement editor, set **Resource = `page`**, **Scope = Specific objects**: the picker offers a **fixed list of page ids** (stations, connectors, …), not a name search. Save succeeds.
- [ ] Open the **MemberAccess** system policy (read-only) in the editor: its `view page:*` rows show their page id as the scope (**not empty**).
- [ ] **Subset gating — manual:** author a role with `view page:connectors` + `read connector_definition:<file-upload-id>` (Specific objects, one definition). Assign it; re-login. The Catalog tab shows **only file-upload**, no other definitions.
- [ ] **Deny-over-allow — manual:** confirm a `deny read connector_instance` (class) + `allow read connector_instance:<id>` results in **no** access to that instance (deny wins), while an independent `view page:connectors` still shows the page.
- [ ] `curated_view` (not `view`) appears in the Resource dropdown; there is no bare `view` resource type.

## §7 — Member deletes their own data objects

- [ ] As **member A**, create a connector instance, then **delete** it → succeeds (member controls what they create).
- [ ] As **member A**, attempt to delete another member's / the owner's connector instance (via its detail if reachable, or API) → **404/403** (not your own).

## §8 — Current-org payload — `— manual (API)`

- [ ] `GET /api/organization/current` (authed) returns **`pagePermissions`** (per nav page id → bool) and **`resourcePermissions`** (`{read,write,delete}` per object type). As a member: `pagePermissions.stations=true`, `connectors=false`; `resourcePermissions.connector_instance={read,write,delete:true}`, `entity_group` all false. As owner: all true.

## §9 — Existing-org backfill — `— manual (DB)`

- [ ] In `db:studio` (or psql), the `permission_statements` for an **existing** org's `MemberAccess` policy include `view page:{stations,pinned,jobs}`, unconditional `read job`, and `delete <data-type> created_by_caller`; there are **no** `resource_type='view'` rows (all renamed to `curated_view`).

## §10 — Error & edge cases

- [ ] A page whose current-org query is still loading renders **optimistically** (no blank flash on an allowed page); once loaded, a denied page flips to Forbidden.
- [ ] With the org's `customRbac` entitlement **off**, the Access authoring UI is unavailable/blocked (unchanged from #622) — the new `page`/`curated_view`/`connector_definition` vocabulary doesn't bypass it.
- [ ] Adding a hypothetical new `NAV_PAGE_ID` without a `PAGE_NAV` entry is a **compile error** (single-source-of-truth guard) — verify by inspection or a throwaway edit, not required to run.

## Sign-off

- [ ] Every section above verified
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / user / role / instance / job ids):
