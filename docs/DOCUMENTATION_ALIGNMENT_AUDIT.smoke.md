# documentation-alignment-audit — Smoke Suite

Manual smoke test for [#615](https://github.com/EnterpriseBT/portal-ai/issues/615): the documentation alignment audit. Most of what shipped is prose, so this walk checks the parts a person or a customer actually meets:
- the security and residency docs agree with the code;
- the Helm chart's example boots in residency mode;
- a toolpack server built from the signing instructions registers;
- the pricing page shows registry names and Enterprise features;
- no surface claims a database connector, scheduled syncs or data export;
- the agent's tool modal and GIS guidance match the tools;
- the workflow copy fixes are in place;
- the new guards bite.

**Branch under test:** `docs/615-documentation-alignment-audit` (PR [#913](https://github.com/EnterpriseBT/portal-ai/pull/913)).

Run **§Preflight** once; after that each section is independent. Steps tagged `— manual` need a human (reading a doc against code, judging copy); `— backend` steps are terminal commands; everything else is `/smoke-walk`-eligible in the browser.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout docs/615-documentation-alignment-audit && git pull --ff-only`
- [ ] `npm install && npm run build` — core changed (site-config contract, toolpack contract, registry, Help content); web, API and site read core's `dist`. **No migration.**
- [ ] `npm run dev` boots cleanly (web :3000, API :3001, site :3002). If the API was already running, touch an `apps/api/src` file so nodemon reloads the rebuilt core.
- [ ] Sign in as the e2e owner (`npm run --workspace @portalai/e2e e2e:auth` if the stored session has expired).

### Fixtures

- [ ] A station with the **gis** and **entity_management** packs, attached to at least one connector that allows writes (the Sandbox connector does). Call it **gis-station**.
- [ ] Know whether `GEOCODING_API_KEY` is set in `apps/api/.env`. §5 has steps for both states; restart the API after changing it.
- [ ] Note your org's tier. The pricing checks use the site, not your org.

### Reset between runs

- [ ] Delete any toolpack registered in §2 (Toolpacks → the pack → Delete). Everything else is read-only.

---

## §1 — Security & residency docs match the code

- [ ] `npm run test:unit -- --testPathPattern subprocessor-egress-parity` (apps/api) and `npm run test:unit -- --testPathPattern subprocessor-browser-egress` (apps/web) both pass. — backend
- [ ] Render the chart in residency mode with the README's example secrets: `helm template t deploy/helm/portalai --set deployMode=residency --set image.api.repository=x --set-string image.api.tag=v1 --set image.web.repository=y --set-string image.web.tag=v1 --set oidc.issuer=https://idp.example --set oidc.audience=aud --set secrets.ENCRYPTION_KEY=k --set secrets.ANTHROPIC_API_KEY=a --set secrets.OAUTH_STATE_SECRET=o | grep -E "STRIPE|DEPLOY_MODE"`. Expected: `DEPLOY_MODE: "residency"` and **no** `STRIPE_*` line. — backend
- [ ] `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1 has a row for each of: the six Anthropic callers (agent, `visualize_d3` codegen, spreadsheet interpret, REST classifier, REST transform suggester, view-filter suggester), Tavily, Mapbox, Google, Microsoft, REST connections, webhook toolpacks, AWS Marketplace (marked us-east-1 only), GitHub dispatch, and the browser rows (CARTO/OSM marked "no override yet (#910)", sign-in, Google Picker). Spot-check two rows' file paths exist. — manual
- [ ] §4 of the same doc has an **Encryption in transit** row and an **Image provenance** row naming #909. The SaaS baseline says **us-east-1** and has no `confirm` left for region, cache or the pin scan. — manual
- [ ] `docs/SUPPLY_CHAIN.md` has the "Known exception — the residency web image is not gated (#909)" section, and `npm audit` is mentioned once. — manual
- [ ] `docs/ENTERPRISE_SSO.runbook.md` no longer suggests a `sub`-prefix convention, and says an enterprise-claim Action would be an exception to #873. — manual

## §2 — Custom toolpack signing and dialogs

- [ ] Toolpacks → **Register toolpack**. Open the verification snippets accordion. In each tab (TypeScript, Python, C#), the code lets `GET` requests through before verifying and the comment says "Let GETs through; verify every POST". No snippet lists `"/schema"`.
- [ ] In the same dialog, the Name helper reads "Starts with a letter; lowercase letters, digits, underscores; up to 63 chars."; the auth-headers helper ends "Stored encrypted and never shown again."; the runtime helper mentions `records`, `source` or `output`.
- [ ] Paste 2001 characters into **Description**, then click into **Schema endpoint**. Expected: Description turns red with an error naming 2000 characters, and it has `aria-invalid="true"`. **Register** stays blocked.
- [ ] With an over-long description, click **Cancel** straight from the Description field. Expected: the dialog closes with no error flash.
- [ ] **Registration with the documented signing.** Copy the TypeScript sample from `docs/CUSTOM_TOOLPACK_INTEGRATION.md` into a scratch server (Express on :4200), with `/schema` returning the mock server's catalog and `TOOLPACK_SIGNING_SECRET` set to any placeholder. Register `http://localhost:4200/schema` and `/runtime`. Expected: registration succeeds and shows the `whsec_…` secret once. Put that secret into the scratch server, restart it, attach the pack to a station, and ask the agent to run one of its tools. Expected: the runtime `POST` verifies and returns. — manual
- [ ] Toolpacks → the pack → **Edit**. Clear the Description field and **Save**. Expected: the save succeeds, and on reopening Edit the Description is empty. (Before this PR the save reported success and kept the old text.)

## §3 — Pricing and the public site-config

- [ ] `curl -s localhost:3001/api/public/site-config | jq '.payload.tiers[] | {slug, customRbac, advancedViewFilters}'`. Expected: every tier carries both booleans, matching `tier-catalog.ts` (only Enterprise has `customRbac: true`; Pro and Enterprise have `advancedViewFilters: true`). — backend
- [ ] Run the site against the local API: `SITE_CONFIG_URL=http://localhost:3001/api/public/site-config npm run dev -w @portalai/site`, then open `http://localhost:3002/pricing/`. Expected: pack lists read "Access & Roles", "Curated Views" and "GIS" (never "Rbac Management" or "Gis"); the Enterprise card lists "Custom roles & policies" and "Advanced (SQL) view filters"; Standard and Plus list neither.
- [ ] **Older API.** The site's unit test `builds against an API that predates the plan-feature flags` passes (`npm run test:unit -- --testPathPattern site-config` in apps/site). — backend

## §4 — No false claims anywhere

- [ ] On `http://localhost:3002/`, `/features/` and `/use-cases/…` pages, search the page text for "database", "cadence" and "scheduled". Expected: the only database mentions are the security wording about our own database (on `/security/`); no connector or scheduled-sync claim remains. `/features/` has a **"Share it with the right people"** section that names no plan (no "Pro", no "Enterprise").
- [ ] `/privacy/` has no "export" in Your rights, and its retention list includes the **security audit log, ~24 months**. `/terms/` says the owner manages the plan and can delete the organization, and that member management is a permission the owner can extend.
- [ ] In the app: **Help → Glossary**. Expected: entries for Share, Capabilities, Invitation, Activity Log, SSO and Data Lock exist; Tool / Tool Pack examples use `hypothesis_test` and `regression`/`logistic_regression`/`forecast` (no `correlate` or `decompose`); the Sync term links to **Connectors**; Policy and Role link to **Settings**.
- [ ] **Help → FAQ**. Expected: "How do I invite someone to my organization?" says you copy and send a link (not an email), and "Why is an action missing or greyed out for me?" mentions the disabled main action with a tooltip. No answer mentions databases or export, and the start-a-portal answer says **Open Portal**.
- [ ] **Help → Getting Started**, step 1. Expected: "like a file upload, Google Sheets, or a REST API" (no database).

## §5 — Agent tool contract

- [ ] Toolpacks → **Entity Management** → `entity_record_update`. Expected: the schema shows `items[]` with `connectorEntityId`, `entityRecordId` and `data` (no `id`). `connector_entity_create` shows `key` (no `refKey`), and `field_mapping_create` requires `normalizedKey`.
- [ ] Toolpacks → **Data Query** → `sql_query`. Expected: the description doesn't mention a "database connection", and the schema includes `acknowledgeCost`.
- [ ] **Without** `GEOCODING_API_KEY`: open a portal on gis-station and send **"Geocode 1600 Pennsylvania Ave NW, Washington DC and put it on a map."** Expected: the agent says it can't geocode addresses in this session and invents no coordinates. It does not try to call `geocode`.
- [ ] **With** `GEOCODING_API_KEY` set (restart the API): the same prompt geocodes via `geocode`. Then send **"Geocode the address column of <a sandbox entity with addresses> for every row."** Expected: the agent says `bulk_geocode_records` is **expensive** and asks you to confirm before running it. — manual (needs a live Mapbox key and LLM judgement)

## §6 — Workflow copy

- [ ] Connectors → Catalog → **File Upload**. Expected: the upload step reads "Accepted formats: .xlsx, .xls, .csv, .tsv" (no `.ods`), and the file picker offers the same.
- [ ] The Sample files panel's descriptions read "Every supported layout — single-axis static and dynamic, pivot, crosstab, and hybrid crosstab — in one CSV" and "The same layouts, one per sheet — easier to draw regions against". Download `supported_layouts.xlsx` and open it. Expected: it opens cleanly with 11 sheets and no "Parser config" lines.
- [ ] REST API connector → Transform step. Expected: the caption says the expression "should return an array of records (a single object is treated as one record; nested values become JSON columns)".

## §7 — Guards bite, and the Copilot mirror is gone

- [ ] **G1.** In `packages/core/src/registries/builtin-toolpacks.ts`, rename `entityRecordId` to `id` in `entity_record_update`'s mirror, rebuild core, and run `npm run test:unit -- --testPathPattern builtin-toolpack-schema-parity` (apps/api). Expected: `entity_record_update` fails naming both fields. Revert. — backend
- [ ] **G2.** Add the line "Ask an owner or admin for access." to `docs/LOCAL_DEVELOPMENT.md` and run `npm run test:unit -- --testPathPattern permission-copy.guard` (apps/api). Expected: the durable-docs case fails, naming that line. Revert. — backend
- [ ] **G3.** In `apps/api/src/prompts/system.prompt.ts`, change "tools' `data` payload" back to "tools' `normalizedData` payload" and run `npm run test:unit -- --testPathPattern system.prompt` (apps/api). Expected: it fails. Revert. — backend
- [ ] `ls .github/copilot-instructions.md` → no such file; `grep -rn copilot-instructions CLAUDE.md README.md scripts .claude` → nothing; `npm run lint:review-chain` → "gate surfaces consistent". — backend

## §8 — CI and the merge gate

- [ ] PR #913's required checks are green: Unit Tests, Integration Tests and Static Checks. (Static Checks covers build, type-check and lint; Unit Tests covers format:check, lint:review-chain and lint:doc-pointers.) — backend
- [ ] The PR body's drift report has a status for every surface, and the code-review gate label records finding 10 as waived (#911). — manual

## §9 — Error & edge cases

- [ ] A residency render with `secrets.STRIPE_SECRET_KEY=x` still renders it. The chart doesn't block it; the API's boot guard refuses it. Expected: `helm template … --set secrets.STRIPE_SECRET_KEY=x | grep STRIPE` shows it, and the Helm README and `values.yaml` both say residency refuses to boot with it. — backend
- [ ] PATCH `/api/toolpacks/<id>` with `{"description": ""}` (curl with your session token from the browser's Authorization header). Expected: `400 TOOLPACK_INVALID_PAYLOAD`; an empty string is still refused, and only `null` clears. — backend
- [ ] On a station **without** `gis`, open a portal and ask to "show these on a map". Expected: the agent says mapping isn't available on this station or plan. It doesn't mention geocoding tools. — manual (LLM judgement)

## Sign-off

- [ ] Every section above verified
- [ ] `<date> <name>` — confirmed against my own running stack

## Bug-filing template

```
Section: §<n> — <step>
Expected: <what this doc says>
Got: <what happened>
Repro: <exact clicks / prompt / command>
Identifiers: org <id> · station <id> · toolpack <id> · portal <id>
```
