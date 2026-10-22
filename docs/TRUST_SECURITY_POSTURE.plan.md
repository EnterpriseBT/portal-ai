# Customer-facing trust & security posture — Plan

**TDD sequence for #613's work:**
- the `SECURITY_EMAIL` contact role;
- one shared subprocessor list, guarded against the API's egress;
- the `/security/` page, with evidence and forbidden-claims guards;
- the RFC 9116 `security.txt` endpoint and its build check;
- the copy corrections that make every public and internal surface agree.

Spec: `docs/TRUST_SECURITY_POSTURE.spec.md`. Discovery: `docs/TRUST_SECURITY_POSTURE.discovery.md`. Issue: #613 (epic #578). It builds on controls already on `main`: #571–#577, #598–#622, #660.

There are five slices. Each one goes behind a green test suite and leaves the repo compilable. They land as **commits on `feat/613-trust-security-posture`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit -- --testPathPattern subprocessor-egress-parity
cd apps/site && npm run test:unit
cd packages/devops-cli && npm run test:unit
```

Each slice:
1. write failing tests;
2. make the smallest change that greens them;
3. do a focused run;
4. run `npm run lint && npm run type-check` (plus `npm run format:check`) in each touched package at the boundary;
5. move to the next slice.

Every slice that touches `apps/site` also runs `npm run build` there, because `verify-pages` is part of `build` and is the site's real gate.

Sequencing rationale:
- **Slice 1:** `SECURITY_EMAIL` comes first, because both the page (slice 3) and `security.txt` (slice 4) render it. It's pure plumbing with no new public surface.
- **Slice 2:** the subprocessor data and its API parity guard come before any page renders them. Privacy switches to the shared data with no change in substance, which proves the module renders before the new page depends on it.
- **Slice 3:** the `/security/` page, built on slices 1 and 2.
- **Slice 4:** `security.txt`, which needs slice 1's contact and points its `Policy:` at slice 3's `#disclosure`. The page's link to `security.txt` lands here, so it never points at a file that doesn't exist.
- **Slice 5:** the copy corrections and the follow-up issue. They go last because they reference the page (`/security/`) that slice 3 creates.

No migration and no seed.

---

## Slice 1 — `SECURITY_EMAIL` contact role

A fourth role, wired through every layer like `ADMIN_EMAIL`. Nothing renders it yet.

**Files**

- Edit:
  - `apps/site/src/lib/contact.ts`: add `securityEmail`.
  - `apps/site/src/lib/site-context.ts`: add it to the re-export.
  - `apps/site/turbo.json`: add `SECURITY_EMAIL` to `passThroughEnv`.
- Edit: `apps/site/src/lib/__tests__/contact.test.ts`: add the role to the role lists.
- Edit:
  - `.github/workflows/deploy-static-site.yml`: resolve and pass `security-email`.
  - `.github/workflows/deploy-dev.yml`: seed `/portalai/dev/security-email`.
- Edit:
  - `packages/devops-cli/src/catalog.ts`: add the `SECURITY_EMAIL` site-config entry.
  - `src/__tests__/catalog.test.ts` and `src/__tests__/deploy-parity.test.ts`: add it to the expected lists.
- Edit the docs listed in the spec's `SECURITY_EMAIL` table:
  - `packages/devops-cli/COMMANDS.md`
  - `docs/DEPLOYED_ENV_CONFIG.md`
  - `docs/PROD_PROVISIONING.runbook.md`, with the "set before the first prod release" step
  - `docs/PORTALSAI_MAIL.runbook.md`, with the `security@` alias and the 180-day `Expires` rebuild note

**Steps**

1. **Tests (spec: site `contact.test.ts` edit; devops-cli catalog + deploy-parity).**
   - Write the expectations for `securityEmail`, including the QA fallback when unset.
   - Write the expected SSM key list and catalog-only list.
   - Run them and confirm they fail. The turbo guard in `contact.test.ts` fails too, until `turbo.json` is updated.
2. **Implement** the exports, the turbo entry, the catalog entry and the workflow steps. Green.
3. Lint, type-check and format. Run `npm run lint:ci-cache` from the root, because `turbo.json` changed (rule 5 inspects the site's `passThroughEnv`).

**Done when:** the site and devops-cli suites are green, `securityEmail` resolves, and no page references it yet.

**Risk:** the workflow edits can only be fully exercised on the app-dev deploy. Check the step against its two siblings line by line.

---

## Slice 2 — Shared subprocessor list + egress parity guard

One source for the list, checked against every env var the API reads. The privacy policy renders from it, and the dead `@ai-sdk/groq` dependency goes.

**Files**

- New:
  - `packages/core/src/content/subprocessors.util.ts`: `SUBPROCESSOR_IDS`, `SUBPROCESSORS`, and the two notes.
  - `packages/core/src/__tests__/content/subprocessors.util.test.ts`.
- Edit: `packages/core/src/content/index.ts`: export the new module.
- New: `apps/api/src/__tests__/subprocessor-egress-parity.test.ts`: the `EGRESS` and `INTERNAL` maps and the four assertions.
- Edit: `apps/site/src/pages/privacy.astro`: render the "Third parties" list from `SUBPROCESSORS` plus `WEBHOOK_NOT_SUBPROCESSOR_NOTE`. The wording carries over verbatim; Google and Microsoft become two bullets. No effective-date bump yet, because nothing changes in substance. Slice 5 bumps it.
- Edit: `apps/api/package.json` and `package-lock.json`: run `npm uninstall @ai-sdk/groq --workspace @portalai/api`.

**Steps**

1. **Tests (spec: core cases, about 5).** Write them: unique ids, one entry per id, non-empty sentences, `usedWhen` nullability, non-empty notes. Run; fail.
2. **Implement** the core module. Green, with `content-purity.test.ts` still green.
3. **Tests (spec: api cases, about 5).** Write the parity test with the classification maps and a synthetic-unclassified-key case. Running it before every key is classified shows each unclassified key by name, and that list is the worklist. Classify all 87 keys. Green.
4. **Implement** the privacy rendering. Run `npm run build` in `packages/core`, then `npm run build` in `apps/site`. `verify-pages` stays green, and the rendered list matches the old one plus the split.
5. Remove groq, then run `npm run build` and `npm run test:unit -- --testPathPattern "ai|agent"` in `apps/api`, to confirm nothing loaded it.
6. Lint, type-check and format across core, api and site.

**Done when:**
- the core and api suites are green;
- the privacy page shows the eight entries from shared data;
- `apps/api` builds without groq.

**Risk:**
- **A misclassified key.** Each `INTERNAL` reason is a reviewable claim; flag `DEMO_TOOLPACK_URL`, `SSO_*`/`OIDC_*` and `UPLOAD_S3_ENDPOINT` in the commit message, as the spec review did.
- **A stale core build.** A core change needs a root `npm run build` before pushing, because the site's Astro build consumes core's `dist`.

---

## Slice 3 — `/security/` page, controls and claim guards

The public page with its controls, data & AI, subprocessors and disclosure sections, plus the tests that keep its claims honest.

**Files**

- New:
  - `apps/site/src/lib/security-controls.ts`: `SECURITY_CONTROLS` (the ten spec entries with `evidence`) and `FORBIDDEN_CLAIMS`.
  - `apps/site/src/lib/security-page.ts`: `DATA_AND_AI_PARAGRAPHS` and `DISCLOSURE_PARAGRAPHS(email)`.
  - `apps/site/src/lib/__tests__/security-controls.test.ts`.
- New: `apps/site/src/pages/security.astro`, with the `#controls`, `#data-and-ai`, `#subprocessors` and `#disclosure` sections.
- Edit:
  - `apps/site/src/components/SiteFooter.astro`: add the Security link.
  - `apps/site/public/llms.txt`: add Security, Privacy and Terms to "Canonical pages".

**Steps**

1. **Tests (spec: site `security-controls.test.ts`).** Write them:
   - ids are unique and anchor-safe;
   - every evidence path exists from the repo root (resolve the root from the test file, not the working directory, as `env-example-parity` does);
   - no forbidden phrase appears in any claim or page paragraph;
   - the disclosure text contains the email, "5 business days", "7 days" and "30 days".

   Run; fail.
2. **Implement** the two `src/lib` modules. Green.
3. **Build the page and add the footer and `llms.txt` links.** Run `npm run build` in `apps/site`: `verify-pages` must pass, which proves a single h1, the description length, JSON-LD, the canonical URL, the page in the sitemap and no empty `mailto:`.
4. Check the layout by hand: `astro preview` at 375px and at desktop width, in light and dark, with no horizontal scroll.
5. Lint, type-check (`astro check`) and format.

**Done when:**
- the site suite and build are green;
- `/security/` renders all four sections;
- the footer link appears on every page.

**Risk:**
- **The claim wording is the product here.** The tests only catch deletions and the known overclaims, so the PR body lists every claim for review.
- **The page is not linked from the header.** The spec doesn't put it there; leave it out.

---

## Slice 4 — `/.well-known/security.txt`

The RFC 9116 file, rendered at build time and checked by `verify-pages`.

**Files**

- New:
  - `apps/site/src/lib/security-txt.ts`: `renderSecurityTxt` and `SECURITY_TXT_TTL_DAYS`.
  - `apps/site/src/lib/__tests__/security-txt.test.ts`.
- New: `apps/site/src/pages/.well-known/security.txt.ts`: the `GET` endpoint.
- Edit: `apps/site/scripts/verify-pages.mjs`: export `checkSecurityTxt(text, { now, origin })` and call it on `dist/.well-known/security.txt`.
- New: `apps/site/scripts/__tests__/verify-security-txt.test.ts`.
- Edit: `apps/site/src/pages/security.astro`: in `#disclosure`, link to `/.well-known/security.txt`.

**Steps**

1. **Tests (spec: `security-txt.test.ts`, about 5).** Cover field order, `Expires` at 180 days in `Z` form, trailing-slash normalization, LF endings plus a trailing newline, and the `mailto:` contact. Run; fail. **Implement** `renderSecurityTxt`. Green.
2. **Tests (spec: `verify-security-txt.test.ts`, about 7).** Cover:
   - a valid file passes;
   - a missing `Contact` fails;
   - an empty `mailto:` fails;
   - a past `Expires` fails;
   - an unparseable `Expires` fails;
   - a foreign-origin `Canonical` fails;
   - a duplicate `Expires` fails.

   Run; fail. **Implement** `checkSecurityTxt`. Importing `verify-pages.mjs` must not run the build check, so guard the script body behind an `import.meta.url === pathToFileURL(process.argv[1]).href` check, or move the helper to `scripts/lib/`. Green.
3. **Add the endpoint and wire the check.** Run `npm run build` in `apps/site`. The file must appear at `dist/.well-known/security.txt` and pass `verify-pages`.
   - **If Astro doesn't route the dot-directory**, the build fails right here, as designed. Apply the spec's fallback in the same slice: a post-build `node` step that writes the file from `renderSecurityTxt`, run before `verify-pages` in the site's `build` script.
4. Add the link from the page. Lint, type-check and format.

**Done when:**
- the site suite is green;
- the build emits a valid `security.txt`;
- deleting the file, or making it invalid, fails `npm run build`.

**Risk:**
- **The dot-directory routing.** The fallback above handles it inside the slice.
- **Content-Type.** Whether the deployed site serves the file as `text/plain` depends on the S3 sync's guess. Check it in smoke, not here.

---

## Slice 5 — Copy corrections + follow-up issue

Every existing surface that disagrees with the page is brought into line.

**Files**

- Edit: `apps/site/src/pages/privacy.astro`:
  - make the Security paragraph's encryption sentence precise and add a link to `/security/`;
  - bump `EFFECTIVE_DATE_ISO` and `EFFECTIVE_DATE_LABEL` to the commit date.
- Edit: `apps/site/src/pages/terms.astro:33`:
  - correct the identity-provider sentence;
  - bump `EFFECTIVE_DATE_ISO` and `EFFECTIVE_DATE_LABEL`.
- Edit: `docs/DEPLOYMENT_SECURITY_REVIEW.md`:
  - §1, §2 and the baseline list the full subprocessor set and point at the parity test;
  - "zero-retention" is removed;
  - non-root is marked shipped.
- Edit: `apps/site/src/lib/__tests__/security-controls.test.ts`: extend the forbidden-claims scan to the Security section of privacy and to terms.

**Steps**

1. **Tests.** Extend `security-controls.test.ts` so the forbidden-claims scan also covers the rendered `privacy.astro` and `terms.astro` text, by reading the built `dist/privacy/index.html` when it exists, or the `.astro` source. Today it catches the blanket "encryption in transit and at rest". Run; fail.
2. **Implement** the privacy and terms edits. Green. Run `npm run build` in `apps/site`.
3. **Edit the review doc** to match `SUBPROCESSORS` and the egress test.
4. **File the follow-up issue:** `gh issue create`, typed `Feature`, as a sub-issue of #578: "Enable ElastiCache encryption at rest + in transit (`rediss://`)". It references `infra/cloudformation/cache.yml` and the `/security/` claim it would widen. Add its row to #578's Status table, writing the full body to a file first and checking the edit before applying it.
5. Lint, type-check, format, and `npm run lint:doc-pointers` from the root.

**Done when:**
- privacy and terms carry new effective dates and no forbidden claim;
- the review doc agrees with the page;
- the follow-up issue exists and is linked from #578.

**Risk:**
- **Terms is legal-owned.** Flag the edit in the PR body for legal review.
- **The privacy scan must be precise.** A source-text scan can false-positive on a word like "Redis" in a future privacy paragraph. Scan only the Security section, extracting its `SECTIONS` entry by heading.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `SECURITY_EMAIL` role end to end | site + devops-cli unit, `lint:ci-cache` |
| 2 | Core `SUBPROCESSORS`, API egress parity, privacy renders shared list, groq removed | core + api + site unit, site build |
| 3 | `/security/` page, controls and claim guards, footer, `llms.txt` | site unit + build (`verify-pages`), manual 375px/theme check |
| 4 | `security.txt` endpoint and `verify-pages` check | site unit + build emits a valid file |
| 5 | Privacy/terms/review-doc corrections, ElastiCache follow-up | site unit + build, `lint:doc-pointers` |

## Cross-slice notes

- **Core → site build order.** From slice 2 on, run `npm run build` at the root before any push. A per-package type-check misses core ripples, and committing with `--no-verify` would skip the Prettier hook that CI's `format:check` runs.
- **`verify-pages` is the site's real test.** Every site slice ends with `npm run build`, not just `test:unit`.
- **Doc sync.** Slice 1 covers the contact-role docs, slice 2 covers `privacy.astro`, and slice 5 covers `DEPLOYMENT_SECURITY_REVIEW.md`. CLAUDE.md's doc-sync table already names that review doc for egress changes. Also add a row: changing `SUBPROCESSORS` or an egress env var also changes `/security/` through shared data, so no hand edit is needed, but the parity test must stay green. Make that CLAUDE.md row (and its `.github/copilot-instructions.md` mirror) part of slice 2.
- **Things the PR body has to call out:**
  - set `SECURITY_EMAIL` on prod before release;
  - create the `security@` Workspace alias;
  - legal review of the terms and privacy sentences;
  - the full list of claims made by the controls.

## Next step

Implementation starts on this branch once the plan is confirmed. Slice 1 goes first, tests first, one commit per slice.
