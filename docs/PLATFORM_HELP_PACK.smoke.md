# platform-help-pack — Smoke Suite

Manual smoke test for [#1050](https://github.com/EnterpriseBT/portal-ai/issues/1050):
- platform help becomes the built-in **Help** pack, entitled on every tier and free;
- `station_context` always reports the organization, the plan and the station's status, and can list readable stations.

**Branch under test:** `feat/1050-platform-help-pack` (PR [#1090](https://github.com/EnterpriseBT/portal-ai/pull/1090)).

Run **§Preflight** once; after that the sections are independent. Untagged steps are browser steps `/smoke-walk` can drive. `— backend` steps are DB reads or edits the agent runs in a terminal. `— manual` steps need a human.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/1050-platform-help-pack && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. Core's registry changed (the `help` pack). There's **no migration**.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Restart the API after the core build: nodemon watches `apps/api/src` only.

### Fixtures

| Alias | What |
|---|---|
| **qa** | `qa@portalsai.io`, the e2e owner, signed in through the e2e storageState. Its current org is "My Organization" on **`standard`**, a tier whose **stored** pack list doesn't name `help`. That's on purpose: it shows the always-entitled rule. Check with `select builtin_toolpacks from tiers where slug='standard'`. — backend |
| **Playground** | qa's Playground station. Packs: Data Query, Entity Management, Curated Views; **no Help**. |
| **Administrate** | qa's Administrate station. Pack: Access & Roles. |

### Reset between runs

- [ ] Remove Help from any station a step added it to: Edit Station → untick Help → Save, or `delete from station_toolpacks where builtin_slug='help' and station_id='<id>'` — backend.

---

## §1 — The Help pack in the registry and the pickers (slice 1)

- [ ] Open **Toolpacks**. A **Help** pack is listed with the help icon (a question mark in a circle). Its details read *"Answers questions about how Portals works — portals, stations, connectors, entities, tool packs and pinned results — with links into Help."*, with one tool, `platform_help`.
- [ ] Open **Playground → Edit**. The tool-pack picker lists **Help** with its icon, and it is **enabled** (not "Not included in your plan"), even though `standard`'s stored list lacks it.

## §2 — Every tier is entitled to Help (slice 2)

- [ ] On Playground's Edit dialog, tick **Help** and Save. The save succeeds and Playground's page now shows the Help pack.
- [ ] **Settings → Billing** (or Subscription). Every plan card lists **Help** among its tool packs, and none shows it as an upgrade.
- [ ] In a portal on any station, Help is never listed under "Not included in this plan". Ask *"Which tool packs does my plan exclude?"*: the answer doesn't name Help.
- [ ] `GET http://localhost:3001/api/public/site-config` lists `"help"` in every tier's `builtinToolpacks`. — backend
- [ ] Remove Help from Playground again (Reset).

## §3 — `station_context` always reports the organization, plan and status (slice 3)

- [ ] In a portal on **Playground**, ask *"What organization and plan am I on?"*. The answer names **My Organization** and the **Standard** plan.
- [ ] In the same portal, ask *"Which stations can I open here?"*. The answer names qa's readable stations, **Administrate** and **Playground**, and no station from another org.
- [ ] Open **Administrate** (no data packs, no views) in a portal and ask *"Why can't I see any data here?"*. The answer says this station is for access work and has no data packs or views, and points at a station set up for data (Playground). It doesn't say the product can't do it.
- [ ] **No records yet:** a station with an entity attached but no records imported, asked *"Show me my records"*, says nothing has been imported yet. — manual: needs an entity with zero records attached to a station. Create one with a connector whose import you cancel, or skip with a note.

## §4 — Help only with the pack (slice 4)

- [ ] **Without Help.** On **Playground**, open a portal and ask *"What is a tool pack?"*. The answer tells the user to **attach the Help tool pack to this station** to learn more about the platform. It doesn't explain tool packs from its own knowledge, and doesn't look up or list other stations.
- [ ] **With Help.** Add Help to Playground (§2), open a **new** portal and ask *"What is a tool pack?"*. The answer explains tool packs from the help content and ends with a link into Help (e.g. `/help?tab=faq&category=analytics`). Click the link: the Help page opens on that FAQ category.
- [ ] **Data questions still go to the data tools on a Help station.** With Help on Playground, ask *"How many contacts do I have?"*. It runs a data query; it doesn't answer with product help.
- [ ] Remove Help from Playground again (Reset).

## §5 — Existing stations are unchanged

- [ ] No station gained or lost a pack: `select count(*) from station_toolpacks where builtin_slug='help'` is `0` after the Resets above. — backend
- [ ] Administrate still carries only Access & Roles, and Playground its three packs (pages show the same packs as before the branch).

## §6 — Error and edge cases

- [ ] **A member can attach Help only where they can edit.** — manual (needs the e2e member fixture, `e2e:use member`): as the member, on a station they can't edit, the Edit action isn't offered; on one they created, they can tick Help and save.
- [ ] **A product question on a station whose only pack is Help.** Create a station with only Help and ask *"How do I create a station?"*. The answer comes from help content with a link. Note: its `default` lead may still mention "the station's records"; that's deferred to #1044.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / click): · Identifiers (org / station / portal ids):
