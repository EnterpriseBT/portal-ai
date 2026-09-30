# resolve_identity view scoping — Smoke Suite

This is the manual smoke test for [#658](https://github.com/EnterpriseBT/portal-ai/issues/658) and the folded-in [#651](https://github.com/EnterpriseBT/portal-ai/issues/651). It covers three changes:
- `resolve_identity` now reads through the caller's curated views (one match per view, keyed by `viewKey`, readable columns only, capped at 100, with `truncated`).
- Entity groups are hidden when the caller can't read a link column.
- `GET /entity-groups/:id/resolve` applies `entity_record` visibility.

**Branch under test:** `fix/658-resolve-identity-view-scoping` (PR [#659](https://github.com/EnterpriseBT/portal-ai/pull/659)).

Run **§Preflight** once. After that, the sections are independent, except that §3–§5 continue the fixture state §2 leaves. This file **supersedes the `## Smoke` section of `docs/ENTITY_GROUP_LINK_COLUMN_SCOPE.condensed.md`** (#651), which is covered in §1 here.

Tags: untagged steps are agent-walkable in the browser (`/smoke-walk`). `— manual` means a human confirms. `— backend` means an API/DB check outside the browser (walked with a bearer token from the e2e storageState, `@@auth0spajs@@…` → `body.access_token`, against the API on `:3001`).

Agent answers are non-deterministic, so each agent step asserts on **what the reply may and may not contain**, not on exact wording.

---

## Preflight

### Environment

- [ ] `git checkout fix/658-resolve-identity-view-scoping && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. The branch changed `builtin-toolpacks.ts` (the `resolve_identity` mirror), and the API reads it from core's `dist`. **There is no migration.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] The e2e identities are present: `npm run --workspace @portalai/e2e e2e:auth:all` (owner `qa@…`, member `e2e-member@…`). Switch the browser identity with `npm run --workspace @portalai/e2e e2e:use <member|owner>`, then close and re-open the browser.

### Fixtures (in the `e2e-fixture` org)

The e2e org has **no entity group** today, so this suite needs the fixture below. The agent walk seeds it with a throwaway script and **removes it afterwards**; every row is named or keyed `SMOKE-658` / `smoke658_*`. A human walker can build the same thing in the UI: Connectors, then upload two CSVs, then Entity Groups, Views and Access.

| Piece | Shape |
|---|---|
| Entities | `smoke658_customers`: `customer_id`, `name`. Rows: `C001 / "Alice (secret)"`, `C001 / "Bob"`. `smoke658_orders`: `customer_id`, `amount`. Row: `C001 / 999` |
| Entity group | **"SMOKE-658 Customer Orders"**. Members: customers (primary, link `customer_id`) and orders (link `customer_id`) |
| Station | **"SMOKE-658 Station"**, linked to the instance, with the **`data_query`** pack enabled; member access to the station |
| Views on the station | `smoke658_customer_ids` (projection `customer_id` only) · `smoke658_vip` (all columns, filter `name = "Bob"`) · `smoke658_orders_all` (all columns) · `smoke658_order_amounts` (projection `amount` only) · `smoke658_customers_full` (all columns) |
| Member grants | `read curated_view` on `smoke658_customer_ids`, `smoke658_vip` and `smoke658_orders_all` (plus the composed field-mapping grants). **Not** on `smoke658_customers_full` or `smoke658_order_amounts` |

### Reset between runs

- [ ] Re-run the seed script, which deletes and re-creates the `SMOKE-658` rows. For the cleanup, see Sign-off. Start each section in a **new** portal session unless the step says otherwise.

---

## §1 — Entity-group metadata respects the view projection (#651)

- [ ] As **member**, open a new portal session on **SMOKE-658 Station** and ask: *"What entity groups are on this station, and which column links each member?"* Expected: the reply names **"SMOKE-658 Customer Orders"** and the `customer_id` link on both members. The member can read `customer_id` through `smoke658_customer_ids` and `smoke658_orders_all`.
- [ ] As **owner**, remove the member's grant on `smoke658_orders_all` and grant `smoke658_order_amounts` instead (so the member's only orders view hides `customer_id`). As **member**, in a **new** session, ask the same question. Expected: the group is **not listed**, and the reply does not mention the orders link column (`customer_id` / "Customer ID") as a group link. It also doesn't invent a group.
- [ ] Restore the grants: `smoke658_orders_all` granted, `smoke658_order_amounts` not.

## §2 — resolve_identity returns only what the member's views allow (#658 core)

- [ ] As **member**, open a new session and ask: *"Use resolve_identity on the 'SMOKE-658 Customer Orders' group for customer C001, and list every match with its viewKey and every field you got back."* Expected:
  - one match each for `smoke658_customer_ids`, `smoke658_vip` and `smoke658_orders_all`;
  - `smoke658_customer_ids` shows only `_record_id`, `source_id` and `c_customer_id`;
  - `smoke658_vip` shows only Bob;
  - `smoke658_orders_all` shows `c_amount` 999.

  (AC1)
- [ ] In the same reply, **`Alice (secret)` appears nowhere**, and there is no match for `smoke658_customers_full` (not granted) or `smoke658_order_amounts` (not granted, and has no link column). (AC1, AC3)
- [ ] Follow up in the same session: *"Run sql_query: SELECT * FROM smoke658_customer_ids WHERE c_customer_id = 'C001'."* Expected: the same two rows with the same three columns. The resolve_identity records are a subset of what `sql_query` returns for that `viewKey`. (AC2)

## §3 — Revoking a grant takes effect on the next call

- [ ] Stay in the §2 session. As **owner** (in another browser, or through the API), revoke the member's grant on `smoke658_vip`. As **member**, in the **same** session, ask: *"Run resolve_identity for C001 on that group again."* Expected: there is **no `smoke658_vip` match**, while `smoke658_customer_ids` and `smoke658_orders_all` remain. (Grants are re-resolved on every call.)
- [ ] Re-grant `smoke658_vip`.

## §4 — No readable link column means no resolution (AC3, AC4)

- [ ] As **owner**, set the member's orders grants so their only orders view is `smoke658_order_amounts`, as in §1 step 2. As **member**, open a **new** session and ask: *"Resolve customer C001 across the SMOKE-658 Customer Orders entity group."* Expected: the agent says it has **no way to resolve that group** (the tool isn't offered, or it answers "Entity group not found"). It returns **no** orders data and does not fall back to guessing records.
- [ ] Restore the grants from §1 step 3.

## §5 — Owner / admin behaviour

- [ ] As **owner**, open a new session and ask the §2 prompt. Expected: one match per attached view the owner can read, including `smoke658_customers_full`, where **both** `Alice (secret)` and `Bob` appear. `smoke658_customer_ids` still shows only `c_customer_id`, because every view's projection still applies to the owner.

## §6 — REST `/entity-groups/:id/resolve` honours entity_record visibility (AC5)

- [ ] As **owner** in the browser, open a `smoke658_customers` record (Entities → the customers entity → the `C001` / Alice row). Expected: the related-records section lists the matching **Orders** record for `C001`, the same as before this branch.
- [ ] — backend. As **owner**: `GET /api/entity-groups/<group id>/resolve?linkValue=C001`. Expected: 200, with records for both members (2 customers, 1 order).
- [ ] — backend. As **member**, holding a temporary custom role that grants `read entity_group` (so the route's gate passes): the same request. Expected: 200, with `records: []` for **both** members. The seeded records were created by the owner, and a member reads only their own entity records. Remove the temporary role afterwards.

## §7 — Error & edge cases

- [ ] As **member**, ask: *"Run resolve_identity on a group called 'No Such Group' for C001."* Expected: the agent reports that the group isn't found. It doesn't pick the SMOKE-658 group, and it doesn't return data.
- [ ] As **member**, ask: *"Run resolve_identity on the SMOKE-658 Customer Orders group for the value `C001' OR '1'='1`."* Expected: the matches come back with **no records** and there's no error. The value is treated as a literal.
- [ ] — manual. CI: PR #659's **Unit Tests** job ran and passed `#658: every entity_records reader has a read-scoping classification (coverage guard)` and its stale-entry companion. (AC7. The guard was also proven, in the branch work, to fail on a missing, stale or mislabelled row.)

---

## Sign-off

- [ ] Every section above verified
- [ ] SMOKE-658 fixture removed: the group, members, views, grants, station, toolpack row, entities and instance, and the wide tables dropped. No `smoke658_*` / `SMOKE-658` rows remain.
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / request): · Identifiers (org / station / group / view ids, portal session id):
