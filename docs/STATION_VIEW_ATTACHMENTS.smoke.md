# station-view-attachments — Smoke Suite

Manual smoke test for [#674](https://github.com/EnterpriseBT/portal-ai/issues/674). Curated views now attach to a station from the station form, beside connectors. Every attachment shows on the station detail page and the portal header, with a locked chip where you can't read it. One shared warning appears when views or connectors are missing, and the agent uses the same wording. **Branch under test:** `feat/674-station-view-attachments` (PR [#675](https://github.com/EnterpriseBT/portal-ai/pull/675)).

Run **§Preflight** once. After that, each section stands alone. Steps tagged `— backend` are API or DB checks outside the browser. Steps tagged `— manual` need a human eye.

---

## Preflight

### Environment

- [ ] `git checkout feat/674-station-view-attachments && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — the station contract and the shared content changed, and the API and web read core's dist. **There is no migration.**
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Check the API process started after the branch's last commit (`ps -o lstart= -p <tsx pid>`). A stale `:3001` serves old code.

### Identities

- [ ] Each identity has a session: `npm run --workspace @portalai/e2e e2e:auth` (owner), then `-- --identity admin` and `-- --identity member`.
- [ ] `npm run --workspace @portalai/e2e e2e:seed` — the `e2e-fixture` org with owner, admin and member. Every user below is in `e2e-fixture`; switch into it in-app if needed.

### Fixtures (as the **owner**, in `e2e-fixture`)

| Alias | What | How |
|---|---|---|
| **V-A** | A curated view the member **cannot** read | Views page → New view, label `Smoke view A`. Don't share it. |
| **V-B** | A curated view the member **can** read | New view, label `Smoke view B`. Share → member → **Read**. |
| **C-1** | A connector instance the owner can read | Any existing one in the fixture org. |
| **S** | The station under test | Created in §1. |

- [ ] Note the member's Views list: it shows `Smoke view B` and **not** `Smoke view A`. This proves the fixture boundary before anything else is tested.

### Reset between runs

- [ ] Delete station **S** (station detail → Delete) and recreate it in §1. Views V-A and V-B can stay.
- [ ] `npm run db:studio` (from `apps/api/`) for the `— backend` DB checks: tables `station_views`, `station_instances` and `audit_log`.

---

## §1 — Create a station with views (owner)

- [ ] Stations → **New Station**. Below **Connector Instances** there's a **Views** picker. While nothing is picked, its helper text reads exactly: "No views selected — this station won't have data to query until a view is attached."
- [ ] Type `Smoke` in Views. The options include `Smoke view A` and `Smoke view B`, and the list is searched as you type, not preloaded.
- [ ] Name it `Smoke attach`, pick **V-A** and **V-B**, leave connectors empty, and Create. The dialog closes and the station appears in the list.
- [ ] Open **S**. The **Views** row shows two primary chips, `Smoke view A` and `Smoke view B`. The **Connectors** row shows `—`.
- [ ] One warning shows under the header: "No connectors are attached to this station yet."
- [ ] `station_views` has two live rows (`deleted` null) for S. `audit_log` has one `station.attachments.change` row for S, whose `metadata.added.curatedViewIds` holds both view ids. — backend

## §2 — Edit attachments independently (owner)

- [ ] S → **Edit**. The Views picker is seeded with `Smoke view A` and `Smoke view B`, labelled by name, not by id.
- [ ] Add **C-1** under Connector Instances only, and Save. S now shows C-1 in Connectors, the views are unchanged, and the warning is gone.
- [ ] Edit → remove **V-B** from Views only → Save. Views shows only `Smoke view A`; C-1 is still attached.
- [ ] V-B's `station_views` row now has `deleted` and `deleted_by` set; it was soft-deleted, not removed. — backend
- [ ] Edit → add **V-B** back → Save. `station_views` has a **new** live row for V-B beside the soft-deleted one, and exactly one live row per view. — backend
- [ ] Edit → change nothing → Save. The dialog closes and no new `station.attachments.change` audit row appears. — backend

## §3 — Warnings on both surfaces (owner)

- [ ] Edit S → remove all views and connectors → Save. Station detail shows `—` in both rows and **one** warning: "No views or connectors are attached to this station yet."
- [ ] **Open Portal** on S. The portal header shows Views `—` and Connectors `—` plus the same single warning.
- [ ] Re-attach C-1 only. Both surfaces now show "No views are attached to this station yet."
- [ ] Re-attach V-A and V-B. Neither surface shows a warning.
- [ ] Narrow the viewport to phone width on the portal page. The warning stays visible while the session details are collapsed. — manual (layout judgment)

## §4 — A user who can read only some attachments (member)

Setup (owner): S has V-A, V-B and C-1 attached. On S → **Share** → member → **Read & write**.

- [ ] Switch to the **member** (`e2e:use member`, reload). Open S. Views shows `Smoke view B` as a normal chip and `Smoke view A` as an **error-outlined chip with a lock**, showing its real name.
- [ ] Hover the locked `Smoke view A` chip. The tooltip reads "You don't have access to this view". Clicking it does nothing.
- [ ] If the member can't read C-1, it shows the same way, with the tooltip "You don't have access to this connector". If C-1 is system-created, the member can read it and it shows normally. Note which case you saw.
- [ ] **Edit** S. The Views picker is seeded with **only** `Smoke view B`, and V-A isn't in it.
- [ ] Type `Smoke` in Views. Only `Smoke view B` is offered; `Smoke view A` never appears.
- [ ] Remove `Smoke view B` → Save. S still shows `Smoke view A` (locked) and no longer shows `Smoke view B`. The member couldn't detach what they can't read.
- [ ] The `station.attachments.change` row by the member has `metadata.removed.curatedViewIds` equal to `[V-B]` only. — backend
- [ ] The station GET as the member has a locked connector's `connectorInstance` with exactly `id` and `name`, and no connector anywhere carries `credentials` (DevTools → Network → `/api/stations/<S>?include=…`).

## §5 — Permission boundaries — backend

Use the member's bearer token (DevTools → any `/api` request → `Authorization`) with `curl -s -X <method> localhost:3001/api/... -H "Authorization: Bearer $T" -H 'content-type: application/json'`.

- [ ] Owner: on S, revoke the member's share and grant **Read** only. Member `PATCH /api/stations/<S>` `{"curatedViewIds":["<V-B>"]}` returns **403**, and `station_views` is unchanged.
- [ ] Restore **Read & write**. Member `PATCH` `{"curatedViewIds":["<V-B>","<V-A>"]}` returns **403** `STATION_ATTACHMENT_NOT_READABLE`, and nothing is written.
- [ ] Member `PATCH` `{"curatedViewIds":["00000000-0000-0000-0000-000000000000"]}` returns the **same** 403 code and the same message as the previous step, so it doesn't reveal whether the id exists.
- [ ] Member `POST /api/stations` `{"name":"Smoke denied","curatedViewIds":["<V-A>"]}` returns 403, and Stations has **no** "Smoke denied" row.
- [ ] Owner: share **V-A** with the member as **Read & write** but take S down to **Read**. Member `POST /api/curated-views/<V-A>/attach` `{"stationId":"<S>"}` returns **403**, because write on a view never grants attach.
- [ ] Restore S to **Read & write**, revoke the member's V-A share. Member `DELETE /api/curated-views/<V-A>/attach/<S>` returns **200**, and V-A's row is soft-deleted: detaching needs station write only.

## §6 — The agent uses the same sentences

- [ ] Owner: attach nothing to S (Edit → remove all). Open a portal on S and ask: **"Why can't you see any of my data?"** The answer contains "No views or connectors are attached to this station yet." and "Ask someone who can edit the station to attach them." (from `platform_help`).
- [ ] Attach C-1 only, start a **new** portal, and ask the same. The answer names "No views are attached to this station yet."
- [ ] Attach only **V-A**. As the **member** (S shared Read & write, V-A not readable), start a portal on S and ask the same question. The answer contains "You don't have access to any views on this station."
- [ ] The answer never names `Smoke view A`; the agent only ever gets counts. — manual (read the transcript)

## §7 — Lifecycle

- [ ] Owner: delete station S. Every `station_views` and `station_instances` row for S has `deleted` set, and none was hard-deleted. — backend
- [ ] Recreate S with V-A, attach V-A again from Edit (already attached), and Save. There is still exactly one live row for V-A. — backend

## §8 — Help content

- [ ] Help → Glossary → search `Curated View`. The term exists, says views are attached to stations and queried by users with read access, and links to the **Views** page.
- [ ] Glossary **Station** mentions views and lists Curated View as a related term.
- [ ] FAQ "What is a Station and why do I need one?" names views. FAQ "Why are the assistant's answers vague or missing my data?" says to "check that it has a view attached and shared with you".
- [ ] Getting started → "Create a station" reads "Bundle connector instances, views and the tool packs you want to use…".

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/view/connector ids):
