# Documentation alignment audit — Spec

**Issue:** [EnterpriseBT/portal-ai#615](https://github.com/EnterpriseBT/portal-ai/issues/615) · **Discovery:** `docs/DOCUMENTATION_ALIGNMENT_AUDIT.discovery.md` · **PR:** #913

This spec pins what "aligned" means for every surface in the discovery's inventory. It covers the prose each surface must carry after the change, the four small code changes where the copy *is* the code, and the three guards that stop the invisible drift classes from coming back. The discovery's tables (§1–§5) are the row-level checklist. This spec states the contract each row is held to.

## Key decisions (confirmed on the discovery, 2026-10-28)

1. **Split by whether the doc is the code (D1).** Code-resident copy is fixed here. Behaviour, pipeline and contract changes are recorded truthfully and tracked in **#909** (web image supply-chain gate), **#910** (residency basemap setting), **#911** (registration signing contract) and **#912** (data export).
2. **The docs follow the code on registration signing (D2).** `/schema` and `/metadata` fetched at registration are documented as signed with a secret the server does not yet hold.
3. **Delete `.github/copilot-instructions.md` (D3 / OQ1).** CLAUDE.md is the single convention file. `scripts/check-review-chain.mjs` drops its mirror rule.
4. **Guards (D4 option B):** mirror-schema parity, the permission-copy guard over durable `docs/`, and the corrected `normalizedData` pin.
5. **Unbacked claims are removed (D5 / OQ3).** That covers the database connector, scheduled syncs, the unqualified "read-write per source" claim, and **every mention of data export**.
6. **Site-config gains `customRbac` + `advancedViewFilters` (OQ2).** This is an additive public contract field.
7. **Shipped capabilities get terse Help entries (OQ4).** Required-field wording is documented as intended (OQ5). `bulk_geocode_records` prose says **expensive** (OQ6).
8. **The drift report is the discovery's inventory tables with a status column, copied into the PR body (D6).**

Enterprise-scale leans carried forward:
- **Accuracy.** `DEPLOYMENT_SECURITY_REVIEW.md` §1 is exhaustive over the code's egress, held by the existing parity tests plus a new §1 coverage check (Surface S1.1).
- **Failure modes.** The two doc errors that *cause* failures (Helm `STRIPE_*`, toolpack signing) land in the first slices.
- **Multi-tenancy copy.** Copy names permissions, never roles (#711), and the guard enforces it.

## Scope

### In scope
Every **C** row in discovery §1–§5, every **G** row in §3, and every **S** row resolved by a decision above. That includes the code-resident fixes in S2.1–S2.3, S3.2, S4.2 and S4.3, and guards G1–G3.

### Out of scope
- Building anything tracked in #909–#912.
- New documentation for features that don't exist.
- Phase docs, and the accessibility epic's copy.
- The incidental code-quality notes (`TabbedSnippetAccordion`, `WEBHOOK_HANDLE_SCOPE_MISMATCH`).
- A description-equality test across all tools (D4 option C was rejected).

## Surface

### S1 — Security & data-residency docs

**S1.1 `docs/DEPLOYMENT_SECURITY_REVIEW.md`**

- **§1 Egress** becomes one row per vector. Each row says whether the call is server-side or from the browser, whether it is always on or conditional on an env var, what data it carries, and the residency override if one exists. Rows:
  - Anthropic, which has **five** callers: the agent, `curated-view-filter-suggest.haiku.ts`, `spreadsheet-parsing-llm.service.ts`, `rest-api/classifier.haiku.ts` and `rest-api/jsonata-suggest.haiku.ts`. The two REST helpers and the interpret path are marked **sends data samples**. The override is `ANTHROPIC_BASE_URL`.
  - Tavily (`TAVILY_API_KEY`).
  - Mapbox geocoding (`GEOCODING_API_KEY`).
  - AWS Marketplace Entitlement + SNS. This is us-east-1 only, so it is cross-region for any other install, and it also needs inbound SNS to `/api/webhooks/aws-marketplace`.
  - Google and Microsoft OAuth + APIs (conditional on connector config).
  - The REST API connector, which calls customer-configured hosts.
  - Custom webhook toolpacks (customer hosts).
  - GitHub `repository_dispatch` (`GITHUB_DISPATCH_TOKEN`, no customer data).
  - Browser: CARTO/OSM basemap tiles. The row says **always on, no override yet (#910)**.
  - Browser: Auth0 or the residency OIDC issuer, and Google Picker.
- **§2 Subprocessors** template rows match the §1 vectors that carry customer data, and match `SUBPROCESSORS` in `packages/core/src/content/subprocessors.util.ts`.
- **§4.** Region is stated as `us-east-1` (no `confirm`). Least privilege lists the ECS task/execution roles, #397's scoped deploy roles (no `AdministratorAccess`), the operator read/write roles with MFA-gated prod write, and the MFA-required break-glass `Admin`. Add an **Encryption in transit** row (TLS to RDS, `rediss://` to the cache, with the chart's `redis.external.tls.caSecret`). The cache `confirm` item is resolved to the fact that only the `-tls` cluster exists. The #660 pin-scan item is resolved or restated without pointing at a swept doc.
- **New §5 "Application-level controls".** One line each, with the code that enforces it:
  - Generic 500s: #687, `HttpService.error`.
  - SSE bearer tokens kept out of logs: #728.
  - Job error and payload redaction: #719, `JobPayloadRedactionService`.
  - NUL rejection: #805, `reject-nul.middleware.ts`.
  - Server-side authorization of every route: `route-authorization.map.ts`.
  - Objects-and-parts RBAC: #829.
  - The restricted agent SQL role: #660, `portal-sql-reader-role.service.ts`.

**S1.2 `docs/SUPPLY_CHAIN.md`**
- Scope states that **two** images are built at deploy.
- The API image is gated as described today.
- The residency web image gets an explicit **"Known exception — ungated until #909"** paragraph naming what it lacks: no Trivy scan, no SBOM, `provenance: false`, no cosign.
- The duplicated `npm audit` paragraph is removed.

**S1.3 Helm chart (`deploy/helm/portalai/values.yaml`, `README.md`)**
- The `secrets` example drops `STRIPE_*`. A comment says that residency refuses them (`apps/api/src/config/deploy-mode.ts:84-90`).
- The `values.yaml:1-5` "later slices" header is replaced with the current contents.
- The README gains three items:
  - an **Egress** subsection: the `ANTHROPIC_BASE_URL` override, and CARTO/OSM basemaps always on (#910);
  - a pointer to `docs/DEPLOYMENT_SECURITY_REVIEW.md`;
  - a pointer to `docs/SUPPLY_CHAIN.md` for image verification (API image only until #909).
- The `deployMode` default (`saas`) is documented as deliberate, with residency installs setting `residency`.

**S1.4 Runbooks and the charter**
- **`ENTERPRISE_SSO.runbook.md`:**
  - The Auth0 Action suggestion is removed. The enterprise claim comes from the connection, per #873.
  - `OIDC_CLIENT_ID` is added to the env table.
- **`PROD_DEPLOY.runbook.md`:**
  - `AdministratorAccess` is stated as detached (#876).
  - There are four `PROD_VITE_AUTH0_*` secrets (incl. `QA_CONNECTION`) plus the `PROD_VITE_GOOGLE_*` secrets.
  - The job list adds the web image push and `verify-login`.
- **`PROD_PROVISIONING.runbook.md`:** the SPA secrets and the managed-keys appendix match `catalog.ts`. That adds `QA_CONNECTION`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `DEMO_TOOLPACK_URL`, `DEMO_TOOLPACK_SIGNING_SECRETS` and the seven `QA_AUTH0_*`/`QA_ORG_ID` keys.
- **`CLI_OPERATIONS_CHARTER.md`:**
  - Finding (a) and its summary line are marked resolved (`backend.yml` now wires the Stripe secret).
  - The native index gains `db upgrade`, `db url`, `db reset-seed`, `cache status`, `service scale`, `jobs status`, `jobs redispatch` and `tier create/update/description`, each matching a `bin.ts` registration.
- **Reclassification.** `DEPLOYED_ENV_CONFIG.md` and `DB_RESET.md` are renamed with `git mv` to `.condensed.md`. No durable doc may link to the old names; `npm run lint:doc-pointers` must pass.

### S2 — Agent / tool contract

**S2.1 `packages/core/src/registries/builtin-toolpacks.ts` mirror.** For each of the following, `parameterSchema` property names, nesting and `required` match the tool's Zod `InputSchema`:
- `entity_record_create`, `entity_record_update`, `entity_record_delete`;
- `connector_entity_create`, `connector_entity_update`, `connector_entity_delete`;
- `field_mapping_create`, `field_mapping_update`, `field_mapping_delete`;
- `sql_query` (adds `acknowledgeCost`; the description drops "database connection" and describes the handle, the 5,000-row cap and cost acknowledgement).

Descriptions also change:
- **`transform_entity_records`:** the source is "read-only and locked during the job". Writes go to "one or more target entities" via `writes[]`, and SQL aliases are referenced by `writes[].valueFrom`.
- **`logistic_regression`:** the large-handle SGD path omits per-row probabilities.
- **`bulk_geocode_records`:** "expensive", not "metered".

Stale comments at `:1549`, `:1794` and `:1812` are corrected.

**S2.2 Tool descriptions (`apps/api/src/tools/`)**
- **`transform-entity-records.tool.ts`:**
  - `:157-159` points at `station_context` for entity ids, not `## Available Data`.
  - `:236` says "one or more target entities".
  - `:241` describes `writes[].valueFrom {kind:"sql_alias"}`.
- **`portfolio-metrics.tool.ts`** states the `dateColumn` requirement past 100k rows.
- **`bulk-geocode-records.tool.ts`** says "expensive".

**S2.3 `apps/api/src/prompts/system.prompt.ts`**
- **`:431`** reads `data`, not `normalizedData`.
- **New `StationContext` field.** `geocodingAvailable?: boolean`, documented as "whether `GEOCODING_API_KEY` is configured — the same condition `buildAnalyticsTools` uses to construct `geocode`/`bulk_geocode_records`". It is set in `portal.service.ts` next to `stationWritable`.
- **The GIS section names tools that exist:**
  - `geocode` appears only when `geocodingAvailable === true`.
  - `bulk_geocode_records` appears only when `geocodingAvailable === true && stationWritable !== false`.
  - When geocoding is unavailable, the section says addresses can't be geocoded in this session and the agent must not fabricate coordinates.
  - "metered" becomes "expensive".
- **The read-only connectors note (`:1023-1040`)** names `transform_entity_records` and `bulk_geocode_records` among the tools withheld.
- **The RBAC note (`:531`)** says sharing covers stations, pins and curated views.

### S3 — Marketing site & in-app Help

**S3.1 Copy (`apps/site/src/pages/{index,features,terms,privacy}.astro`, `apps/site/src/lib/use-cases.ts`)**
- There is no "database" source anywhere. The source list is files (CSV/XLSX), Google Sheets, Excel on OneDrive, and REST APIs.
- There is no sync cadence or scheduled-sync claim. Syncs are described as running on demand.
- "Read-only or read-write per source" is replaced with what ships: writes are available for uploaded and sandbox data.
- `features.astro` PILLARS gain the shipped capabilities:
  - sharing, roles, policies and groups (custom roles and policies on Enterprise);
  - curated views and SQL filters;
  - SSO;
  - self-hosting via Helm, with AWS Marketplace.
- **`terms.astro:34`** names permissions, not "the owner can…". Deleting the organization stays owner-only, because it is.
- **`privacy.astro:78`:** no export claim. Access, correction and deletion stay as they are. The retention list gains the audit log (24 months, `AUDIT_LOG_RETENTION_MONTHS`).

**S3.2 Pricing and the site-config contract**
- `PublicSiteTierSchema` (`packages/core/src/contracts/site-config.contract.ts:27`) gains two fields, `customRbac: z.boolean()` and `advancedViewFilters: z.boolean()`. Both are required and strict.
- `SiteConfigService` (`apps/api/src/services/site-config.service.ts:~80`) maps them from the tier row.
- The `@openapi` component regenerates from the schema.
- `apps/site/src/lib/site-config.fixture.json` is updated to the current catalog shape: `rbac_management`, `view_management`, current credits, and the two new fields.
- **`pricing.astro`:**
  - `packLabel(slug)` returns `BUILTIN_TOOLPACK_BY_SLUG[slug]?.name ?? slug` from `@portalai/core/registries`, replacing the title-casing at `:32-36`.
  - Cards list "Custom roles & policies" and "Advanced (SQL) view filters" when the corresponding flag is true.

**S3.3 Help content**
- **`glossary.util.ts`:**
  - No database connector wording.
  - "File Upload" replaces "CSV connector definition".
  - The tool examples use current tools: `cluster`/`hypothesis_test` for statistics, and `regression`/`logistic_regression`/`forecast` for regression.
  - The built-in pack list matches `BUILTIN_TOOLPACKS` names.
  - Job lists the current job kinds in user terms.
  - `:434`/`:443` name the permission (`member.role.assign`, on a plan with custom roles), not "admins".
  - **New entries:** Share (grant), Capabilities (why an action is hidden or disabled), Invitation, Activity Log, Data Lock (a running job pauses edits), SSO.
- **`faq.util.ts`:**
  - No databases.
  - "Open Portal".
  - The lock alert is placed on the connector, entity and column-definition pages.
  - The pack list is complete.
  - "File Upload".
  - **New Q&As:** inviting a member, the Access tab (roles/policies/groups), sharing stations, views and pins, the Activity log, and why an action is disabled or hidden.
- **`getting-started.util.ts`:** no database. No step claims what the product lacks.
- **`glossary-routes.util.ts`:**
  - `Sync` maps to `ApplicationRoute.Connectors`.
  - `Policy`, `Role`, `Group`, `Permission Boundary`, `Invitation` and `Activity Log` map to `ApplicationRoute.Settings`.
  - `Advanced Filter` and `Curated View` map to `ApplicationRoute.CuratedViews`.

### S4 — Workflow copy and the custom-toolpack contract

**S4.1 `docs/CUSTOM_TOOLPACK_INTEGRATION.md`**
- **Signing section.** Runtime calls and later schema refreshes are signed with the stored secret, so verify those. The registration-time `/schema` and `/metadata` fetches are signed with a secret the server receives only in the registration response, so those two endpoints must accept them unverified until the secret is stored (as `packages/demo-toolpack` does). The section links #911.
- The checklist item "verifies all three headers on every endpoint" is rewritten to match.
- No role framing: registering needs `write` on toolpacks, and calls run in the invoking user's session.
- `correlate` becomes `cluster`.
- "Stream into pagination" becomes "stage via `output.writeUrl`".
- Staged rows are NUL-stripped (#805).
- The product name is "Portals AI".

**S4.2 `apps/web/src/components/RegisterToolpackDialog.component.tsx`**
- The TS, Python and C# snippets skip verification for `/schema` and `/metadata`, with a one-line comment citing why.
- **Helper text:**
  - The catalog is fetched at registration and on Refresh.
  - The runtime body is `{tool, input}`, plus `records`, `source` or `output` for bounded and streaming tools.
  - Auth headers are "stored encrypted; never shown again".
  - The slug rule is "starts with a letter".
- **The Description field** gets `error={touched.description && !!errors.description}`, `helperText`, `slotProps.htmlInput["aria-invalid"]` and `onBlur={blurUnlessDialogControl(() => handleBlur("description"))}`, matching the Name field.
- `EditToolpackDialog.component.tsx:268` gets the same.

**S4.3 Other workflow copy**
- `file-upload-fixtures.util.ts:20-26` drops `.ods`, so the accepted list equals the API default `.csv,.tsv,.xlsx,.xls`.
- **Samples.** `SampleFiles.component.tsx:23` and `apps/web/public/samples/supported_layouts.csv` use the region vocabulary: `headerAxes`, `segmentsByAxis`, `recordsAxis`, `cellValueField`. The "Single Axis Dynamic" index row is fixed. The `.xlsx` sample is regenerated only if its "Parser config" text cells carry the old vocabulary, and is then asserted by re-reading it, not by bytes.
- **`TransformEditor.component.tsx:48-49`** says the expression returns records: an object is wrapped, a primitive becomes `{value}`, and nested values infer as `json`.
- **`record-field-serialization.util.ts`** gets a comment recording that the client's required-field block is deliberately stricter than the API's soft `validationErrors`. User-facing strings are unchanged.

### S5 — Developer READMEs and conventions
- **Root `README.md`:**
  - e2e CI is shipped (#880).
  - The CLIs auto-load their package `.env` (#632).
  - The deploy-on-merge step list matches `deploy-dev.yml`.
  - The stack and secrets tables match the workflows.
  - Dead links are removed.
  - The devcontainer path is mentioned.
- **`apps/api/README.md`:**
  - Node 22.
  - Port 3001.
  - `/api/health`, `/api/health/ready`, `/api/docs`.
  - The commit endpoint answers `202 {jobId,status}`.
  - No `/api/uploads`.
  - DB scripts add `db:upgrade` and `db:reset`.
  - portalops groups are `db`, `vars`, `cache`, `service`, `jobs`, `tier`, `local`.
  - `rediss://`.
  - The secrets and literals tables match `backend.yml`.
- **`apps/web/README.md`:**
  - Node 22.
  - Storybook 7007.
  - The `VITE_*` table matches `.env.example`.
  - `Application.tsx` and `providers/`.
  - No `@portalai/types`.
  - Two themes (`brand`, `brand.dark`).
  - Route-tree troubleshooting points at `generate:routes` (#899).
- **`apps/site/README.md`:**
  - The env table adds `BUILD_SHA`.
  - The stale #83 prod note is corrected, also at `deploy-site-prod.yml:13,72`.
- **`packages/core/README.md`:** `CoreModelFactory`, `_coreModelFactory`, the `coreModelFactory` option, and a workspace-package install note.
- **`packages/spreadsheet-parsing/README.md`:** `/ui` exports listed; dead link removed.
- **`cli-env`, `devops-cli` and `admin-cli` READMEs:**
  - The prod env exists, with `api.portalsai.io`.
  - The #632 package `.env`.
  - The full scope line and exit codes 0–9.
  - `db:reset` is `portalai org reset`.
  - No "webhook-created org".
  - `aws login`.
  - No hard-coded test counts.
- **`packages/e2e/README.md`:** the env table adds `E2E_QA_CONNECTION`, `E2E_ANTHROPIC_STUB_PORT` and `E2E_ORG_ID`.
- **`docs/LOCAL_DEVELOPMENT.md`:** site on :3002, and the container name derived from the compose project, not hard-coded.
- **`CLAUDE.md`:**
  - The package table adds `spreadsheet-parsing`, `e2e` and `demo-toolpack`.
  - Storybook web is :7007 in both places.
  - Every reference to the copilot mirror is removed (`:866`, `:879`).
  - The documentation-surfaces inventory gains `apps/site` copy, the Helm chart docs, and the guard from G2.
- **`.github/copilot-instructions.md`** is deleted.
- **`scripts/check-review-chain.mjs`:**
  - `COPILOT_MD`, its rule-1 mirror branch (`:154-170`) and `copilotMd` (`:499`) are removed.
  - Its embedded self-test fixtures drop the mirror cases.
  - The header comment (`:9`, `:23`) is updated.
  - `npm run lint:review-chain` must still pass and still fail its remaining fixtures.

### Guards

**G1 — Mirror-schema parity.** New file: `apps/api/src/__tests__/tools/builtin-toolpack-schema-parity.test.ts`.
1. Build the widest built-in tool set the way `tools.service.test.ts:~1737` does: every pack, write capability, `portalId`, and a geocoding key.
2. For each built tool that has a `BUILTIN_TOOLPACKS` descriptor, compare `z.toJSONSchema(tool.schema)` with the descriptor's `parameterSchema`.
3. Matching is **structural, by name**: identical `properties` key sets, identical `required` sets, and recursion into `items` and nested `properties` for object and array-of-object fields.
4. Descriptions, types, formats and bounds are **not** compared, because mirrors may summarize.
5. The allowlist `SCHEMA_PARITY_EXEMPT: Record<string, string>` (tool → reason) starts **empty** and only shrinks.

**G2 — Permission-copy guard over durable docs.**
- `apps/api/src/__tests__/permission-copy.guard.test.ts` gains a `describe` that scans `docs/*.md` (repo root). It **excludes** the six ephemeral suffixes (`.discovery`, `.spec`, `.plan`, `.smoke`, `.adversarial`, `.condensed`) and applies the exported `ROLE_FRAMED` patterns.
- It also gets its own shrink-only `DOCS_ALLOWED` list for rules that are *about* roles (e.g. owner/admin assignment). That list starts with only entries proven necessary by the first run, each with a reason.
- `ROLE_FRAMED` gains `/\bas the (registering |org(anization)? )?admin\b/i`, which the toolpack guide used.

**G3 — Prompt pin.** In `apps/api/src/__tests__/prompts/system.prompt.test.ts:254-261`, `toContain("normalizedData")` becomes `toContain("`data`")` together with `not.toContain("normalizedData")`.

## Migration
None. There is no schema change: `custom_rbac` and `advanced_view_filters` already exist on `tiers`.

## Seed
None.

## TDD test plan
Run per package with `npm run test:unit` (and `npm run test:integration` in `apps/api` where noted). Never call jest directly.

### packages/core
- **`site-config.contract.test.ts`:**
  - A snapshot with `customRbac`/`advancedViewFilters` parses.
  - Omitting either fails.
  - An unknown key still fails (strict).
- **`builtin-toolpacks.test.ts`:**
  - The `sql_query` mirror has `acknowledgeCost` and no "database connection".
  - The `transform_entity_records` mirror does not contain "not locked".
  - `bulk_geocode_records` says "expensive".
- **`glossary.util.test.ts`:**
  - No entry matches `/\bdatabase\b/i` or names `correlate`/`decompose`.
  - The new terms exist.
  - The pack list names every `BUILTIN_TOOLPACKS` name.
- **`faq.util.test.ts`:**
  - No answer matches `/\bdatabase/i`, `/\bexport\b/i` or "New Portal".
  - The new questions exist.

### apps/api
- **`builtin-toolpack-schema-parity.test.ts` (G1):** one case per mirrored tool, about 63, generated with `it.each`. It is red until S2.1 lands.
- **`system.prompt.test.ts`:**
  - G3.
  - GIS with `geocodingAvailable: false` omits `geocode` and `bulk_geocode_records` and keeps the no-fabrication line.
  - With `true` and `stationWritable: false`, it names `geocode` only.
  - With `true` and writable, it names both, and says "expensive".
  - The read-only note names `transform_entity_records`.
  - The RBAC note names curated views.
- **`permission-copy.guard.test.ts` (G2):**
  - It scans at least one durable doc.
  - It skips phase-suffixed docs.
  - The new pattern matches the old toolpack-guide phrase.
- **`site-config.service` test:** maps both flags from the tier row (unit). The existing integration test for `GET /api/public/site-config` asserts the fields are present.
- **`portal.service`:** `geocodingAvailable` reflects `GEOCODING_API_KEY` (unit).

### apps/web
- **`RegisterToolpackDialog` / `EditToolpackDialog` tests:**
  - A 2001-character description shows a field error after blur and submit, sets `aria-invalid="true"`, and blocks submit.
  - Blurring the description towards Cancel shows no error.
- **`UploadStep` test:** the accepted-formats text and the `accept` attribute exclude `.ods`.
- **`glossary-routes` test (existing):** the new term → route entries resolve to existing glossary terms.

### apps/site
- `apps/site` tests for `packLabel`: `rbac_management` → "Access & Roles", `gis` → "GIS", and an unknown slug falls back to the slug.
- The pricing render shows the two Enterprise flags from the fixture.

### Repo scripts
- `npm run lint:review-chain` passes with the mirror removed.
- `npm run lint:doc-pointers` passes after the renames and link fixes.

**Totals ≈ 63 parity cases + ~35 hand-written cases.**

## Acceptance criteria
- [ ] Every C row in discovery §1–§5 has status **fixed** in the drift report, and every S row is **fixed** or **resolved (reason)**. The drift report is in the PR body.
- [ ] **Egress parity.** `DEPLOYMENT_SECURITY_REVIEW.md` §1 lists every egress vector in the code, including the five Anthropic callers, AWS Marketplace, the REST and webhook hosts, and the CARTO/OSM browser tiles. `subprocessor-egress-parity` and `subprocessor-browser-egress` still pass.
- [ ] **Residency boot.** A residency `values.yaml` built from the chart's own example boots past the `deploy-mode` guard.
- [ ] **Toolpack registration.** A toolpack server following the documented signing instructions registers successfully. The mock toolpack server and `packages/demo-toolpack` already behave this way.
- [ ] **No false claims.** No user-facing surface (site, Help, getting-started) claims a database connector, scheduled syncs, or data export.
- [ ] **Pricing.** The pricing page shows registry pack names and Enterprise's custom roles and SQL filters.
- [ ] **Guards.** G1–G3 are in CI, and each fails on a reintroduced instance of the drift it targets.
- [ ] **Copilot mirror.** `.github/copilot-instructions.md` is gone, nothing references it, and `lint:review-chain` is green.
- [ ] `npm run build`, `type-check`, `lint`, `format:check` and the unit and integration suites pass.

## Risks & rollback
- **Public site-config contract.** The schema is strict on both ends, and the site is built from the API's response. Deploy order matters: a site build against an API that lacks the fields fails its parse at build time (fail-closed, nothing published). The API change ships in the same PR and deploys first in `deploy-dev`, so the window is closed. Rollback is to revert the PR.
- **The GIS prompt change could hide geocoding when it is available.** `geocodingAvailable` reads the same env var as tool construction, and the tests cover all three states.
- **G2 false positives in legitimate role-rule docs.** These are handled by `DOCS_ALLOWED` entries with reasons, not by weakening the patterns.
- **Deleting the mirror.** If a Copilot user surfaces, generating the file from CLAUDE.md (D3 option B) is a small follow-up.
- **Everything else is copy.** Rollback is a revert, with no data or runtime state involved.

## Files touched
- **docs:**
  - `DEPLOYMENT_SECURITY_REVIEW.md`, `SUPPLY_CHAIN.md`, `ENTERPRISE_SSO.runbook.md`, `PROD_DEPLOY.runbook.md`, `PROD_PROVISIONING.runbook.md`, `CLI_OPERATIONS_CHARTER.md`, `CUSTOM_TOOLPACK_INTEGRATION.md`, `LOCAL_DEVELOPMENT.md`.
  - Renames: `DEPLOYED_ENV_CONFIG.md` → `.condensed.md`, `DB_RESET.md` → `.condensed.md`.
- **deploy:** `deploy/helm/portalai/{values.yaml,README.md}`; `.github/workflows/deploy-site-prod.yml` (comments only).
- **core:** `contracts/site-config.contract.ts`, `registries/builtin-toolpacks.ts`, `content/{glossary,faq}.util.ts`, plus tests; `README.md`.
- **api:**
  - `tools/{transform-entity-records,portfolio-metrics,bulk-geocode-records}.tool.ts`
  - `prompts/system.prompt.ts`
  - `services/{portal,site-config}.service.ts`
  - tests: `__tests__/tools/builtin-toolpack-schema-parity.test.ts` (new), `__tests__/permission-copy.guard.test.ts`, `__tests__/prompts/system.prompt.test.ts`
  - `README.md`
- **web:**
  - `components/{RegisterToolpackDialog,EditToolpackDialog}.component.tsx`
  - `workflows/FileUploadConnector/{SampleFiles.component.tsx,utils/file-upload-fixtures.util.ts}`
  - `workflows/RestApiConnector/TransformEditor.component.tsx`
  - `utils/{getting-started,glossary-routes,record-field-serialization}.util.ts`
  - `public/samples/supported_layouts.{csv,xlsx}`
  - tests; `README.md`
- **site:**
  - `src/pages/{index,features,pricing,terms,privacy}.astro`
  - `src/lib/{use-cases.ts,site-config.fixture.json}`
  - tests; `README.md`
- **packages:** `cli-env`, `devops-cli`, `admin-cli`, `e2e` and `spreadsheet-parsing` `README.md`s.
- **root:** `README.md`, `CLAUDE.md`, `scripts/check-review-chain.mjs`; delete `.github/copilot-instructions.md`.

## Next step
`/plan 615` writes `docs/DOCUMENTATION_ALIGNMENT_AUDIT.plan.md` as about seven slices, in the discovery's priority order:
1. security/residency docs + Helm + `SUPPLY_CHAIN`;
2. runbooks, charter, reclassification;
3. agent/tool contract with G1 + G3 (test first: G1 red, then the mirror fixes);
4. site-config contract + pricing + site copy;
5. Help content;
6. workflow copy + the toolpack guide/dialog;
7. READMEs + CLAUDE.md + mirror deletion + G2, then the drift report.

Each slice is one commit on this branch.
