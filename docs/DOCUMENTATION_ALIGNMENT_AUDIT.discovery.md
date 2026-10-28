# Documentation alignment audit — Discovery

**Issue:** [EnterpriseBT/portal-ai#615](https://github.com/EnterpriseBT/portal-ai/issues/615) · Task · sizing `full`

**Why this exists.** CLAUDE.md makes "is any documentation now out of sync?" a standing check on every PR. Drift still builds up between the code and the prose surfaces the pinning tests can't see. Since August, ~300 commits have landed, including two epics that changed what the product *is*: Enterprise Deployment / data residency (#569) and Security & Enterprise Readiness (#578, RBAC through #829). Both are closed, and #613's trust pages have shipped, so this is the point the issue sequenced the sweep for. It also has to happen before the accessibility epic, so that epic starts from copy that describes the real product.

The survey found that drift is not evenly spread. The security and residency surfaces are the ones a customer's reviewer reads, and they hold the drift that matters most. This doc is therefore both the **drift inventory** (§ The current shape) and the decisions on how to close it. It also covers what to do with the handful of findings that turned out to be **code or config gaps rather than prose**.

## The current shape

The survey was five read-only audits, one per surface group, each checked against `main` @ `48cfdcca`. I re-verified the headline findings by hand: no database adapter in `apps/api/src/adapters/`; the Helm `STRIPE_*` example vs the `deploy-mode.ts:84-90` boot guard; the web image `provenance: false` with no Trivy step; registration signing with a fresh secret at `toolpacks.router.ts:436-446`; `.ods` in the upload list; the mirror schema at `builtin-toolpacks.ts:898-903`; the `normalizedData` pin; Storybook on `7007`; and the 143-line copilot mirror. In the tables, **C** means confirmed drift, **S** means suspected (needs a product or legal call), and **G** means a gap: a shipped capability no surface mentions.

### 1. Security & data-residency docs (highest priority)

| Surface | Finding | Tag |
|---|---|---|
| `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1 (l.15–21) | Calls itself "every third-party call" but lists 3 vectors. It omits AWS Marketplace Entitlement (us-east-1 only, plus inbound SNS), the hard-coded CARTO/OSM browser tiles (`map-config.util.ts:604-606`, with no residency knob), Google/Microsoft OAuth, REST-connector and custom-webhook customer hosts, and GitHub `repository_dispatch` | C |
| same, LLM row (l.19, l.75) | Names the agent and filter suggester only. It misses `spreadsheet-parsing-llm.service.ts`, `rest-api/classifier.haiku.ts` and `rest-api/jsonata-suggest.haiku.ts`, two of which **send data samples**. That contradicts the doc's "never a record value" framing | C |
| same §2 / §4 / baseline | Subprocessor template has 4 rows. Region is still "`confirm`" (it's us-east-1). Least privilege omits #397's scoped deploy roles and MFA break-glass. There's no in-transit encryption row despite #852. `confirm` items for the cache (#872) and pin scan (#660) may now be settled | C/S |
| same (gap) | No durable doc records the app-level controls a reviewer would cite: generic 500s #687, SSE token redaction #728, job error redaction #719/#692, NUL rejection #805, the objects-and-parts RBAC #829 | G |
| `docs/SUPPLY_CHAIN.md` | Covers the API image only. The **residency web image** (#566, `deploy-prod.yml:461`) is pushed with no Trivy scan, no SBOM, `provenance: false`, and no cosign. The `npm audit` paragraph is duplicated (l.17/21) | C |
| `deploy/helm/portalai/{values.yaml:87-88,README.md:65}` | Gives `STRIPE_*` as an example secret, which the residency boot guard **refuses**. The `values.yaml:1-5` header says subcharts, hooks, ingress and Keycloak "land in later slices" (all shipped). The README is silent on `ANTHROPIC_BASE_URL` and CARTO egress, and has no pointer to the security review | C |
| `docs/ENTERPRISE_SSO.runbook.md` | l.33 suggests an Auth0 Action, which contradicts #873's "no Action" in the PROD_PROVISIONING and AUTH0 docs. The env table omits `OIDC_CLIENT_ID` | C/S |
| `docs/PROD_DEPLOY.runbook.md` | Still says `AdministratorAccess` is retired "once…" (done, #876). Says three `PROD_VITE_AUTH0_*` (there are four, incl. QA). Omits the `verify-login` job and the web image push | C |
| `docs/PROD_PROVISIONING.runbook.md` | The SPA secrets and the managed-keys appendix miss `QA_CONNECTION`, `GOOGLE_PICKER_*`, `DEMO_TOOLPACK_*` and the seven `QA_AUTH0_*`/`QA_ORG_ID` keys | C |
| `docs/CLI_OPERATIONS_CHARTER.md` | Finding (a) "backend.yml has no Stripe `ValueFrom`" is now reversed (`backend.yml:90,646`). The native index lacks `db upgrade/url/reset-seed`, `cache status`, `service scale`, `jobs *` and `tier create/update/description` | C |
| `docs/DEPLOYED_ENV_CONFIG.md`, `docs/DB_RESET.md` | These are condensed phase docs (#382, #295) without the suffix, so the sweep never catches them. Their numbers are frozen and wrong | C |
| Current | #613 `/security` (all 36 evidence strings hold), `subprocessors.util.ts`, `AWS_CLI_OPS`, `AUTH0_CLI_OPS`, `E2E_DEPLOYED_QA`, `AWS_MARKETPLACE`, `TIER_PRICING_MODEL`. The §3 "no telemetry" claim holds | — |

### 2. Agent / tool contract

The names line up: all 63 pack tools have a mirror entry, and 47 descriptions are byte-identical. The **schemas** and the **prompt** are where it drifts.

| Surface | Finding | Tag |
|---|---|---|
| `builtin-toolpacks.ts:852-1011` | The mirror `parameterSchema`s for `entity_record_{update,delete}`, `connector_entity_{create,update,delete}` and `field_mapping_{create,update,delete}` use **wrong field names** (`ids`/`id`/`refKey`, missing `normalizedKey`). The modal and `GET /api/toolpacks` show these. The agent gets the correct Zod schema | C |
| `builtin-toolpacks.ts:172` | The `sql_query` mirror describes a "database connection" parameter that doesn't exist, and omits `acknowledgeCost` | C |
| `builtin-toolpacks.ts:1022` + `transform-entity-records.tool.ts:157-159,236,241` | Says the source is "not locked" (it is, per #769). The description predates multi-target `writes[]`. It also points the agent at `connectorEntityId`s in `## Available Data`, which no longer carries ids (#97) | C |
| `system.prompt.ts:431` | Says the `normalizedData` payload, but the field is `data`. **`system.prompt.test.ts:260` pins the stale word** | C |
| `system.prompt.ts:316-325`, `:1023-1040` | The GIS section offers `geocode`/`bulk_geocode_records` even when they aren't built (no `GEOCODING_API_KEY`, or stripped by the write gate). The read-only note misses `transform_entity_records` | C |
| `system.prompt.ts:531` | Sharing is described as "station/pin", but `grant_*` covers `curated_view` too | C |
| mirrors for `logistic_regression`, `portfolio_metrics`; comments `:1549,:1794,:1812` | Describe the small-data path only, or carry stale comments | C |
| `bulk_geocode_records` | Prose says "metered", but its `costHint` is `expensive` | S |
| Current | `rbac_management` (19 tools), `view_management` (#644/#645), #825/#829 wording, #641 provenance, #726 cap | — |

**What the pinning tests miss:** nothing compares a mirror `parameterSchema` to its Zod schema. Only `resolve_identity`'s description is checked for equality (`tools.service.test.ts:658`). The prompt test renders from `effectiveToolPacks`, so it can't see conditional builds.

### 3. Marketing site & in-app Help

| Surface | Finding | Tag |
|---|---|---|
| `apps/site` `index.astro:24,39,46`, `features.astro:22,24,79`, `lib/use-cases.ts:48,85`; `glossary.util.ts:76,96`; `faq.util.ts:43,116`; `getting-started.util.ts:19` | Promise a **database connector**. The seeded definitions are sandbox, file-upload, google-sheets, microsoft-excel and rest-api (`seed.service.ts:450-536`) | C |
| `features.astro:22,25`, `use-cases.ts:48` | **Scheduled syncs / sync cadence.** There is no schedule field. `connector_sync` runs only when someone triggers it | C |
| `features.astro:26` | Says "read-only or read-write per source", but only sandbox and file-upload can write | S |
| `pricing.astro:32-36` | Pack labels are title-cased from the slug ("Rbac Management", "Gis") instead of the registry `name` | C |
| `site-config.service.ts:80-93` | The public snapshot omits `customRbac`/`advancedViewFilters`, so pricing can't show Enterprise's headline features | G |
| `features.astro` | No mention of sharing, roles, policies, groups, views, SQL filters, SSO, self-hosting/Helm or Marketplace | G |
| `terms.astro:34`; `glossary.util.ts:434,443` | Role framing ("the owner can invite", "admins author…"), which goes against the #711 convention | C |
| `privacy.astro:66-69,78` | Retention omits the audit log (24 months). `:78` promises an in-app "export" that doesn't exist. It is the only export claim on any surface, and it is removed (OQ3) | C |
| `glossary.util.ts:281,283,290,292`; `faq.util.ts:209` | `correlate` and `decompose` were removed. The pack lists miss Visualize, GIS, Access & Roles and Curated Views | C |
| `faq.util.ts:70,303,50` | Says "New Portal" (it's **Open Portal**). Promises a lock alert on the station page (there isn't one). Says "CSV" where it should say "File Upload" | C |
| Glossary/FAQ/routes | No entries for sharing, capabilities, invitations, the Activity log, job locks or SSO. Policy, Role, Group and Advanced Filter have no route link | G |

### 4. Workflow examples, helper text, custom-toolpack contract

| Surface | Finding | Tag |
|---|---|---|
| `CUSTOM_TOOLPACK_INTEGRATION.md:15,29,494` + `RegisterToolpackDialog` snippets (~:541–) | Say to verify signatures on **every** endpoint. Registration signs `/schema` with a secret the server can't know yet (`toolpacks.router.ts:436-446`), so a server that follows the guide **can't register**. `packages/demo-toolpack/README.md:15` already works around this | C |
| `UploadStep.component.tsx:142` ← `file-upload-fixtures.util.ts:20-26` | Advertises `.ods`, which the API rejects (`environment.ts:339`) | C |
| `RegisterToolpackDialog:279`, `EditToolpackDialog:268` | The Description field has no `error`/`helperText`/`aria-invalid`, so its 2000-character limit (#801) blocks submit silently | C |
| `SampleFiles.component.tsx:23` + `public/samples/supported_layouts.csv` | Use the pre-region vocabulary (`orientation`, `header_row`). One index row is copy-pasted wrong | C |
| `CUSTOM_TOOLPACK_INTEGRATION.md:3,15,409,484` | "as the registering org admin" (role framing; calls actually run as the invoking user). Cites the removed `correlate` | C |
| Dialog helper text :229,:318,:346,:270; `TransformEditor:48`; record validation copy | "fetched once", runtime body `{tool,input}`, "stored redacted", slug rule, "flat records only", web/API required-field wording | S |
| Current | `EXAMPLE_TRANSFORM`, signing header/window/size caps, streaming contract, URL rules, REST #808/#838 copy, 250 MB label | — |

### 5. Developer READMEs, CLAUDE.md and its mirror

| Surface | Finding | Tag |
|---|---|---|
| root `README.md:31,93,132,140-161,179-180` | e2e CI "deferred" (it shipped in #880). CLIs need `DATABASE_URL` exported (no longer true since #632). "Test" step on merge (#427). Stack and secrets tables 4 and ~14 rows short. Dead links | C |
| `apps/api/README.md` | Node v18, port 3000, `/health` (it's `/api/health`), synchronous commit response (it's 202 + job now), a legacy `/api/uploads` that doesn't exist, portalops "db, vars" only, `redis://` (it's `rediss://`), secrets tables short | C |
| `apps/web/README.md` | Node v18, Storybook 6007 (it's **7007**), 3 of 11 `VITE_*` vars, `App.tsx`, `@portalai/types` (no such package), "three themes" | C |
| `packages/core/README.md` | `BaseModelFactory` doesn't exist (it's `CoreModelFactory`); the usage example won't compile | C |
| `cli-env`, `devops-cli`, `admin-cli` READMEs | Predate #632's package `.env`, the prod env and exit codes 8/9. One says "webhook-created org" (removed) | C |
| `CLAUDE.md:9-17,28,615` | The package table misses `spreadsheet-parsing`, `e2e` and `demo-toolpack`. Storybook 6007 | C |
| `.github/copilot-instructions.md` | **143 lines vs CLAUDE.md's 888.** It's a lossy summary, not a mirror. It contradicts CLAUDE.md (`useAuthFetch()`, three themes) and is missing ~15 sections | C |
| Current | Both CLIs' `COMMANDS.md`, `packages/e2e/README.md`, the Helm values table, `LOCAL_DEVELOPMENT.md` (minor) | — |

## The design space

### Decision 1 — What to do with findings that are code or config gaps, not prose

Four findings can't be closed by editing prose alone: the unscanned and unsigned residency web image, registration-time signing, the hard-coded CARTO egress, and the silent Description-limit error (plus `.ods`).

- **A. Docs only.** Record every gap honestly and fix none.
- **B. Fix everything here.**
- **C. Split by whether the doc *is* the code.** Fix in this PR where the "documentation" is code-resident copy or data: mirror schemas, helper text, the `.ods` list, the pricing label function, the Description field's error display. Where the fix changes behaviour or the supply chain, the doc states the current truth (a "known exception" line), and the fix goes to a filed follow-up ticket with its own review chain.

| | A | B | C |
|---|---|---|---|
| Docs true at merge | Yes | Yes | Yes |
| PR keeps a docs-shaped review | Yes | No (deploy workflow + auth flow in one PR) | Mostly |
| Customer-visible bugs left open | Several | None | Only the ones tracked by tickets |

**Lean: C.** The audit's job is that nothing *claims* something false. Signing the web image and redesigning registration signing are security changes that deserve their own `/security-review`. The fixes where the copy *is* the code are cheap, and leaving them would leave the copy wrong.

### Decision 2 — Registration signing: align the docs to the code, or the code to the docs

- **A. Docs follow the code.** Verify on runtime endpoints. `/schema` and `/metadata` at registration are signed with a secret you don't have yet, so accept them unverified or verify only after storing the secret. This is the demo-toolpack's shape.
- **B. Code follows the docs.** Let the registrant supply the secret, or do a two-phase register.

**Lean: A for this PR, B as #911.** The schema endpoint serves a tool catalog, not customer data, so an unverified registration fetch is low risk. A contract change belongs in its own ticket.

### Decision 3 — `.github/copilot-instructions.md`

- **A. Hand-sync it.** That's a 2×888-line duplicate, and it will drift again.
- **B. Generate it verbatim from CLAUDE.md**, with a `lint:` drift check in Static Checks.
- **C. Delete it.** Remove the "mirror" wording from CLAUDE.md, since the team is Claude-only.

**Lean: C, falling back to B.** A summary nobody maintains is worse than none, and it already contradicts the SDK rule. If anyone still uses Copilot, B makes the mirror mechanical. (This needs a user call; see Open question 1.)

### Decision 4 — Preventing recurrence (guards)

- **A. None.** This PR is a one-off sweep.
- **B. Add guards for the classes this audit proved the tests can't see:**
  - (i) a mirror-schema parity test: each mirror `parameterSchema`'s property names and `required` match `z.toJSONSchema(tool.InputSchema)`;
  - (ii) the permission-copy guard extended to durable `docs/*.md`;
  - (iii) the `system.prompt.test.ts` `normalizedData` pin corrected.
- **C. B, plus a description-equality test for every tool,** with an allowlist for intentional summaries.

**Lean: B.** The (i) guard closes the largest invisible class (eight schemas) for little cost. (C) would turn deliberate summaries into churn, and 47 of 63 already match.

### Decision 5 — Unbacked marketing claims (database connector, scheduled syncs)

- **A. Remove or reword them to what ships.**
- **B. Keep them as roadmap.**

**Lean: A.** The issue scopes this as alignment, and the terms promise accuracy. A roadmap claim on a features page is a claim. "Read-write per source" is reworded to what's true (S → reword).

### Decision 6 — Where the drift report lives

- **A. A new durable doc.**
- **B. The PR body.**
- **C. This doc's inventory tables,** updated to a status per row in the final slice and copied into the PR body.

**Lean: C.** The PR is the durable record (the squash commit links it), and a new suffix would break the sweep convention.

## Tradeoff comparison

|  | D1 split by doc-is-code | D2 docs follow code | D3 delete/generate mirror | D4 guards B | D5 remove claims | D6 inventory → PR |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| Spawns a follow-up ticket | Yes (web image, CARTO knob) | Yes (signing contract) | No | No | No | No |

## Recommendation

1. Close every **C** row in § The current shape in this PR, security and residency first (§1). Each **S** row is either resolved by a call recorded in the PR or reworded to what's verifiable.
2. Code-resident copy is fixed in place, as listed under Decision 1.C: mirror schemas and descriptions, prompt text, helper text, the `.ods` list, the pricing pack label (use the registry `name`), and the Description field's error display.
3. `SUPPLY_CHAIN.md` records the residency web image as a known exception, and the gate goes to a follow-up ticket. `DEPLOYMENT_SECURITY_REVIEW.md` §1 lists CARTO/OSM as a fixed browser egress, and a runtime basemap knob goes to a follow-up ticket.
4. The custom-toolpack guide and dialog describe registration signing as the code does it, and the contract change goes to a follow-up ticket.
5. `DEPLOYMENT_SECURITY_REVIEW.md` gains an "application-level controls" section citing #687/#728/#719/#805/#829, so a reviewer can find those controls in one place.
6. `DEPLOYED_ENV_CONFIG.md` and `DB_RESET.md` are renamed to `.condensed.md`, after confirming no durable doc points at them.
7. Unbacked claims are removed from the site, glossary, FAQ and getting-started, including every mention of data export (none exists). Role-framed copy is rewritten in permission terms.
8. Guards are added: mirror-schema parity, the permission-copy guard over durable `docs/`, and the `normalizedData` pin fixed.
9. The copilot mirror is deleted (or generated, per Open question 1).
10. The drift report is these tables with a status column, copied into the PR body.

## Open questions

1. **Copilot mirror: delete it or generate it?** Is anyone on the team using GitHub Copilot against this repo? Lean: delete it. The team is Claude-only.
2. **Site-config public snapshot.** Adding `customRbac`/`advancedViewFilters` so pricing can show Enterprise features is a small additive change to the `GET /api/public/site-config` contract. Is it in scope? Lean: yes. Without it the pricing page under-describes the tier that buyers of the security work evaluate.
3. **Privacy "export directly from the app".** No export route exists. **Decided (user, 2026-10-28):** remove every mention of data export from the privacy page and any other surface. Data export is #912.
4. **Glossary and FAQ gaps (sharing, capabilities, Activity log, job locks, SSO).** These describe shipped capabilities, so this is alignment, not net-new docs. Lean: add terse entries for these in this PR. A shipped feature with no Help entry is drift.
5. **Web vs API required-field wording on records.** Is the soft `validationErrors` vs hard client block intended? Lean: intended (the API accepts partial data from syncs). Document it and don't change it.
6. **The `bulk_geocode_records` "metered" wording vs `costHint: expensive`.** Lean: say "expensive" in the prose to match the charge class.

## Enterprise-scale considerations

- **Concurrency & correctness.** N/A because the PR changes no runtime paths beyond copy and display. The mirror-schema guard is a static test.
- **Accuracy & auditability.** Lean: this is the dimension the ticket exists for. The security review template is what a customer's auditor signs against, so an under-listed egress path is a compliance defect, not a typo. The drift report in the PR body is the durable record.
- **Failure modes.** Lean: two doc errors currently cause *failures*, not just confusion: the Helm `STRIPE_*` example fails a residency boot, and the toolpack signing guidance fails registration. Both are fixed first.
- **Scale & unbounded growth.** N/A because there are no runtime changes. The recurrence guards keep the drift surface from growing back.
- **Multi-tenancy.** N/A for code. Copy that says "admins" or "owner" mis-describes tenant permissions, and that wording is fixed under #711's rule.
- **Contract stability.** Lean: the only contract touched is the additive site-config snapshot (Open question 2). The toolpack signing contract stays as it is here, and changing it goes to a follow-up.
- **Data lifecycle.** Lean: the privacy page's retention list gains the 24-month audit log (`AUDIT_LOG_RETENTION_MONTHS`), and everything else there is verified current.

## What this doesn't decide

- **The residency web image's Trivy/SBOM/cosign gate.** It changes the deploy pipeline, so it's #909, with its own `/security-review`.
- **A runtime basemap/tile-provider knob for residency.** That's net-new configuration, so it's #910.
- **Data export.** No export exists, so this PR removes the claims, and building the feature is #912.
- **The registration signing contract redesign.** It's a toolpack contract change, so it's #911.
- **Code-quality findings the audit surfaced by accident.** `TabbedSnippetAccordion` is an inline helper component, and `WEBHOOK_HANDLE_SCOPE_MISMATCH` is used for a bad offset. Neither is documentation, so they're noted for a chore ticket.
- **Phase docs.** They're ephemeral by design. The other ~20 spent ones in `docs/` are swept by the next Feature ticket, since this is a Task.
- **Accessibility copy.** That belongs to the next epic.

## Next step

`/spec 615` turns the inventory into a contract: each surface's acceptance (what "current" means for it), the three guards, and the follow-up tickets to file. `/plan 615` then slices it by surface, in priority order:
1. security/residency docs + Helm + `SUPPLY_CHAIN`;
2. runbooks + CLI charter + the misclassified docs;
3. agent/tool contract + the mirror-schema guard + the prompt pin;
4. marketing site + pricing labels + Help content;
5. workflow helper text + the toolpack guide/dialog + `.ods` + the Description field;
6. READMEs + CLAUDE.md + the copilot mirror + the permission-copy guard over `docs/`;
7. the drift report.

Each slice is one commit, gated by its pinning or guard tests.

## Drift report (status at the end of implementation)

Every **C** row above is **fixed** unless the table says otherwise; the **S** rows are resolved as listed. Commits on PR #913, in slice order: `b7cbe98b` security/residency docs + Helm, `5782b8d1` runbooks + charter + reclassification, `0ccad6f9` agent/tool contract + G1/G3, `9fbf65d2` site-config + pricing, `f574c711` site copy + Help, `dc49f643` workflow copy + toolpack contract, `6c44bf17` READMEs + CLAUDE.md + mirror, then the G2 guard.

| Surface (§) | Status | Notes |
|---|---|---|
| §1 `DEPLOYMENT_SECURITY_REVIEW.md` | fixed | §1 rebuilt from code: **six** Anthropic callers (the survey found five; `visualize_d3` codegen is the sixth), four of them sending record or sample values; every server and browser egress row. §2 follows; §4 gains in-transit and image-provenance rows; new §5 application-level controls. Baseline: us-east-1, #397 IAM, cache resolved (#872), pin scan resolved (#665, prod 2026-10-26: no cross-org reads). Postgres TLS recorded as **not enforced** by the templates rather than claimed. |
| §1 `SUPPLY_CHAIN.md` | fixed | Two images; the web image is a known exception until **#909**. |
| §1 Helm chart | fixed | `STRIPE_*` example removed (verified: `helm template` in residency mode renders none); header, `deployMode`, Egress and verification sections. CARTO egress until **#910**. |
| §1 `ENTERPRISE_SSO.runbook.md` | fixed / **resolved: needs a decision** | The claim match is exact (no `sub`-prefix convention). Sourcing the claim needs an Auth0 Action, which #873's tenants don't run, so enterprise invite-gating in SaaS is effectively unavailable until someone accepts that Action as an exception. Recorded in the runbook; not filed. |
| §1 `PROD_DEPLOY` / `PROD_PROVISIONING` runbooks | fixed | Also found: since #580 the web reads the Google picker config at runtime, so the `{DEV,PROD}_VITE_GOOGLE_*` secrets the deploy workflows still pass are **dead**; the runbooks say so (removing them from the workflows is a cleanup, not done here). |
| §1 `CLI_OPERATIONS_CHARTER.md` | fixed | Finding (a) resolved; 8 commands indexed; the coverage table was already stale (18 rows vs 14 counted) and is recounted: 67 ops, 95.1%. |
| §1 `DEPLOYED_ENV_CONFIG.md`, `DB_RESET.md` | fixed | Now `.condensed.md`; `deploy-parity.test.ts`'s historical-doc check recognises all six suffixes instead of a by-name list. |
| §2 mirror schemas | fixed | G1 found **18** tools, not the audit's 10: also `tvm`, `irr`, `xnpv`, `xirr`, `depreciation`, `bond_math`, `portfolio_metrics` and the curated-view filter. G1 passes with an empty exemption list. |
| §2 descriptions, prompt | fixed | `geocodingAvailable` + `stationWritable` for gis gate the GIS section; G3 pin corrected. |
| §2 `bulk_geocode_records` "metered" (S) | resolved: says expensive | |
| §3 site copy, pricing, terms, privacy | fixed | Data export claim removed (**#912**). Read-write claim (S) reworded to what ships. |
| §3 glossary / FAQ / getting-started / routes | fixed | Six new glossary terms, four new FAQs. Invitations are **link-based** (copied, shown once), not emailed — the copy says so. |
| §4 toolpack guide + dialog | fixed | Signing contract change is **#911**. The mock server verifies nothing until its secret is set; only the demo toolpack skips the catalog paths, and the guide says so. |
| §4 dialog helper text (S) | fixed | |
| §4 samples | fixed, **deviates from spec** | The obsolete "Parser config" lines were removed rather than translated into region-schema terms (no screen uses those names, and a wrong translation is worse than none). XLSX edited in place and re-read with ExcelJS. |
| §4 record required-field wording (S) | resolved: intended | Documented in `record-field-serialization.util.ts`. |
| §4 transform caption (S) | fixed | |
| §5 READMEs, `LOCAL_DEVELOPMENT.md` | fixed | The audit's spreadsheet-parsing `/ui` finding was wrong (`/ui` really is empty); that README only lost dead links. |
| §5 `CLAUDE.md` | fixed | |
| §5 `.github/copilot-instructions.md` | removed | `lint:review-chain` no longer checks it. |
| Guards | added | G1 schema parity (api), G2 role framing over durable `docs/` (api), G3 prompt pin. |
