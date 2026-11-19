# demo-org-per-demo — Smoke Suite

Manual smoke test for [#1035](https://github.com/EnterpriseBT/portal-ai/issues/1035). It covers:
- `portalai demo create`, which provisions a fresh, marked demo org per client and loads the dataset onto its own Demo station;
- `portalai demo delete`, which runs the full org deletion on marked orgs only;
- the removal of `demo seed` / `demo reset`.

**Branch under test:** `feat/1035-demo-fresh-org-per-demo` (PR [#1087](https://github.com/EnterpriseBT/portal-ai/pull/1087)).

Run **§Preflight** once. After that the sections are independent. Each step carries one of three tags:
- **`— backend`**: a CLI command or a DB read. The agent can run it in a terminal and record the output. It isn't a browser step.
- **`— manual`**: needs a human or an environment the agent can't reach.
- **Untagged**: a browser step that `/smoke-walk` can walk.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/1035-demo-fresh-org-per-demo && git pull --ff-only`
- [ ] Install and build: `npm install && npm run build --workspace @portalai/core && npm run build --workspace @portalai/cli-env && npm run build --workspace @portalai/admin-cli`. `npx portalai` runs `dist`, so the CLI must be built from this branch.
- [ ] **Migrate:** `cd apps/api && npm run db:migrate && cd ../..`. Migration `0137_organization-is-demo.sql` adds `organizations.is_demo boolean NOT NULL DEFAULT false`. `npm run dev` doesn't migrate. — backend
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). If it was already running, restart the API after the core rebuild.
- [ ] Run the CLI commands below from `packages/admin-cli`. `--env local` reads `DATABASE_URL` from `packages/admin-cli/.env`.

### Fixtures

| Alias | What | How |
|---|---|---|
| **owner** | `qa@portalsai.io`, the local e2e owner, already a user. Its storageState is what `/smoke-walk` signs in with. | `npm run --workspace @portalai/e2e e2e:auth` if the session expired |
| **owner's current org** | Note which org `qa@portalsai.io` lands in before §1, by name in the org switcher. | the app's org switcher |
| **customer org** | Any live org **not** made by `demo create`, e.g. the owner's current org above. | `npx portalai org list --env local --json` |
| **toolpack config** | Optional locally. With `DEMO_TOOLPACK_URL` (+ `DEMO_TOOLPACK_SIGNING_SECRETS`) in `apps/api/.env` or exported, the demo also gets the custom pack. Without them it gets built-ins only (`custom: null`). | `apps/api/.env` |

### Reset between runs

- [ ] Each run creates new orgs. Remove each one with `npx portalai demo delete <id> --env local --yes` (§3). There's nothing else to reset.

---

## §1 — `demo create` happy path (plan slices 3 + 5)

- [ ] `npx portalai demo create --name "Smoke Acme demo" --owner-email qa@portalsai.io --env local --json` exits **0**. stdout is one JSON object: `{ organizationId, stationId, tier: "enterprise", rows: 10000, entities: 11, toolpacks: { builtins: [10 slugs], custom: null | "<id>" }, durationMs }`. Record `organizationId` as **D1**. — backend
- [ ] stderr shows `[env: local (development)]` and the reminder: `Seeded 10000 transactions; pass --rows <n> for a larger dataset. When the demo is over: portalai demo delete <D1> --env local --yes`. — backend
- [ ] **DB check:**
  - `organizations` row D1 has `is_demo = true`, `tier = enterprise` and `owner_user_id` = qa's user id.
  - `default_station_id` points at the station named **Administrate**. — backend
- [ ] **Stations:** D1 has exactly three: **Administrate**, **Playground** and **Demo** (Demo's id = `stationId`).
  - **Administrate:** carries only `rbac_management` and no connectors.
  - **Playground:** carries `data_query`, `entity_management` and `view_management`, with Sandbox attached.
  - These are the same as a normal new org (compare with `npx portalai org create`'s org, or `PROVISIONED_STATIONS`). — backend
- [ ] **Demo station:** `station_instances` links Sandbox, File Upload — CSV, File Upload — XLSX and Demo REST API (4). `station_toolpacks` holds every built-in pack, plus the custom one when configured. — backend
- [ ] **Transactions:** `select count(*) from "er__<transactions entity id>"` = **10000**. — backend
- [ ] **Current org unchanged.** Reload the app as qa@portalsai.io. It still lands in the **owner's current org** from Preflight, not "Smoke Acme demo".
- [ ] Open the org switcher. "Smoke Acme demo" is listed, and switching to it works.
- [ ] In D1, open **Stations**. Administrate, Playground and Demo are listed. Open **Demo**: it shows the 4 connectors and the tool packs.
- [ ] In a portal on the Demo station, ask *"What was total revenue by month for the last 12 months?"*. You get a table (the `data_query` / `sql_query` result) over the 10,000 transactions.
- [ ] **No marker in the UI.** Nothing in D1's pages says "demo" except its name and station name. (`isDemo` rides in the org API payload but is never rendered.)

## §2 — Repeat runs, `--rows` and `--tier` (acceptance: independent orgs, rows, tier)

- [ ] Run the §1 command again with the same `--name "Smoke Acme demo"`. It exits 0 with a **different** `organizationId` (**D2**) and `stationId`. `org list --search "Smoke Acme demo" --json` shows both D1 and D2. — backend
- [ ] `npx portalai demo create --name "Smoke rows" --owner-email qa@portalsai.io --rows 200 --tier standard --env local --json` gives `rows: 200` and `tier: "standard"`. The reminder reads `Seeded 200 transactions`. — backend
- [ ] **~1M rows** — manual: `--rows 1000000` seeds about 1,000,000 `transactions`. This takes minutes locally; run it when there's time and record the duration.

## §3 — `demo delete` (plan slice 5 + review fix)

- [ ] `npx portalai demo delete <D2> --env local --json` exits 0 and stdout is `{"id":"<D2>","deleted":true}`. — backend
- [ ] **Full deletion, DB check:**
  - `organizations` D2 has `deleted` set and `deleted_by` = your operator (`root`/OS user locally).
  - Every `organization_users` row for D2 has `deleted` set.
  - `connector_entities`, `entity_records` and `stations` for D2 have **0** rows.
  - No `er__<id>` table remains for D2's former entities (`select count(*) from pg_tables where tablename like 'er\_\_%'` drops accordingly). — backend
- [ ] Reload the app as qa@portalsai.io. D2 is gone from the org switcher, and the current org is unaffected.
- [ ] Delete D2 again: exit **8**, `ADMIN_NOT_FOUND`. — backend
- [ ] `npx portalai demo delete <customer org id> --env local --json`: exit **9**, `ADMIN_CONFLICT` "… is not a demo org …". The customer org is still live: `org get <id>` exits 0, and the app still loads it. — backend
- [ ] Clean up D1 and the "Smoke rows" org with `demo delete`. Both exit 0. — backend

## §4 — Refusals before anything is created (acceptance: exit 8, guard)

Each refused command must create nothing. Before and after each one, check that `org list --env local --json | jq '.orgs | length'` hasn't changed. — backend

- [ ] `--owner-email nobody-$(date +%s)@example.com`: exit **8**, `ADMIN_NOT_FOUND` "User … not found". — backend
- [ ] `--tier no-such-tier`: exit **8**, `Tier "no-such-tier" not found`. — backend
- [ ] `--name "   "`, `--name` of 121 characters, and `--name $'Acme\nDemo'`: each exits **2** with the name rule's message. — backend
- [ ] `--rows 1.5`, `--rows -1` and `--rows 10000001`: each exits **2** with "--rows must …". — backend
- [ ] **app-dev guard** — manual: `demo create …` and `demo delete <id>` with `--env app-dev` and no `--yes` exit **5** without connecting to anything beyond the guard. Needs app-dev AWS access and a `portalai login --env app-dev`.
- [ ] **prod guard** — manual: `demo create …` and `demo delete <id>` with `--env prod --yes` and no `--confirm-prod` exit **5**. Don't run with `--confirm-prod` as part of the smoke.

## §5 — Toolpack config on AWS envs (acceptance: exit 3)

- [ ] **Missing config** — manual (needs an AWS env where you can safely unset a value, or a scratch env): with `DEMO_TOOLPACK_URL` (SSM `demo-toolpack-url`) absent, `demo create --env app-dev --yes` exits **3** naming `DEMO_TOOLPACK_URL` and the `portalops vars set` command, and no org is created. Repeat for `DEMO_TOOLPACK_SIGNING_SECRETS`. The unit suite covers both (`commands.test.ts`). Walk it only if a safe env exists, else record "covered by tests".
- [ ] **Configured** — manual, after merge on app-dev: `demo create --env app-dev --yes …` reports `toolpacks.custom` = an id. In the app, the Demo station lists the **demo_supply_tools** pack.

## §6 — Failed load cleans up (acceptance: no live org left)

- [ ] Point the seed at a refusing toolpack by setting `DEMO_TOOLPACK_URL=http://127.0.0.1:9` (nothing listens there): `DEMO_TOOLPACK_URL=http://127.0.0.1:9 npx portalai demo create --name "Smoke fail" --owner-email qa@portalsai.io --rows 50 --env local`.
  - It exits **7**.
  - The message contains `demo create failed; org <id> deleted: demo toolpack registration failed: …`. — backend
- [ ] **DB check:**
  - That org's row has `deleted` set and `deleted_by` = the system id (`SYSTEM` locally).
  - Its memberships are tombstoned and it has 0 `connector_entities`.
  - `org list --search "Smoke fail"` returns nothing. — backend

## §7 — Old commands are gone (acceptance)

- [ ] `npx portalai demo seed --org x --env local` and `npx portalai demo reset --org x --env local` exit **2** with `unknown command`. — backend
- [ ] `npx portalai demo --help` lists only `create` and `delete`. `create --help` shows the defaults `enterprise` and `10000`. — backend
- [ ] `npm run --workspace @portalai/api db:demo:seed` fails with `Missing script`. — backend

## §8 — Rollout: CLI against an unmigrated env (review fix)

- [ ] **Locally:**
  1. Simulate an env without 0137: `psql "$DATABASE_URL" -c 'ALTER TABLE organizations RENAME COLUMN is_demo TO is_demo_x'`.
  2. `npx portalai org list --env local --json` and `org get <id> --env local --json` still exit 0.
  3. `demo delete <any id>` fails, naming the missing column.
  4. Restore: `… RENAME COLUMN is_demo_x TO is_demo`. — backend
- [ ] **Against prod before its release** — manual: `npx portalai org list --env prod --json` from this branch exits 0. Read-only.

## §9 — Release step: the pre-existing demo orgs (acceptance; after merge)

These run once each env is migrated. The ids are [recorded on #1035](https://github.com/EnterpriseBT/portal-ai/issues/1035#issuecomment-7018647631).

- [ ] **app-dev** — manual, after the merge deploy:
  1. Mark it: `portalops db psql --env app-dev -- -c "UPDATE organizations SET is_demo = true WHERE id = '15333b2a-f714-4008-98bd-0f975279e8ae' AND deleted IS NULL"`.
  2. `portalai demo delete 15333b2a-f714-4008-98bd-0f975279e8ae --env app-dev --yes` exits 0.
  3. Read-only check: the org is gone from `org list --env app-dev`.
- [ ] **prod** — manual, after the prod release: the same two steps for `a02ae918-97cd-4ad4-9d08-2c13b0aefc52`, with `--confirm-prod`. Afterwards `admin@portalsai.io` still lands in "My Organization".

## Sign-off

- [ ] Every section above verified, or its manual steps marked with an outcome
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact command / prompt): · Identifiers (org / station / entity ids, exit code, stderr):
