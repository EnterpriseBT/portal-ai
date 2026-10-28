# Documentation alignment audit — Plan

**This plan sequences the #615 spec as test-first slices.**
- It fixes the security and residency docs first.
- It then fixes the code-resident copy (the agent/tool contract, pricing, Help, workflow copy) behind failing tests.
- It finishes with the developer docs, the copilot-mirror deletion, the docs-wide permission-copy guard and the drift report.

Spec: `docs/DOCUMENTATION_ALIGNMENT_AUDIT.spec.md`. Discovery: `docs/DOCUMENTATION_ALIGNMENT_AUDIT.discovery.md`. Issue: #615. Follow-ups split out: #909–#912.

There are eight slices. Each is behind a green suite and leaves the repo compilable. They land as **commits on `docs/615-documentation-alignment-audit` / PR #913**: one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit        # + npm run test:integration where noted
cd apps/web && npm run test:unit
cd apps/site && npm run test:unit
npm run lint:doc-pointers && npm run lint:review-chain   # repo root
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Do a focused run.
4. At the boundary, run `npm run lint && npm run type-check && npm run format:check`.
5. Move to the next slice.

**Prose-only slices (1, 2, 7).** Prose has no unit under test, so their "failing check" is an explicit verification list, run before and after. Two parts of that list are recorded in the commit body:
- a grep the edit must take to zero;
- an existing parity or lint script that must stay green.

The durable regression protection for prose is slice 8's docs-wide guard.

**Sequencing rationale:**
- **Slice 1:** the security and residency docs. They are the user's priority and contain the Helm example that *breaks* a residency boot.
- **Slice 2:** runbooks, the charter and reclassification. These are prose that slice 1's security review cross-links.
- **Slice 3:** the agent/tool contract with G1 and G3. This is the largest code-resident drift, and G1 goes red first.
- **Slice 4:** the site-config contract and pricing. Core, api and site change in one commit, so the strict schema never disagrees across a boundary.
- **Slice 5:** site copy and Help content. Help's "Access & Roles" names reuse the registry, and slice 4 has already proved the registry-name path.
- **Slice 6:** workflow copy and the toolpack guide/dialog. The guide's signing fix sits beside the dialog snippets it must match.
- **Slice 7:** READMEs, CLAUDE.md and the mirror deletion. CLAUDE.md's surface inventory names the G1 guard, so it lands after slice 3. Doing this after every other doc edit means CLAUDE.md is updated once.
- **Slice 8:** the G2 docs guard and the drift report. G2 lands last so it guards the finished docs set and carries no allowlist debt from mid-sweep.

No migration and no seed (spec § Migration).

---

## Slice 1: Security & data-residency docs

Covers spec S1.1–S1.3.

**Files**

- Edit: `docs/DEPLOYMENT_SECURITY_REVIEW.md`, with §1 egress rows, §2 subprocessors, §4 facts, and a new §5 application-level controls.
- Edit: `docs/SUPPLY_CHAIN.md`, covering two images, the web image as a known exception (#909), and the deduplicated `npm audit` paragraph.
- Edit: `deploy/helm/portalai/values.yaml` (secrets example without `STRIPE_*`, plus the header) and `deploy/helm/portalai/README.md` (an Egress subsection, pointers, and the `deployMode` note).

**Steps**

1. **Pre-checks: build the egress truth table from code, before editing.** Each entry must map to exactly one §1 row.
   - `grep -rln "anthropic\|ANTHROPIC" apps/api/src --include=*.ts | grep -v __tests__`; expect six callers (the spec said five; slice 1 found `visualize_d3`'s codegen as the sixth).
   - The env vars `subprocessor-egress-parity.test.ts` classifies as egress.
   - The hosts `subprocessor-browser-egress.guard.test.ts` lists.
   Also run `grep -n "STRIPE" deploy/helm/portalai/{values.yaml,README.md}`, which must hit now and be empty after the edit.
2. **Edit** per spec S1.1–S1.3. Cite code paths, never ticket numbers alone.
3. **Verify:**
   - The api parity tests `subprocessor-egress-parity` and the web `subprocessor-browser-egress.guard` stay green (unchanged code, so this is a sanity run).
   - If `helm` is on PATH, run `helm template` with `deployMode=residency` and the README's example `secrets`, and check the rendered Secret carries no `STRIPE_*`. Otherwise run the grep from step 1.
   - Run `npm run lint:doc-pointers`.

**Done when:**
- Every truth-table entry maps to a §1 row, and the six Anthropic callers are listed, with data-sample senders marked.
- No `confirm` remains for region or cache.
- §5 cites the enforcing code for each control.
- The Helm example can't fail the residency guard.

**Risk:** the egress list is easy to under-count. The truth table, not memory, is the checklist.

---

## Slice 2: Runbooks, CLI charter, reclassification

Covers spec S1.4.

**Files**

- Edit: `docs/ENTERPRISE_SSO.runbook.md`, `docs/PROD_DEPLOY.runbook.md`, `docs/PROD_PROVISIONING.runbook.md`, `docs/CLI_OPERATIONS_CHARTER.md`.
- Rename (`git mv`): `docs/DEPLOYED_ENV_CONFIG.md` → `docs/DEPLOYED_ENV_CONFIG.condensed.md`, and `docs/DB_RESET.md` → `docs/DB_RESET.condensed.md`.
- Edit: any durable doc or README that links either old name. Find them with a grep. Source comments may keep stale pointers, which is allowed by convention.

**Steps**

1. **Pre-checks:**
   - Diff the `PROD_VITE_*` and `SECRET_ARN` secret names in `deploy-prod.yml` against the runbook lists.
   - Diff the `packages/devops-cli/src/catalog.ts` keys against the PROD_PROVISIONING appendix.
   - Diff the `packages/devops-cli/src/bin.ts` command registrations against the charter index.
   - Run `grep -rn "DEPLOYED_ENV_CONFIG\.md\|DB_RESET\.md" --include=*.md .`.
   Each diff must be empty after the edit.
2. **Edit and rename.**
3. **Verify:** `npm run lint:doc-pointers` is green, and the step 1 diffs are empty.

**Done when:** the runbooks match the workflows and catalog, the charter index matches `bin.ts`, finding (a) is marked resolved, and both docs carry their honest suffix.

**Risk:** none at runtime.

---

## Slice 3: Agent / tool contract, with G1 and G3

Covers spec S2.1–S2.3 and guards G1 and G3.

**Files**

- New: `apps/api/src/__tests__/tools/builtin-toolpack-schema-parity.test.ts` (G1).
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` (mirror schemas and descriptions, stale comments) and `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`.
- Edit: `apps/api/src/tools/{transform-entity-records,portfolio-metrics,bulk-geocode-records}.tool.ts`.
- Edit: `apps/api/src/prompts/system.prompt.ts`, which gains the `StationContext.geocodingAvailable?: boolean` field, the GIS gating, the read-only note and the RBAC note.
- Edit: `apps/api/src/services/portal.service.ts`, which sets `geocodingAvailable` from `environment.GEOCODING_API_KEY`.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` and `apps/api/src/__tests__/services/portal.service.test.ts`.

**Steps**

1. **Tests:**
   - **G1** with `it.each` over the built mirrored tools, about 63 cases. Expect about 10 red: the 9 entity/mapping/record tools plus `sql_query`.
   - **core:** the `sql_query`, `transform_entity_records` and `bulk_geocode_records` assertions from the spec test plan.
   - **G3:** the `normalizedData` pin is inverted.
   - **GIS:** three cases (unavailable; available but read-only; available and writable).
   - The read-only note names `transform_entity_records`, and the RBAC note names curated views.
   - **portal.service:** `geocodingAvailable` follows the env.
   Run and confirm the failures.
2. **Implement:**
   - Fix the mirror `parameterSchema`s by deriving each from the tool's Zod field names. Hand-author them, since core can't import api.
   - Make the description and comment edits.
   - Add the prompt field and the gating, and set it in `portal.service`.
   Green.
3. `cd packages/core && npm run test:unit`, `cd apps/api && npm run test:unit`, then lint, type-check and format:check. Rebuild core before the api run, since the api consumes core's `dist`.

**Done when:**
- G1 is green with an **empty** `SCHEMA_PARITY_EXEMPT`.
- G3 and the GIS cases are green.
- `tools.service.test.ts`'s name-parity test is still green.

**Risk:**
- **G1 setup.** G1 must build `geocode`/`bulk_geocode_records`, so it sets a geocoding key in the test env. It copies the existing widest-build setup rather than inventing one.
- **Zod v4 output.** `z.toJSONSchema` may emit `additionalProperties` or `$schema`. G1 compares property names and `required` only (spec G1).

---

## Slice 4: Site-config contract + pricing page

Covers spec S3.2.

**Files**

- Edit: `packages/core/src/contracts/site-config.contract.ts`, so `PublicSiteTierSchema` gains `customRbac` and `advancedViewFilters`. Also edit `packages/core/src/__tests__/contracts/site-config.contract.test.ts`.
- Edit: `apps/api/src/services/site-config.service.ts` (map both flags) and `apps/api/src/__tests__/services/site-config.service.test.ts`.
- Edit: `apps/api/src/__tests__/__integration__/routes/public-site.router.integration.test.ts`, asserting both fields.
- New: `apps/site/src/lib/pack-label.ts`. The `packLabel` function is extracted from `pricing.astro` so it can be tested, and it reads `BUILTIN_TOOLPACK_BY_SLUG`. Plus `apps/site/src/lib/__tests__/pack-label.test.ts`.
- Edit: `apps/site/src/pages/pricing.astro`, which uses `packLabel` and renders the two Enterprise rows.
- Edit: `apps/site/src/lib/site-config.fixture.json`, matching the current catalog and the new fields. Also edit `apps/site/src/lib/__tests__/site-config.test.ts` if it parses the fixture.

**Steps**

1. **Tests:**
   - The contract cases: both fields parse, omitting either fails, and the schema stays strict.
   - The service maps the flags.
   - The integration test asserts the fields.
   - `packLabel` gives "Access & Roles", "GIS" and the slug fallback.
   - The site fixture parses against the new schema.
   Red.
2. **Implement** across core, api and site in this one commit, so the strict schema never disagrees at a boundary. Green.
3. Run the core, api (unit and `test:integration` for the router file) and site unit suites. Run `npm run build` at the root so the Astro build parses the fixture or snapshot. Then lint, type-check and format:check.

**Done when:** the pricing page builds against the fixture with the registry pack names and the Enterprise flags, and the `/api/public/site-config` integration test passes.

**Risk:**
- The deploy-order note is in spec § Risks: the API deploys before the site in `deploy-dev`, and a mismatch fails the build closed.
- The `@openapi` component for site-config must regenerate from the schema. Check that Swagger shows the fields.

---

## Slice 5: Marketing site copy + in-app Help

Covers spec S3.1 and S3.3.

**Files**

- Edit: `apps/site/src/pages/{index,features,terms,privacy}.astro` and `apps/site/src/lib/use-cases.ts`.
- Edit: `packages/core/src/content/{glossary,faq}.util.ts` and their tests under `packages/core/src/__tests__/content/`.
- Edit: `apps/web/src/utils/{getting-started,glossary-routes}.util.ts` and `apps/web/src/__tests__/glossary-routes.util.test.ts`.

**Steps**

1. **Tests:**
   - **glossary:** no `/\bdatabase\b/i`, no `correlate`/`decompose`, the new terms exist, and the pack list names every `BUILTIN_TOOLPACKS` name.
   - **faq:** no database, no `/\bexport\b/i`, no "New Portal", and the new Q&As exist.
   - **glossary-routes:** the new mappings resolve to existing terms, and `Sync` maps to Connectors.
   Red.
2. **Implement** the copy edits. On the site, the pre-edit grep `grep -rniE "database|cadence|scheduled sync|export" apps/site/src` must leave only intended hits: the "CSV export" source-system line and code identifiers. Green.
3. Run the core and web unit suites, `npm run build` (the site renders the glossary JSON-LD and the FAQ JSON-LD), then lint, type-check and format:check.

**Done when:** no user-facing surface claims a database connector, scheduled syncs or data export; the terms and glossary name permissions; and the new Help entries render with links.

**Risk:** `glossary.util.ts` and `faq.util.ts` are also rendered on the public site, so the new entries must make sense to an anonymous reader (no in-app jargon without its definition).

---

## Slice 6: Workflow copy + the custom-toolpack contract

Covers spec S4.1–S4.3.

**Files**

- Edit: `docs/CUSTOM_TOOLPACK_INTEGRATION.md`.
- Edit: `apps/web/src/components/{RegisterToolpackDialog,EditToolpackDialog}.component.tsx`, with the snippets, helper text, and the Description field's validation display. Plus `apps/web/src/__tests__/{RegisterToolpackDialog,EditToolpackDialog}.test.tsx`.
- Edit: `apps/web/src/workflows/FileUploadConnector/utils/file-upload-fixtures.util.ts` (drop `.ods`) and `apps/web/src/workflows/FileUploadConnector/__tests__/UploadStep.test.tsx`.
- Edit: `apps/web/src/workflows/FileUploadConnector/SampleFiles.component.tsx` and `apps/web/public/samples/supported_layouts.csv`. Also `supported_layouts.xlsx`, but only if its text cells carry the old vocabulary: check by re-reading it, and regenerate it with the admin-cli generator.
- Edit: `apps/web/src/workflows/RestApiConnector/TransformEditor.component.tsx` and `apps/web/src/utils/record-field-serialization.util.ts` (a comment only).

**Steps**

1. **Tests:**
   - **Both dialogs:**
     - A 2001-character description gives a field error after blur and after submit.
     - `aria-invalid="true"` is set.
     - Submit is blocked.
     - Blurring towards Cancel shows no error.
     - Enter goes through a real key press (`pressEnter`), never `fireEvent.submit`.
   - **UploadStep:** the accepted text and the `accept` attribute exclude `.ods`.
   Red.
2. **Implement.** In the guide, write the signing section per spec S4.1, and keep the dialog's three snippets consistent with it (the `/schema` and `/metadata` skip, with the comment). Green.
3. **Verify the guide against the reference servers:** the mock toolpack server and `packages/demo-toolpack` already skip `/schema` and `/metadata`, and the guide must now describe exactly that. Run the web unit suite, then lint, type-check and format:check.

**Done when:** the dialog tests are green, the guide and snippets describe a registration flow that the reference servers pass, `.ods` is gone, and the samples use the region vocabulary.

**Risk:** the XLSX isn't byte-deterministic, so it's asserted by re-reading. Don't commit a churned XLSX if its text didn't change.

---

## Slice 7: Developer READMEs, CLAUDE.md, mirror deletion

Covers spec S5.

**Files**

- Edit: the root `README.md`, plus `apps/{api,web,site}/README.md`, `packages/{core,spreadsheet-parsing,cli-env,devops-cli,admin-cli,e2e}/README.md` and `docs/LOCAL_DEVELOPMENT.md`.
- Edit: `.github/workflows/deploy-site-prod.yml` (comments only).
- Edit: `CLAUDE.md`, covering the package table, Storybook :7007, removing the mirror references, and the inventory additions: `apps/site` copy, Helm docs, G1, and the G2 guard named ahead of slice 8.
- Delete: `.github/copilot-instructions.md`.
- Edit: `scripts/check-review-chain.mjs`, which loses `COPILOT_MD`, the rule-1 mirror branch, `copilotMd`, and the mirror self-test fixtures.

**Steps**

1. **Pre-checks:**
   - Every `npm run X` named in an edited README exists in the matching `package.json`. Script this with a grep plus `jq` over each README, run it before (expect hits) and after (expect zero), and keep it in the commit body.
   - `grep -rn "copilot-instructions" . --exclude-dir=node_modules`, excluding phase docs, must be empty after the edit.
   - `npm run lint:review-chain` must keep failing its remaining embedded fixtures, so it still bites.
2. **Edit, delete, and update the script.**
3. **Verify:** `npm run lint:review-chain` and `npm run lint:doc-pointers` are green. Run root `npm run lint` and `npm run format:check`.

**Done when:** no README names a missing script, port, package or symbol; CLAUDE.md lists every package and the guards; and the mirror and every reference to it are gone, with `lint:review-chain` green.

**Risk:** the review-chain self-test fixtures may embed mirror text. Remove only the mirror cases, and keep every other rule's fixtures.

---

## Slice 8: G2 permission-copy guard over durable docs + drift report

Covers spec G2 and Key decision 8.

**Files**

- Edit: `apps/api/src/__tests__/permission-copy.guard.test.ts`. It gains a `describe` that scans root `docs/*.md` (excluding the six phase suffixes) with `ROLE_FRAMED` plus the new `as the … admin` pattern, and a shrink-only `DOCS_ALLOWED`.
- Edit: `docs/DOCUMENTATION_ALIGNMENT_AUDIT.discovery.md`, whose inventory tables gain a **Status** column (`fixed` / `resolved: <reason>` / `current`).
- Edit: the PR #913 body, with the drift report (a copy of the tables) via `gh pr edit --body-file`. Write the full body to a file and assert it is non-empty and changed.

**Steps**

1. **Tests:**
   - An embedded fixture string, the old guide's "as the registering org admin", must match the new pattern.
   - The scan must cover at least `CUSTOM_TOOLPACK_INTEGRATION.md`.
   - The scan must skip a `.spec.md`.
   Then run against the real tree. It must be green, since slices 1–7 cleaned the docs. Any hit is fixed in the doc, or allowlisted with a reason if it is a rule *about* roles.
2. **Implement** the scan. Green.
3. Fill the Status column and update the PR body. Then run `npm run build`, `type-check`, `lint` and `format:check` at the root as the final boundary.

**Done when:** G2 is in CI and green over the final docs set, every inventory row has a status, and the PR body carries the drift report.

**Risk:** a G2 false positive on a legitimate role rule gets a `DOCS_ALLOWED` entry with a reason. Never weaken a pattern.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Security review, supply chain, Helm | egress truth table fully mapped; parity tests; no `STRIPE` in Helm example |
| 2 | Runbooks, charter, reclassified docs | workflow/catalog/bin.ts diffs empty; `lint:doc-pointers` |
| 3 | Mirror schemas, tool + prompt copy, `geocodingAvailable` | G1 (~63) + G3 + GIS cases |
| 4 | Site-config flags + pricing labels | contract/service/integration/`packLabel` tests; root build |
| 5 | Site copy + glossary/FAQ/getting-started/routes | content tests; root build |
| 6 | Toolpack guide + dialogs, `.ods`, samples, transform caption | dialog + UploadStep tests |
| 7 | READMEs, CLAUDE.md, mirror deleted | script-existence check; `lint:review-chain` |
| 8 | G2 over docs + drift report | G2 green; PR body updated |

## Cross-slice notes

- **Core `dist`.** Slices 3 and 4 change core, which api and site consume from `dist`. Rebuild core (`npm run build` in `packages/core`) before running their suites. If the API dev server is used for a live check, touch an api source file afterwards.
- **Formatting.** The pre-commit hook formats staged `src/**`. Markdown is deliberately unformatted, so docs slices pass `format:check` trivially. Never `--no-verify`.
- **Product name.** It is "Portals AI" in every edited surface. Copy names permissions, not roles, in every slice; slice 8 enforces this over `docs/`, and the existing api/web guards cover source.
- **Follow-up citations.** Every "known exception" line cites its follow-up ticket (#909, #910, #911) so it can be found and removed when that ticket closes.
- **Smoke and adversarial gates.** After slice 8, `/smoke 615` maps the spec's acceptance criteria. Pricing, Help, the toolpack dialog and the upload step are agent-walkable, and the Helm residency boot is a backend check.

## Next step

Implementation starts on this branch at slice 1, after this plan is confirmed, with one commit per slice.
