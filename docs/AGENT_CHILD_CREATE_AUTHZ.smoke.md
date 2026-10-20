# objects-and-parts — Smoke Suite

Manual smoke test for [#829](https://github.com/EnterpriseBT/portal-ai/issues/829): records and field mappings are parts of their entity and the entity's permission governs them, an entity's create and delete also need write on its connector, curated views convey their projection, and `entity_record` / `field_mapping` are no longer permission types. **Branch under test:** `fix/829-agent-child-create-authz` (PR [#830](https://github.com/EnterpriseBT/portal-ai/pull/830)).

Run **§Preflight** once. After that the sections are independent. Steps tagged `— backend` are API/DB probes, not browser steps; `— manual` steps need a human.

---

## Preflight

### Environment

- [ ] `git checkout fix/829-agent-child-create-authz && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`: core's permission vocabulary and tool descriptors changed.
- [ ] `cd apps/api && npm run db:migrate && cd ../..`: migration **`0128_retire-part-permissions`** (data only) deletes statements and grants on `entity_record` / `field_mapping` and any `in_curated_view` grant. It applies cleanly. `npm run dev` seeds but doesn't migrate.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Fixtures

The `e2e-fixture` org (`npm run --workspace @portalai/e2e e2e:seed -- --all-toolpacks`), with the **owner** and **member** identities (`e2e:auth:all`; switch with `e2e:use <role>`, then reload the browser session).

| Alias | What | How |
|---|---|---|
| **OwnerEnt** | An entity the **owner** created, with ≥ 3 records, at least one created by the owner, and ≥ 2 field mappings (e.g. `name`, `salary`) | As owner, upload a small CSV through **Connectors → New → File upload** |
| **MemberEnt** | An entity the **member** created on their own connector | As member, upload a small CSV the same way |
| **DemoEnt** | A system-owned demo entity on the **Sandbox** connector | Provisioned with the org |
| **ReadPolicy** / **WritePolicy** | Two custom policies the owner authors in **Settings → Access**, each with one instance statement on **OwnerEnt**: `allow read entity` / `allow write entity` | Attach them to the member as the steps say; detach afterwards |
| **Station** | The fixture station, with the `entity_management` toolpack, OwnerEnt's connector attached and a curated view on OwnerEnt attached | As owner |

### Reset between runs

- [ ] Detach ReadPolicy / WritePolicy from the member. Delete any records, mappings and entities the walk created (or reseed the org).

---

## §1 — Reading parts follows the entity

- [ ] As **member**, no policy attached: open OwnerEnt's page (`/entities/<OwnerEnt id>`). **Expected:** the not-found state, not a records table.
- [ ] Attach **ReadPolicy** to the member and reload. **Expected:** the records table lists **every** OwnerEnt record, including the owner's. `GET /api/connector-entities/<id>/records/count` equals the owner's count.
- [ ] Open the column definition behind one of OwnerEnt's mappings (**Column definitions → `<col>`**). **Expected:** OwnerEnt's mapping appears in the Field Mappings list.
- [ ] On OwnerEnt, still with read only. **Expected:** no **New Record**, **Re-validate** or **Delete records** actions, and no Edit/Delete on rows or on the record detail page.

## §2 — Writing parts follows the entity

- [ ] Attach **WritePolicy** (keep ReadPolicy) and reload OwnerEnt. **Expected:** **New Record**, **Re-validate** and **Delete records** are offered, and so are Edit/Delete on a row the **owner** created.
- [ ] Edit an owner-created record (change one value) and save. **Expected:** saved with no error alert; the new value shows after reload.
- [ ] Create a record with **New Record**. **Expected:** it appears in the table.
- [ ] Delete the record you just created. **Expected:** it disappears.
- [ ] Detach WritePolicy, then as member `PATCH /api/connector-entities/<OwnerEnt>/records/<owner record>` with `{"data":{"name":"x"}}` — backend. **Expected:** `403 PERMISSION_DENIED`, record unchanged.
- [ ] Same request on an entity in **another org** (any id from a second org) — backend. **Expected:** `404 CONNECTOR_ENTITY_NOT_FOUND`.

## §3 — Entities and their connector

- [ ] As **member**, open the **Sandbox** connector page. **Expected:** **New entity** is not offered.
- [ ] Open the member's own connector. **Expected:** **New entity** is offered; creating one succeeds.
- [ ] Set MemberEnt's `connector_instance_id` to the Sandbox connector in `db:studio` (`connector_entities`) — backend. Then on MemberEnt's page **Expected:** **Edit** (rename) is offered and a rename saves; **Delete** is not offered. `DELETE /api/connector-entities/<MemberEnt>` → `403 PERMISSION_DENIED`. Restore the row afterwards.

## §4 — Default members and the Sandbox

- [ ] As **member**, open **DemoEnt**. **Expected:** records are readable; no New Record / Edit / Delete / Re-validate / Delete records.
- [ ] Open **MemberEnt**. **Expected:** every record action is offered.

## §5 — Curated views convey their projection

- [ ] As **owner**, create a view on OwnerEnt projecting `name` and `salary` with a filter (`salary > 0`), and share it **Read** with the member. As **member** (no ReadPolicy), open the view. **Expected:** both projected columns and their rows show; the filter isn't shown (only "Filtered").
- [ ] Re-share the view with **Edit** for the member. As member, open the view editor and change the filter. **Expected:** the dialog's error alert says the member doesn't have permission to read the entity; the filter is unchanged after reload.
- [ ] As member, rename the view (no filter or column change). **Expected:** saved.
- [ ] `select count(*) from permission_grants where condition = 'in_curated_view'` — backend. **Expected:** `0`, even after the shares above.

## §6 — Policy vocabulary

- [ ] As **owner**, **Settings → Access → New policy**, open the **Resource** dropdown. **Expected:** `entity` is listed; `entity_record` and `field_mapping` are not.
- [ ] `select count(*) from permission_statements where resource_type in ('entity_record','field_mapping')`, and the same on `permission_grants` — backend. **Expected:** `0` and `0`.

## §7 — Mapping picker and Create

- [ ] As **member** (no policies), open a column definition page and click **Create** under Field Mappings. Open the **Connector Entity** picker. **Expected:** MemberEnt is offered; OwnerEnt and DemoEnt are not.
- [ ] Test with a member who can write **no** entity. Either temporarily soft-delete MemberEnt's connector in `db:studio`, or use a member without one. **Expected:** **Create** is visible but disabled, and its tooltip reads "Ask for access to edit an entity".

## §8 — The agent follows the same rule

In a portal on **Station**, as **member**:

- [ ] No policies: "Add a record to `<OwnerEnt label>` with name Test." **Expected:** the agent says the entity wasn't found (`TOOL_TARGET_NOT_FOUND` in the tool result); no record is added.
- [ ] ReadPolicy only: the same prompt. **Expected:** the agent says the member doesn't have permission to edit that entity (`TOOL_PERMISSION_DENIED`); nothing is added.
- [ ] ReadPolicy + WritePolicy: the same prompt. **Expected:** the record is created; it shows on OwnerEnt's page.
- [ ] ReadPolicy only: "Add a field mapping `bonus` to `<OwnerEnt label>`." **Expected:** refused, and no `bonus` column appears in the entity's wide table.

## §9 — Error & edge cases

- [ ] Set one connector instance's `credentials` to an undecryptable string in `db:studio` — backend. As owner, open **Entities**. **Expected:** the list loads (no 500); permission checks don't read credentials. Restore the row.
- [ ] Two mappings that reference each other: one on MemberEnt, one on DemoEnt. Set `ref_entity_key` / `ref_normalized_key` on both in `db:studio`. As member, `DELETE /api/field-mappings/<MemberEnt mapping>` — backend. **Expected:** `403 PERMISSION_DENIED`; both mappings are unchanged.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/entity/record/policy ids):
