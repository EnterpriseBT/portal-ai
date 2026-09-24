# role-gated-nav — Adversarial Review

Adversarial probes for [#630](https://github.com/EnterpriseBT/portal-ai/issues/630) — permission-gated navigation & object access. **Branch under test:** `feat/630-role-gated-nav` (PR [#636](https://github.com/EnterpriseBT/portal-ai/pull/636)).

Where smoke asks "do the criteria hold?", this asks "how does it break?". Each probe names the hostile action **and** the expected SAFE behavior — `verified` means the safe behavior was observed; a `mismatch` is a finding. You never check a box; the walk produces evidence, you confirm.

## Preflight

### Environment
- [ ] `git checkout feat/630-role-gated-nav && git pull --ff-only && npm install`
- [ ] **`cd apps/api && npm run db:migrate`** (0110/0111/0112 — see smoke preflight)
- [ ] `npm run dev` (API :3001, web :3000)

### Fixtures
- [ ] `@portalai/e2e` org with an **owner/admin** and a **member**; the org's tier has **`customRbac`** (for §3). Two connector instances by different users; an entity group + column definition (admin-created); the file-upload connector definition present in the catalog.
- [ ] An authed request tool for `— backend` probes (browser network tab, or an authed `curl`/REST client with a member and an owner token).

### Reset between runs
- [ ] §3/§4 mutate policies + objects — revert custom roles / delete created objects, or re-seed (`e2e:seed`) between runs.

## §1 — Auth & permission boundaries

- [ ] **Empty-grant member (fail-closed).** A user whose role resolves to *no* grants (e.g. a fresh custom role with no statements): nav shows **only Dashboard**; every gated route → **Forbidden**; every list endpoint returns **empty**, never all rows. — SAFE: nothing leaks; no fail-open.
- [ ] **Toolpack write left open? — backend.** As a **member**, `POST /api/toolpacks` (register) and `PATCH`/`DELETE /api/toolpacks/:id`. — SAFE: refused (the tier/entitlement gate blocks; the class read gate is GET-only). A **finding** if a member with a `customToolpacks` tier can register/mutate a toolpack despite having no `toolpack` grant. *(Known scope note: toolpack mutations are tier-gated, not RBAC-gated — confirm the tier gate actually holds.)*
- [ ] **Disabled affordance driven anyway — backend.** A member whose nav hides Connectors still `POST`s to create a connector instance directly. — SAFE: allowed only for their *own* (`created_by_caller` write); it does not grant them read of others'.
- [ ] **`resource.view` on a non-page object.** Hand-craft `can("resource.view", {type:"connector_instance"})` semantics via a custom `view connector_instance` grant. — SAFE: it gates nothing real (no route reads `view` on an object); no accidental data exposure.

## §2 — Multi-tenant isolation (`— backend`)

- [ ] **Cross-org id on every gated connector route.** As member A (org 1), send org-2 instance ids to: `GET /connector-instances/:id`, `/:id/impact`, `/:id/running-jobs`, `POST /:id/sync`, `/:id/test-connection`, `PATCH`, `DELETE`. — SAFE: **404** (reads) / **403|404** (writes) on every one; no counts, config, or credentials returned; nothing mutated. (Org-scope guard runs before the permission check.)
- [ ] **Cross-org job cancel.** As member A, `POST /api/jobs/<org-2-job-id>/cancel`. — SAFE: **404**, the org-2 job keeps running.
- [ ] **Cross-org column-definition impact.** `GET /api/column-definitions/<org-2-id>/impact` as member A. — SAFE: **404**, no counts leaked.
- [ ] **Cross-org authoring resolve.** As an org-1 admin, author `read connector_instance:<org-2-instance-id>` in a custom policy. — SAFE: **RBAC_POLICY_EXCEEDS_BOUNDARY** (resolveCreatedBy rejects the cross-org object); the grant is not saved.

## §3 — Custom-policy authoring abuse

- [ ] **Grant beyond your own access — manual.** As an **admin** (who is denied `manage billing`), author a role/policy granting `manage billing`. — SAFE: **RBAC_POLICY_EXCEEDS_BOUNDARY**; not saved.
- [ ] **Page grant you don't hold — manual.** As a principal holding only `view page:stations`, author (if you can author at all) `view page:connectors`. — SAFE: rejected (the ownershipless class-probe requires you hold `view page:connectors` / `* *`).
- [ ] **Deny-over-allow trap (the subset gotcha) — manual.** Author `deny read connector_instance` (class) **and** `allow read connector_instance:<id-X>`. As that user, open Connectors → Connected. — SAFE: instance X is **NOT** visible (explicit deny wins over the instance allow); the list is empty. Confirms you can't "allow a subset out of a class deny".
- [ ] **Allow-list subset — manual.** Author `view page:connectors` + `read connector_definition:<file-upload-id>` **only** (no class read). Catalog tab shows **only file-upload**; Connected shows the member's own instances filtered by their `connector_instance` read. — SAFE: no over-grant (not the whole catalog), no under-grant (file-upload is visible).
- [ ] **Deny-list subset — manual.** Author `read connector_definition` (class) + `deny read connector_definition:<file-upload-id>`. Catalog shows **all except file-upload**.
- [ ] **`created_by_system`-only role — manual.** Author `read column_definition created_by_system` (no `created_by_caller`). As that user on a page granting `view page:column_definitions`: the list shows the **system** column definitions and the surface is **not** an unauthorized panel (resourcePermissions reports read via `canPerformAny`). — SAFE: the honest surface, data not hidden.
- [ ] **Hostile resourceId in a page grant — backend.** Author (via API) `view page:<not-a-real-page-id>` or a page id with junk. — SAFE: accepted but **inert** (matches no nav page); no crash, no privilege gained.

## §4 — State & lifecycle abuse

- [ ] **Revoked grant, stale session.** Member has `view page:connectors`; an admin revokes it while the member is on `/connectors`. The member reloads (or the current-org query refetches). — SAFE: nav drops Connectors and the route flips to **Forbidden**; the server had been enforcing per-object throughout regardless of the cached FE map.
- [ ] **Soft-deleted object — backend.** Soft-delete a connector instance, then request its detail / impact by id as its owner. — SAFE: **404** (base repo excludes `deleted`); no gate is bypassed by a tombstone.
- [ ] **Migration idempotency / stale `view` rows — backend/DB.** Re-run `npm run db:migrate`; then query `permission_statements` for any `resource_type='view'`. — SAFE: **zero** `view`-type rows (all `curated_view`); loadSet resolves cleanly; re-running 0110/0111/0112 changes nothing (idempotent).
- [ ] **Optimistic-load window.** Throttle the network; open a **denied** admin page as a member. — SAFE: the page may render for the load instant, then flips to **Forbidden** once known; the server returns empty/403 for its data throughout, so nothing sensitive paints.

## §5 — Malformed & boundary input (`— backend`)

- [ ] **Malformed `include`/query on a gated list** (oversized string, wrong type, `include=` garbage) as a member. — SAFE: normal 400/ignored; the visibility predicate still applies (no filter bypass).
- [ ] **Instance-only grant, huge id set.** Author a role with hundreds of `read connector_instance:<id>` instance grants. As that user, the list loads scoped to exactly those ids. — SAFE: correct `id IN (...)` filter, no error, no other rows.

## §6 — Concurrency & races

- [ ] **N/A — RBAC in this change is read-time** (`loadSet` per request, in-memory resolve). There is no check-then-act mutation the change introduces; the seed/backfill are idempotent `ON CONFLICT DO NOTHING`. No concurrency probe applies.

## Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / user / role / instance / job ids):
