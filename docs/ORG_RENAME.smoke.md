# org_rename — Smoke Suite

Manual smoke test for [#907](https://github.com/EnterpriseBT/portal-ai/issues/907): a caller with `write org` renames the organization from Settings → Organization. The rename is audited as `org.update`, copied to the Stripe customer best effort, and `PATCH /api/organization/:id` now has a strict body checked field by field. **Branch under test:** `feat/907-org-rename` (PR [#937](https://github.com/EnterpriseBT/portal-ai/pull/937)).

Run **§Preflight** once. The sections are independent after it, except that §4 reads the Activity rows §1 writes. Steps tagged `— manual` need a human; untagged steps are `/smoke-walk`-eligible, and steps tagged `— backend` are walked with `curl`/`psql` against the local stack.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, linking this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/907-org-rename && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`: core gained `OrganizationUpdateRequestSchema`, the `org.update` audit action and the `org.write` capability, and the API reads the built dist.
- [ ] No migration: `write org` and `org.update` widen text enums with no CHECK.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If the API was already running, touch an `apps/api/src` file so nodemon reloads the rebuilt core.

### Fixtures

The walk uses the e2e fixture org (`e2e-fixture`) with its three identities: owner, admin and member (`packages/e2e/README.md`).

- [ ] `npm run --workspace @portalai/e2e e2e:auth`, `e2e:auth:admin` and `e2e:auth:member`, then `e2e:seed`. Each identity's current org is `e2e-fixture` (switch in-app if not).
- [ ] Note the fixture org id (`portalai org list --env local --json`) as `<ORG>`, and its current name as `<NAME>`.
- [ ] For the backend steps, export a token per identity as `OWNER_TOKEN` / `ADMIN_TOKEN` / `MEMBER_TOKEN` (the Auth0 access token cached in each identity's `packages/e2e/.auth/*.storageState.json`).
- [ ] §5 needs a Stripe test-mode key in `apps/api/.env` and `stripe_customer_id` set on `<ORG>` (run a checkout once from Settings → Subscription & Billing, or set it to an existing test-mode customer in `db:studio`).

### Reset between runs

- [ ] Rename the org back to `<NAME>` from Settings (as owner). Audit rows are append-only and stay, so compare against the newest rows only.

---

## §1 — Rename as an owner (acceptance 1)

- [ ] As **owner**, open `http://localhost:3000/settings` → **Organization** tab. A **Rename** button (outlined, edit icon) sits beside the organization's name.
- [ ] Click **Rename**. A dialog titled **"Rename organization"** opens with the **Organization name** field focused and holding `<NAME>`.
- [ ] Clear it, type **`Smoke Rename A`**, press **Enter**. The button reads **Saving...** briefly, the dialog closes, and the heading on the Organization tab reads **Smoke Rename A** with no reload.
- [ ] Without reloading, the header's organization name and the org switcher menu both show **Smoke Rename A**.
- [ ] `db:studio` → `organizations` row `<ORG>`: `name = 'Smoke Rename A'`, `updated_by` = the owner's user id, and `default_station_id` is unchanged from before the rename (acceptance 3).

## §2 — Rename as an admin; a member sees no Rename (acceptances 1, 2)

- [ ] Switch to **admin** (`e2e:use admin`, restart the browser session). Settings → Organization shows **Rename**. Rename to **`Smoke Rename B`** with the **Save** button; the heading updates.
- [ ] Switch to **member** (`e2e:use member`). Settings → Organization shows the name **Smoke Rename B** and **no Rename button** (not a disabled one: it's absent).
- [ ] — backend: `curl -s -X PATCH localhost:3001/api/organization/<ORG> -H "Authorization: Bearer $MEMBER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Hijack"}'` answers **403** with `code: "PERMISSION_DENIED"` and `message: "You don't have permission to edit the organization."`. The name in `db:studio` is still `Smoke Rename B`.

## §3 — Dialog behaviour (acceptances 4, 5)

As **owner**, open the Rename dialog for each step:

- [ ] Clear the field and click **Cancel**: the dialog closes with no "Name is required" flash.
- [ ] Clear the field and click **Save**: the dialog stays open, the field shows **"Name is required"** and is outlined red (`aria-invalid="true"`). (Tab from the field lands on Cancel, and a blur toward the dialog's own controls deliberately shows no error, #789.)
- [ ] Paste a 121-character string (`aaaa…`, 121 × `a`): the field holds all 121 characters (not truncated). Save shows **"Name must be 120 characters or fewer"**, and nothing is sent (no PATCH in devtools → Network).
- [ ] Type **`   `** (spaces only) and press Enter: **"Name is required"**, no request.
- [ ] Leave the name as it is and click **Save**: the dialog closes and no PATCH is sent (devtools → Network).
- [ ] Server error with input kept — manual: stop the API (`Ctrl-C` on its process), rename to **`Smoke Offline`**, Save. The dialog stays open with a red FormAlert, the field still reads `Smoke Offline`, and Cancel and Escape work once the request settles. Restart the API.
- [ ] Can't be dismissed while pending — manual: throttle devtools → Network to **Slow 3G**, rename and Save, then immediately press **Escape** and click outside: the dialog stays open showing **Saving...** until the request finishes.

## §4 — Activity (acceptance 8)

- [ ] As **owner**, open Settings → **Activity**. The newest rows include **`org.update`** with a second line **`Renamed from "<NAME>" to "Smoke Rename A"`** (actor = owner's user id) and **`Renamed from "Smoke Rename A" to "Smoke Rename B"`** (actor = admin's user id), target `organization · <ORG>`.
- [ ] Rename to the current name with stray spaces — backend: `curl … -H "Authorization: Bearer $OWNER_TOKEN" -d '{"name":" Smoke Rename B "}'` answers 200, and **no new** `org.update` row appears in Activity (an unchanged name records nothing).
- [ ] Rename again from the dialog while the Activity tab was already loaded: switching back to Activity shows the new row (refresh if it lands a moment after the response; the audit write runs after it).

## §5 — Stripe customer name (acceptance 9) — manual

- [ ] With `stripe_customer_id` set (Preflight) and the API configured for Stripe test mode, rename to **`Smoke Stripe`**. In the Stripe test dashboard (or `stripe customers retrieve <cus_id>`), the customer's **name** is `Smoke Stripe` within a few seconds.
- [ ] Break Stripe: set `STRIPE_SECRET_KEY` in `apps/api/.env` to an invalid `sk_test_invalid`, restart the API, rename to **`Smoke Stripe Down`**. The rename succeeds (200, heading updates), and the API log carries a **warn** line "Failed to update the Stripe customer name after an organization rename — reconcile manually" with `organizationId` and `stripeCustomerId`. Restore the key and restart.

## §6 — Contract (acceptances 3, 4, 6, 7, 10) — backend

With `OWNER_TOKEN` and `-H 'Content-Type: application/json'` on each:

- [ ] `-d '{}'` → **400** `ORGANIZATION_INVALID_PAYLOAD`, message names the missing field ("Provide a name or a default station").
- [ ] `-d '{"name":"X","timezone":"UTC"}'` → **400** `ORGANIZATION_INVALID_PAYLOAD`, naming `timezone` as an unknown key.
- [ ] `-d '{"name":"   "}'` and a 121-character name → **400** `ORGANIZATION_INVALID_PAYLOAD`.
- [ ] Station-only: `-d '{"defaultStationId":null}'` → 200, and the name is unchanged in `db:studio`. With `$MEMBER_TOKEN` the same body → **403** (as #690). Put the default station back from the Stations page afterwards.
- [ ] Another org's id: `PATCH /api/organization/<some-other-org-id>` with `-d '{"bogus":true}'` → **404** `ORGANIZATION_NOT_FOUND` (not a 400: another org's id is never told about its body).
- [ ] Duplicate name (acceptance 6): rename `<ORG>` to the exact name of another org you belong to (`portalai org list --env local`) → **200**.
- [ ] Swagger: `http://localhost:3001/api/docs` → `PATCH /api/organization/{id}` shows the `OrganizationUpdateRequest` body (`name`, `defaultStationId`) and 200/400/403/404/500 responses.

## §7 — Delete confirmation follows the new name (acceptance 7)

- [ ] As **owner**, scroll Settings → Organization → **Danger zone**, click **Delete organization**: the field label reads **Type "<current name>" to confirm** (the name the last rename set). Type the **old** name `<NAME>`: the confirm button stays disabled. Cancel (do not delete).

## §8 — Help

- [ ] `http://localhost:3000/help` → FAQ → Organization lists **"How do I rename my organization?"** before "How do I delete my organization?", and its answer mentions Settings → Organization → Rename and "permission to edit the organization" (no role names).

## §9 — Access authoring (side effect of the new verb)

- [ ] As **owner**, Settings → **Access** → author a policy statement: choosing resource **org** offers verbs **delete** and **write**, with **delete** preselected.

---

## Sign-off

- [ ] Every section above verified
- [ ] Reset: org renamed back to `<NAME>`, Stripe key restored, default station restored
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / user / audit row ids):
