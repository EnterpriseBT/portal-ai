# help-pack-on-provisioned-stations — Smoke Suite

Manual smoke test for [#1044](https://github.com/EnterpriseBT/portal-ai/issues/1044):
- a new organization's Administrate and Playground stations start with the Help pack;
- the empty portal conversation has a generic body, plus a Help line where the pack is attached.

**Branch under test:** `feat/1044-help-pack-on-provisioned-stations` (PR [#1095](https://github.com/EnterpriseBT/portal-ai/pull/1095)).

Run **§Preflight** once; after that the sections are independent.
- **Untagged steps** are browser steps `/smoke-walk` can drive.
- **`— backend`** steps are a CLI command or a DB read the agent runs in a terminal.
- **`— manual`** steps need a human.

## Preflight

### Environment

- [ ] `git checkout feat/1044-help-pack-on-provisioned-stations && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. Core's help content changed. There's **no migration**.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Restart the API after the core build: nodemon watches `apps/api/src` only.

### Fixtures

| Alias | What |
|---|---|
| **qa** | `qa@portalsai.io`, the e2e owner, signed in through the e2e storageState. |
| **Old org** | qa's existing "My Organization" (`386466d9-…`), provisioned before this branch. Its stations don't have the Help pack. |
| **New org** | "Smoke 1044", created for this walk: `npx portalai org create --name "Smoke 1044" --owner-email qa@portalsai.io --env local --yes --json`. Note its `organizationId`. Switch qa into it from the org switcher. — backend |

### Reset between runs

- [ ] Delete the new org: `npx portalai org delete <newOrgId> --env local --yes`. Switch qa back to "My Organization". — backend

## §1 — A new organization's stations start with the Help pack (slice 1)

- [ ] `select s.name, array_agg(t.builtin_slug order by t.builtin_slug) from stations s join station_toolpacks t on t.station_id = s.id and t.deleted is null where s.organization_id = '<newOrgId>' and s.deleted is null group by s.name` returns exactly two rows:
  - Administrate `{help,rbac_management}`;
  - Playground `{data_query,entity_management,help,view_management}`.
  - — backend
- [ ] In the new org, open **Stations**. Administrate is marked as the default, and both stations show the **Help** pack, active (not "Inactive on your plan"). The new org is on the default tier, whose stored pack list lacks `help`.
- [ ] Open each station. Administrate's description ends "No data is attached here. You can also ask how Portals works." Playground's ends "…query the data in the same session. You can also ask how Portals works."

## §2 — Product questions on either station (slice 1)

- [ ] On **Administrate**, open a portal and ask *"How do I create a station?"*. The answer comes from the help content (a `platform_help` call; check `portal_messages` for the tool block — backend) and links into Help. It doesn't say to attach the Help pack.
- [ ] On **Playground**, open a portal and ask the same question. Same result.
- [ ] **The stations' own work is unchanged.** On Administrate ask *"Who are the members of this organization?"*: an access tool answers. On Playground ask *"What entities are on this station?"*: the data tools answer.

## §3 — The empty portal conversation (slice 2)

- [ ] **With Help.** A new portal on Playground (new org) shows:
  - the heading "Ready when you are";
  - the body: "Ask questions, explore your data, chart it and change it through conversation. Depending on this station's tool packs, the assistant can also answer questions about your organization, from its stations and views to who has access.";
  - **"Not sure where to start? Ask how anything in Portals works."**;
  - a **"Getting started with Portals →"** link;
  - "Learn what portal sessions can do →".
- [ ] Click **"Getting started with Portals →"**. Help opens on the **FAQ** tab with the **Getting Started** category, which lists "What is a Station and why do I need one?".
- [ ] **Without Help.** A new portal on Playground in the **old org** (no Help pack) shows the same heading and body, and neither the "Not sure where to start?" line nor the Getting Started link.
- [ ] **Detach.** In the new org, edit Playground, untick **Help** and save. Open a new portal there: the Help line and the Getting Started link are gone. Re-attach Help afterwards.

## §4 — Content (slice 3)

- [ ] **Help → Glossary → Station** reads "…the packs to build, share and query entities and views. Both also start with the Help pack, so you can ask how Portals works on either."
- [ ] **Help → FAQ → Getting Started → "What is a Station and why do I need one?"** ends "Both start with the Help pack, so you can ask either how Portals works."
- [ ] **Getting Started → "Create a station"** reads "…as examples. Both start with the Help pack for questions about how Portals works. A station is the workspace a portal runs against."

## §5 — Existing organizations and demos

- [ ] **Old org unchanged:** `select count(*) from station_toolpacks t join stations s on s.id = t.station_id where s.organization_id = '386466d9-affe-4938-97e6-0a8cedd91791' and t.builtin_slug = 'help' and t.deleted is null` is `0`. — backend
- [ ] **A reset org gets Help.** Reset the new org (`npx portalai org reset <newOrgId> --env local --yes`); §1's query returns the same two rows again. — backend
- [ ] **Demo station.** A demo created with `npx portalai demo create … --env local` has `help` on its Demo station, as well as on Administrate and Playground. — manual: it needs the demo toolpack URL and seeds about 10,000 rows. Skip with a note if it's not set up locally.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / click / command): · Identifiers (org / station / portal ids):
