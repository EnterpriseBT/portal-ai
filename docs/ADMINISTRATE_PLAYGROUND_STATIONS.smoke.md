# Administrate and Playground stations — Smoke Suite

Manual smoke test for [#848](https://github.com/EnterpriseBT/portal-ai/issues/848) — new and reset organizations are provisioned with an Administrate station (the default) and a Playground station in place of My Station, and the empty-station notice, agent prompt and help content describe stations scoped to one kind of work. **Branch under test:** `feat/848-administrate-playground-stations` (PR [#1040](https://github.com/EnterpriseBT/portal-ai/pull/1040)).

Steps are agent-walkable unless tagged `— manual` (needs a person) or `— backend` (a CLI or database step, run from a shell rather than the browser).

## Preflight

### Environment

- [ ] `git checkout feat/848-administrate-playground-stations && git pull --ff-only`
- [ ] `npm install && npm run build` — no migration on this branch. The build matters: `npx portalai` runs `dist/`, and the API reads `@portalai/core` from its build.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000, site :3002). If the API was already running when core was rebuilt, save any file under `apps/api/src` so it restarts with the new help content.

### Fixtures

- [ ] — backend. **Org A (fresh, full plan):** `npx portalai org create --name "Smoke 848" --owner-email <owner email> --env local --yes --json`, then `npx portalai org set-tier <orgA> enterprise --env local --yes`. Enterprise includes custom access and has no daily message limit, so the agent steps aren't cut short.
- [ ] — backend. Add a member to org A: `npx portalai member add <orgA> <member email> --env local --yes`.
- [ ] — backend. **Org B (fresh, limited plan):** a local-only tier row copied from `standard` with `view_management` removed from `builtin_toolpacks` (slug `smoke-848-noviews`), then `org create --name "Smoke 848 limited"` and `org set-tier <orgB> smoke-848-noviews`.
- [ ] — backend. **An org that predates this branch** (any local org whose only provisioned station is My Station; `e2e-fixture` works). Note its station names and default station before the walk.
- [ ] Signed-in sessions for the owner and the member (`npm run --workspace @portalai/e2e e2e:auth:all`). `npx portalai member switch <org> <email> --env local --yes` moves a user into an org; refresh the app afterwards.

### Reset between runs

- [ ] — backend. `npx portalai org delete <orgA|orgB> --env local --yes`, delete the `smoke-848-noviews` tier row, and `member switch` the owner and member back to their usual org. §5 resets org A, so run it last.

## §1 — A new organization's stations

- [ ] — backend. The `org create --json` output for org A has `organizationId` and `stationId`. `stationId` is the id of the station named Administrate (check `stations` in `db:studio`: `created_by` is the system id on both rows).
- [ ] As the owner in org A, open **Stations**. Exactly two stations are listed: **Administrate** and **Playground**. There is no My Station.
- [ ] Administrate is marked as the default station. Its description reads "Manage access through the assistant: shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here."
- [ ] Open **Administrate**. Its tool packs are the access pack only (Access & Roles). No connector and no view is attached.
- [ ] Open **Playground**. Its description reads "Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session." Its tool packs are data query, entity management and curated views. The Sandbox connector is attached; no view is.
- [ ] Open the **dashboard**. The default-station card is Administrate.

## §2 — The empty-station notice

- [ ] On **Administrate**'s page an alert reads "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities." It is an info alert (blue, info icon), not a warning.
- [ ] On **Playground**'s page the alert reads "No views are attached to this station. Attach a view to query entity data here." Also an info alert.
- [ ] Start a portal on Administrate. The portal header shows the same Administrate sentence.
- [ ] — manual. The info alert reads as a note rather than a problem, in both the light and dark themes.

## §3 — Playground: build, attach and query in one session

- [ ] As the owner in org A, start a portal on **Playground** and send: "Create an entity called Widgets on the Sandbox connector with a text column called name. Add two records named Acme and Bolt. Then create a view of all widgets called All widgets, attach it to this station, and tell me how many widgets there are." The assistant finishes without an error and answers **2**.
- [ ] The tool steps in that session include creating the entity, creating records, creating the view, attaching the view and a SQL query.
- [ ] Without reloading, the portal header lists the **All widgets** view, and the "No views are attached" sentence is gone.
- [ ] Open **Playground**'s page. **All widgets** is listed under its views and the alert is gone.

## §4 — A member on the provisioned stations

- [ ] As the member in org A, open **Stations**. Both stations are listed. Neither offers Edit, Share or Delete.
- [ ] Start a portal on **Administrate** and send: "Create a role called Auditors." The assistant says the member doesn't have permission (it names the permission, not a role), the session keeps working, and no role is created (Settings → Access as the owner shows no Auditors role).
- [ ] Start a portal on **Playground** and send: "Create an entity called Gadgets on the Sandbox connector." The assistant relays a permission refusal. As the owner, **Entities** shows no Gadgets entity.
- [ ] In the same Playground portal send: "Attach the All widgets view to the Administrate station." The assistant relays a refusal or says it can't find a station it may change; Administrate still has no view attached.

## §5 — Reset — run last

- [ ] — backend. `npx portalai org reset <orgA> --env local --yes` exits 0.
- [ ] As the owner in org A, open **Stations**. Exactly Administrate and Playground are listed again, with the §1 descriptions, packs and attachments. The Widgets entity and the All widgets view are gone.
- [ ] Administrate is the default station again (Stations page and the dashboard card).

## §6 — Existing organizations are unchanged

- [ ] As the owner, switch to the org that predates this branch and open **Stations**. The station names match the list noted in preflight; My Station is still there and no Administrate or Playground station was added.
- [ ] Its default station is the one noted in preflight.
- [ ] — backend. In the database, every station named Administrate or Playground belongs to an org created during this walk.

## §7 — Plan limits

- [ ] As the owner in org B, open **Playground**. The curated-views pack is shown as attached but inactive on the plan; data query and entity management are active. The org was created without error.
- [ ] On org B, start a portal on **Administrate** and send: "Create a role called Auditors." The assistant says custom roles aren't included in the current plan. It doesn't say the product can't do it and doesn't offer to attach anything.

## §8 — The agent's station scope

- [ ] As the owner in org A, start a portal on **Administrate** and send: "How many widgets do we have?" The assistant says that needs the Data Query pack, which isn't on this station, and suggests a station that has it. It doesn't say the product can't do it, doesn't suggest attaching data to Administrate, and doesn't attach anything.
- [ ] In the same portal send: "What can I do on this station?" The answer is about managing access. It doesn't open with missing views or connectors and doesn't suggest attaching data here.
- [ ] In the same portal send: "Attach the All widgets view to this station and tell me how many widgets there are." The assistant names the packs this needs (Curated Views, Data Query), says they aren't on this station, and points at a station that has them. It doesn't say attaching can't be done from a portal session.
- [ ] Start a portal on **Playground** (before §3, or after §5) and send: "Why are my answers empty?" The assistant says no views are attached to this station and that someone who can edit it can attach one. The wording is relayed, not verbatim. It doesn't attach a view on its own.
- [ ] — backend. A station with no tool packs answers "attach the packs for what you want to do here, such as the data-query pack for questions about your data". The New Station dialog requires a tool pack, so this can't be set up in the app: it is pinned by `platform-help.tool.test.ts` (`npm run test:unit -- --testPathPattern platform-help` in `apps/api`).

## §9 — Help content

- [ ] Open **Help → Glossary** and find **Station**. The definition says to scope a station to one set of goals or tasks and names Administrate (the default) and Playground as what new organizations start with.
- [ ] **Default Station** says new organizations start with Administrate as the default. **Tool Pack** ends "(see Station for scoping a station to one kind of work)".
- [ ] Open **Help → FAQ**. "What is a Station and why do I need one?" names Administrate and Playground. "How do I start asking questions about my data?" starts "From a station set up for your data". "Why are the assistant's answers vague or missing my data?" starts "First check the station is set up for data."
- [ ] Open **Help → Getting Started**. "Create a station" says to keep unrelated work in separate stations and names Administrate (access) and Playground (the Sandbox data).
- [ ] Open the marketing site's features page (`http://localhost:3002/features/`). The site has no visible FAQ; the FAQ and glossary are in the page's structured data. View source (or read the `application/ld+json` scripts): the station answer names Administrate and Playground, and "My Station" appears nowhere on the page.

## §10 — Error & edge cases

- [ ] — backend. Provisioning against a database with no `sandbox` connector definition fails with `ORGANIZATION_PROVISIONING_FAILED` and leaves no organization, station or connector instance. Don't delete connector definitions from a dev database to try it: it is covered by `application.service.integration.test.ts` ("fails, and leaves no organization behind…") — run `npm run test:integration -- --testPathPattern application.service` in `apps/api`.
- [ ] — backend. The demo seed is unchanged by this PR and attaches to the first station it finds (#1035 replaces it). Don't run `demo seed` or `e2e:seed` against org A or B as part of this walk.

## §11 — Editing a station's description

Run before §5 (the reset restores the provisioned descriptions), or after it.

- [ ] As the owner in org A, open **Administrate**, choose Edit, change **Description** to "Manage access for the pilot team." and save. The station page shows the new description, and so does the Stations list.
- [ ] Open Edit again and save without changing anything. The dialog closes and no request is sent (no `PATCH /api/stations/…` in the network log).
- [ ] Open Edit, empty the Description field and save. The station page shows no description.
- [ ] — backend. After the previous step, `stations.description` for Administrate is null, not an empty string.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
