# PLAN_EXCLUDED_PACKS_NOTICE — Smoke Suite

Manual smoke test for [#1055](https://github.com/EnterpriseBT/portal-ai/issues/1055). When the plan excludes every pack on a station whose tools would read its records, the station page and portal header name those packs and link to plans, instead of saying "Attach a view". **Branch under test:** `fix/1055-plan-excluded-packs-notice` (PR [#1069](https://github.com/EnterpriseBT/portal-ai/pull/1069)).

## Preflight

### Environment

- [ ] `git checkout fix/1055-plan-excluded-packs-notice && git pull --ff-only`
- [ ] `npm install`, then `npm run build --workspace @portalai/core` (core changed). No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [ ] Signed in as the e2e owner in the `e2e-fixture` org. Note its current tier: `npx portalai org get <orgId> --env local --json` → `tier`. Build the stations below while the tier includes GIS (enterprise/pro).
- [ ] Station **"Smoke GIS"**: tool packs **GIS** and **Curated Views**; attach the **Sandbox** connector; no views.
- [ ] Station **"Smoke Many"**: tool packs **GIS**, **Statistics**, **Visualize**, **Regression**, **Financial** and **Curated Views**; attach the Sandbox connector; no views.
- [ ] Station **"Smoke Query"**: tool packs **Data Query** and **GIS**; attach the Sandbox connector; no views.
- [ ] Move the org to a plan without GIS: `npx portalai org set-tier <orgId> standard --env local --yes`. If it refuses with exit 9 (live Stripe subscription), add `--allow-stripe-desync`. Wait ≤60s for the tier cache, or restart the API.

### Reset between runs

- [ ] `npx portalai org set-tier <orgId> <original tier> --env local --yes`, then delete the three Smoke stations.

## §1 — Station page: the plan is the reason

- [ ] Open **Smoke GIS**. The notice reads exactly: "GIS isn't included in your plan, so attaching a view won't make data available on this station." followed by a **View plans** link. It doesn't contain "Attach a view".
- [ ] The tool pack chips show GIS as "Inactive on your plan", consistent with the notice.
- [ ] Click **View plans**. Settings opens on **Subscription & Billing** (`/settings?tab=billing`).
- [ ] Open **Smoke Many**. The notice names up to four packs in the station's order and summarizes the rest: "GIS, Statistics, Visualize and 2 more aren't included in your plan, …" (the order follows the station's chips).

## §2 — Portal header: the same notice

- [ ] On **Smoke GIS**, open a portal. The header shows the same sentence and **View plans**, with no "Attach a view".

## §3 — Other states keep today's text

- [ ] Open **Smoke Query**. Data Query is on the plan, so the notice is today's: "No views are attached to this station. Attach a view to query entity data here.", with no plan sentence and no View plans.
- [ ] Open the **Administrate** station (no pack that reads data). Its notice is today's counts-based text, unchanged.
- [ ] Open a station with views and connectors attached and a pack on the plan. There's no notice.

## §4 — Fails open while the plan is unknown

- [ ] In the browser, block or delay `GET /api/organization/usage` (DevTools request blocking), then reload **Smoke GIS**. The notice shows today's "No views are attached… Attach a view…" text, never the plan sentence. Unblock and reload, and the plan sentence returns.

## §5 — The assistant agrees

- [ ] In a portal on **Smoke GIS**, ask: "Why can't I query any data on this station?" The answer says GIS isn't included in the organization's plan and doesn't suggest attaching a view. This is the same as before the change (the prompt is unchanged) and matches the notice. — manual (an assistant answer is judged by reading it; standard allows 9 agent turns a day)

## §6 — Organization tool packs (if the org has one registered)

- [ ] If the org has a registered custom tool pack: a station with that pack and **Curated Views** only, on `standard` (which excludes custom packs), reads "Your organization's tool packs aren't included in your plan, …". Skip with a note if no custom pack is registered.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station ids, tier):
