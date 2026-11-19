# custom-toolpack-station-names — Smoke Suite

Manual smoke test for [#1063](https://github.com/EnterpriseBT/portal-ai/issues/1063). Station reads now name their attached tool packs, so members see a custom pack's name instead of `org:<uuid>`. Custom packs also get the same plan treatment as built-ins: shown as not included in the plan, unselectable, and refused when added. **Branch under test:** `fix/1063-custom-toolpack-station-names` (PR [#1074](https://github.com/EnterpriseBT/portal-ai/pull/1074)).

Run **§Preflight** once, then **§0** to build the fixtures. After that, the sections can be walked in any order, except that §4 switches the org's plan and §5 assumes it's still switched.

**Step tags:**
- Untagged steps are agent-walkable through `/smoke-walk`.
- `— manual` needs a human.
- `— backend` is an API or CLI check with no UI.

For an API call, get a bearer token by copying the `Authorization` header from any `/api/...` request in the browser's devtools Network tab, signed in as the named user.

---

## Preflight

### Environment

- [ ] `git checkout fix/1063-custom-toolpack-station-names && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The station contract (`toolpacks`) and core content (`listPackNames`) changed, and the API and web read core's `dist`. There is **no migration**.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If it was already running, restart the API so it picks up the rebuilt core.
- [ ] In another terminal: `cd apps/api && npm run webhook:toolpack`. The mock pack server listens on `http://localhost:4100`. `apps/api/.env` has `TOOLPACK_DISABLE_SSRF_FILTER=true`, which local registration to localhost needs.

### Identities and org

- [ ] The `e2e-fixture` org has an **owner** and a **member** (`packages/e2e/README.md`). Switch between them with `npm run --workspace @portalai/e2e e2e:use <owner|member>`.
- [ ] Note the org id: `npx portalai org list --env local --json`.
- [ ] Pick two tiers from `SELECT slug, custom_toolpacks, builtin_toolpacks FROM tiers;` (run `npm run db:studio` in `apps/api/`, or psql):
  - **IN:** a tier with `custom_toolpacks = true`. On local, `standard` is usually this.
  - **OUT:** a tier with `custom_toolpacks = false`.

  Record both slugs here. If no tier has `false`, set one up locally (e.g. `UPDATE tiers SET custom_toolpacks = false WHERE slug = '<a spare slug>'`), and undo it in Reset.
- [ ] Put the org on **IN**: `npx portalai org set-tier <orgId> <IN> --env local --yes --allow-stripe-desync`.

### Reset between runs

- [ ] Put the org back on its original tier, and revert any tier row you edited.
- [ ] As owner, delete the stations named `Smoke 1063 …` and the packs `smoke_crm_1063` and `smoke_beta_1063`.

---

## §0 — Fixtures (as owner)

- [ ] Go to **Tool Packs → Register**. Register **`smoke_crm_1063`** (pack names are lowercase snake_case) with schema URL `http://localhost:4100/schema` and runtime URL `http://localhost:4100/runtime`. It appears in the custom list.
- [ ] Register **`smoke_beta_1063`** the same way. Both packs come from the same mock server, so their tools share names.
- [ ] Go to **Stations → New Station** and create **`Smoke 1063 Names`** with packs **Data Query**, **smoke_crm_1063** and **smoke_beta_1063**. Edit Station on it later warns about tool-name collisions, and a portal session on it fails; that is the collision guard, and none of the steps below need a session there.
- [ ] Create **`Smoke 1063 Excluded`** with packs **Web Search**, **Curated Views** and **smoke_crm_1063**, and no views or connectors. Curated Views carries `station_list`, which §7 needs.
- [ ] Share both stations with the member as **Can edit**.

## §1 — A member sees custom packs by name

- [ ] Switch to the member. Open **Smoke 1063 Names**. The Tool Packs row shows chips **Data Query**, **smoke_crm_1063** and **smoke_beta_1063**. No chip reads `org:`.
- [ ] Open the **Stations** list. The card for Smoke 1063 Names shows the same three names.
- [ ] From Smoke 1063 Names, open a portal (**Open Portal**) and expand the header details. The Tool Packs row shows the same three names.
- [ ] On the station page, click the **smoke_crm_1063** chip. Nothing opens (a member has no pack record to show), and the console shows no error beyond the expected `403` on `/api/toolpacks`.

## §2 — What a station read returns

- [ ] As the member, on the station page, find the `GET /api/stations/<id>` response in the Network tab. Check `payload.station.toolpacks`:
  - it equals `[{ref:"data_query",kind:"builtin",name:"Data Query"},{ref:"org:<crm-id>",kind:"custom",name:"smoke_crm_1063"},{ref:"org:<beta-id>",kind:"custom",name:"smoke_beta_1063"}]`, in `enabledToolpacks` order;
  - each item has exactly the keys `ref`, `kind` and `name`, with no endpoints, headers or secret status.
- [ ] On the Stations list, the `GET /api/stations?...` response has `toolpacks` on the Smoke 1063 Names row, with the same items.
- [ ] Another org's pack is never named — backend:
  - in psql, insert a `station_toolpacks` row on Smoke 1063 Names whose `organization_toolpack_id` is a pack from **another** org;
  - reload the station: `enabledToolpacks` lists that `org:<id>`, but `toolpacks` has no item for it;
  - delete the row afterwards.

## §3 — Edit Station, as the member

- [ ] As the member, open **Smoke 1063 Names → Edit**. The pack picker shows **Data Query** only. Below it reads **"smoke_crm_1063 and smoke_beta_1063 can't be changed here."**
- [ ] Remove **Data Query**, then add it back, and **Save**. The dialog closes, and the station still shows both custom packs.

## §4 — A plan without custom packs (as owner)

- [ ] As the owner, switch the org to **OUT**: `npx portalai org set-tier <orgId> <OUT> --env local --yes --allow-stripe-desync`.
- [ ] Reload **Smoke 1063 Names**. The **smoke_crm_1063** chip is muted (dashed). Its tooltip and accessible name read "smoke_crm_1063 — Not included in your plan".
- [ ] The Stations list shows the same muted smoke_crm_1063 chip.
- [ ] Open **Smoke 1063 Excluded**. The notice reads **"smoke_crm_1063 isn't included in your plan, so attaching a view won't make data available on this station."**
- [ ] Open **Smoke 1063 Excluded → Edit**, then open the pack picker:
  - **smoke_beta_1063** is listed but disabled, with "Not included in your plan";
  - the **"Some tool packs aren't included in your plan. View plans"** note shows under the picker;
  - the attached **smoke_crm_1063** chip is still there and removable.
- [ ] Remove **smoke_crm_1063** and **Save**. The save succeeds, and the station shows Web Search and Curated Views. Removing always works.
- [ ] **Stations → New Station**: smoke_crm_1063 and smoke_beta_1063 are listed under Custom, disabled, with "Not included in your plan", and the upgrade note shows.
- [ ] Re-adding an attached pack is a no-op — backend. With the owner's token:
  ```
  curl -s -X PATCH localhost:3001/api/stations/<Names id> \
    -H "Authorization: Bearer $T" -H 'content-type: application/json' \
    -d '{"toolPackChanges":{"add":["org:<crm-id>"]}}'
  ```
  It returns `200`, and `enabledToolpacks` is unchanged.
- [ ] Adding a new one is refused — backend. The same call with `org:<beta-id>` (not attached) returns `403 STATION_TOOLPACK_NOT_ENTITLED`, and the message names "smoke_beta_1063".
- [ ] One create refusal names both kinds — backend. With the owner's token, `POST /api/stations` with `{"name":"Smoke 1063 Refused","toolPacks":["<a built-in OUT excludes>","org:<beta-id>"]}` returns `403`, and the message names **both** packs (the built-in by its slug, e.g. `statistics`, as before this change). No station is created. If OUT includes every built-in, send only `org:<beta-id>`: the `403` names the pack.

## §5 — A member can't attach a pack they can't read (backend)

- [ ] Switch the org back to **IN**. With the **member's** token, `POST /api/stations` with `{"name":"Smoke 1063 Member","toolPacks":["data_query","org:<crm-id>"]}` returns `400 STATION_INVALID_TOOLPACK`, with the message `Unknown toolpack: "org:<crm-id>"`. It doesn't name the pack, and no station is created.

## §6 — A plan with custom packs is unchanged for the owner

- [ ] On **IN**, as owner, the **smoke_crm_1063** chip on Smoke 1063 Names is not muted. Clicking it opens the pack's details dialog with its tools.
- [ ] In **Edit**, the custom packs are selectable (not disabled). The upgrade note shows only if IN excludes some built-in.

## §7 — The agent names the packs

- [ ] As owner, open a portal on **Smoke 1063 Excluded** (it carries Curated Views; Names fails on the tool-name collision) and send **"List the stations I can see and the tool packs on each."** The answer names **smoke_crm_1063** and **smoke_beta_1063**, not `org:` ids. In the tool-call panel, `station_list` returns `toolpacks: [{ ref, name }, …]`.

## §8 — Help

- [ ] Open **Help → FAQ**, at the entry on plan changes for tool packs. It reads "…their tools aren't offered in portal sessions, and new registrations and adding them to a station are blocked until you're on a plan that includes them again."

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / station / pack ids):
