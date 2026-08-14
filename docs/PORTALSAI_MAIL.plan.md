# portalsai.io mail — Plan

**TDD-sequenced implementation: the `ADMIN_EMAIL` key, the two front ends moved onto env vars, the deletion of the runtime contact path, the app repoint off a personal address, and the mail DNS stack behind a maintainer runbook.**

Spec: `docs/PORTALSAI_MAIL.spec.md`. Discovery: `docs/PORTALSAI_MAIL.discovery.md`. Issue: #369.

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/portalsai-mail`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/devops-cli && npm run test:unit
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/web && npm run test:unit
cd apps/site && npm run build      # the site's gate is its build + verify-pages
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale — one deviation from the spec's suggested order, and it is load-bearing.** The spec's *Next step* lists the contract/API deletion second. That would break the tree: `apps/site` reads `siteConfig.contact.supportEmail` in four files, so removing the field from `PublicSiteConfigResponseSchema` while the site still reads it fails `type-check` at that slice's boundary. **The site has to stop reading `contact` before the field can be deleted.** So:

- **Slice 1** — the catalog key. Independent of everything; nothing reads it yet.
- **Slice 2** — `apps/site` reads env instead of the fetched `contact`. The contract still carries the field, now unread.
- **Slice 3** — delete the field, the fixture block, `BusinessConfigService`, and the fail-closed check. Safe only because slice 2 landed.
- **Slice 4** — `apps/web` off the personal address. Independent of 2–3; placed here so the deletion and the repoint review separately.
- **Slice 5** — the DNS stack and the workflow env wiring. First slice that isn't CI-verifiable.
- **Slice 6** — runbook and charter rows.

No DB migration. Slices 1–4 are fully CI-verifiable; 5–6 are gated by the maintainer's runbook walkthrough at smoke time.

---

## Slice 1 — The `ADMIN_EMAIL` catalog key

One entry and its two pins. Nothing reads the value yet.

**Files**

- Edit: `packages/devops-cli/src/catalog.ts` — `{ ...ssm("ADMIN_EMAIL", "admin-email"), siteConfig: true }` beside the two existing entries (`:73-74`).
- Edit: `packages/devops-cli/src/__tests__/catalog.test.ts` — the sorted `byKind("ssm")` pin (`:26-37`) and the `siteConfig` assertion (`:87-89`).
- Edit: `packages/devops-cli/COMMANDS.md:60-75` — the marketing-site business-config section.

**Steps**

1. **Tests (spec cases 1–3).** `ADMIN_EMAIL` is an SSM entry with leaf `admin-email`; it appears in the sorted `byKind("ssm")` list; the `siteConfig` set is exactly `["SUPPORT_EMAIL", "SALES_EMAIL", "ADMIN_EMAIL"]`; `pathFor` resolves `/portalai/{env}/admin-email`. Run; fail.
2. **Implement** the catalog entry. Green.
3. Lint + type-check.

**Done when:** cases 1–3 pass and `portalops vars set ADMIN_EMAIL` is a valid command with nothing consuming the value.

**Risk:** none — additive, and both pins are updated in the same commit.

---

## Slice 2 — `apps/site` reads email from env

The site stops asking the API for addresses. The contract is untouched, so the field simply goes unread.

**Files**

- Edit: `apps/site/src/lib/site-context.ts` — export `supportEmail` / `salesEmail` / `adminEmail` from `process.env` with the `qa@portalsai.io` fallback, alongside the existing `siteUrl` / `appUrl` (`:47-53`).
- Edit: `src/components/SiteFooter.astro:7,25-26`, `src/pages/contact.astro:9,37-51` — read from `site-context`.
- Edit: `src/pages/terms.astro:10,78-79`, `src/pages/privacy.astro:12,81-82` — show **`adminEmail`** as the legal contact.
- Edit: `src/lib/jsonld.ts:16-29` — `organizationLd` takes the support address from `site-context`.

**Steps**

1. **Tests (spec cases 17, 19).** `site-context` exports the three addresses from `process.env` and falls back to `qa@portalsai.io` when unset. `verify-pages.mjs` still fails a page containing `href="mailto:"` — re-pinned because it becomes the primary gate. Run; fail.
2. **Implement** the env reads and repoint the four render sites. Green.
3. `cd apps/site && npm run build` with the env unset → every address renders `qa@portalsai.io`, and `verify-pages` passes.
4. Lint + type-check.

**Done when:** cases 17 and 19 pass, the built site contains no `mailto:` with an empty target, and nothing in `apps/site` reads `siteConfig.contact`.

**Risk:** the JSON-LD `contactPoint` is public structured data — check the built output, not just the source, that it carries a real address.

---

## Slice 3 — Delete the runtime contact path

The breaking change, in its own reviewable commit. Safe only because slice 2 removed the last reader.

**Files**

- Edit: `packages/core/src/contracts/site-config.contract.ts` — delete `PublicSiteContactSchema` and the `contact` field.
- Edit: `packages/core/src/__tests__/contracts/site-config.contract.test.ts` — delete the contact describe (`:83-98`), drop `contact` from the response fixture.
- **Delete:** `apps/api/src/services/business-config.service.ts` and `apps/api/src/__tests__/services/business-config.service.test.ts`.
- Edit: `apps/api/src/services/site-config.service.ts:60-82` — stop awaiting contact; drop the fail-closed contact branch, keep the price branch.
- Edit: `apps/api/src/constants/api-codes.constants.ts:71`, `apps/api/src/environment.ts:99-100`, `apps/api/.env.example`.
- Edit: `apps/site/src/lib/site-config.fixture.json:89-92` and `src/lib/site-config.ts` — **must move with the schema**: the fixture is parsed against a `strictObject`, so leaving its `contact` block would fail the moment the field is removed.
- Edit: `apps/site/scripts/preflight-site-config.mjs:55-66` — drop the contact remediation lines.

**Steps**

1. **Tests (spec cases 4–10).** The response schema parses `{tiers, generatedAt}` and **rejects** an extra `contact` key; `PublicSiteContactSchema` is no longer exported; `getSiteConfig()` returns no `contact` but still fails closed on an unresolved tier **price**; the endpoint responds 200 with the reduced payload and its existing cache headers; nothing imports `BusinessConfigService`; `SITE_CONFIG_CONTACT_UNRESOLVED` is absent from `ApiCode`. Run; fail.
2. **Implement** the deletions, fixture and schema together. Green.
3. `cd apps/site && npm run build` — proves the fixture still parses.
4. Lint + type-check; full `apps/api` and `packages/core` suites.

**Done when:** cases 4–10 pass, the API no longer references an email anywhere, and the site builds against the reduced contract.

**Risk:** the ordering above is the whole risk. If `type-check` fails here on an `apps/site` file, slice 2 missed a reader — fix it in slice 2's file set rather than patching around it. Deleting a public contract field is called out in the PR body, not left to a diff.

---

## Slice 4 — `apps/web` off the personal address

The bug the ticket opened with.

**Files**

- New: `apps/web/src/utils/contact.util.ts` + `apps/web/src/__tests__/contact.util.test.ts`.
- Edit: `apps/web/src/utils/tier-format.util.ts:16` (remove `SUPPORT_MAILTO`), `src/vite-env.d.ts`, `.env.example`.
- Edit: `src/views/Help.view.tsx:34,233`, `src/components/TierCard.component.tsx:18,232`, `src/components/SubscriptionBilling.component.tsx:135`.
- Edit: `src/__tests__/{TierCard.component,SubscriptionBilling.component,HelpView}.test.tsx`.
- Edit: `apps/web/README.md:33`, `docs/SUBSCRIPTION_TIER_CARDS.spec.md:199`, `docs/SUBSCRIPTION_TIER_CARDS.smoke.md:61`.

**Steps**

1. **Tests (spec cases 11–16).** `contact.util` exposes the addresses from `VITE_*` when set and falls back to `qa@portalsai.io` — **not** an empty string — when unset; `HelpView` renders the support address as both `href` and **visible link name**; `TierCard`'s CTA uses `SUPPORT_MAILTO`; `SubscriptionBilling` renders a `sales@` link; and a guard asserts no file under `apps/web/src` contains `btdev.io`. Run; fail.
2. **Implement** `contact.util`, then repoint the three components. Green.
3. Lint + type-check + `format:check`.

**Done when:** cases 11–16 pass and `grep -rn "btdev.io" apps/ packages/ docs/` returns nothing.

**Risk:** the smoke doc at `SUBSCRIPTION_TIER_CARDS.smoke.md:61` currently **instructs a human to verify the wrong address** — a checklist that passes only while the bug exists. Fixing the code without fixing that line leaves a trap for the next walkthrough.

---

## Slice 5 — Mail DNS + the workflow env wiring

First slice that CI cannot fully verify. Everything here is asserted by deploy and by the runbook.

**Files**

- New: `infra/cloudformation/dns-email.yml` — MX, SPF TXT, DMARC TXT, DKIM CNAME behind `Condition: HasDkim`; parameters `HostedZoneId`, `DomainName`, `DkimValue`, `DkimSelector`. Header comment states that mail is domain-wide (no `Environment` parameter) and why DKIM is conditional.
- Edit: `.github/workflows/deploy-dev.yml` — add the stack to `deploy-infra` (`:24-140`); add `admin-email` to the seed block and set all three dev seeds to `qa@portalsai.io` (`:317-337`); resolve the two web values from SSM in `deploy-frontend` and add them to the `VITE_*` build env (`:163-168`).
- Edit: `.github/workflows/deploy-static-site.yml:116-132` — resolve all three from SSM and add to the build env.

**Steps**

1. **Tests.** No unit cases exist for CloudFormation or workflow YAML in this repo, and inventing a snapshot test for a template nobody can deploy in CI would be theatre. Instead: `aws cloudformation validate-template` on the new file as the mechanical check, and the spec's **Layer 6** records that delivery, SPF/DKIM/DMARC, and the deploy itself are smoke-only.
2. **Implement** the template and the three workflow edits.
3. Lint + type-check (unchanged surfaces), full suites green.

**Done when:** the template validates, the workflows reference it, and the build env carries the three values. Verified for real only at smoke.

**Risk:** two. `seed()` is create-if-absent, so app-dev's two existing parameters keep their `support@`/`sales@` values — a one-time `portalops vars set` is required and belongs in the runbook, not in a hope. And the stack name carries **no environment segment** (`portalai-dns-email`); adding one would imply per-environment mail records, which is wrong.

---

## Slice 6 — Runbook and charter rows

The half a human executes, written down.

**Files**

- New: `docs/PORTALSAI_MAIL.runbook.md` — Workspace tenant → paid seat `admin@` → `support@`, `sales@`, **`qa@`** as free aliases → domain verification → DKIM key → redeploy with `DkimValue` → external SPF/DKIM/DMARC validation → the one-time `portalops vars set` for app-dev's two pre-seeded values → a line on mail retention as a Workspace policy decision.
- Edit: `docs/CLI_OPERATIONS_CHARTER.md` — DNS/registrar/mailbox rows as an **out-of-band, runbook-driven** category; recompute the coverage figures at `:189-211` (today D=45 N=44 97.8%).

**Steps**

1. **Tests.** None — these are prose. The runbook's correctness is established by the maintainer executing it at smoke, which is the honest gate.
2. **Write** both documents.
3. `format:check` (markdown is deliberately unformatted per CLAUDE.md, so this is a no-op) + a read-through against the actual Workspace console flow.

**Done when:** a reader who has never seen this ticket can provision the mailboxes from the runbook alone, and the charter no longer leaves "provision mailboxes" unclassified.

**Risk:** a runbook written from documentation rather than from doing it. The smoke walkthrough is where its steps get corrected — expect edits after the first real run, and treat those as part of this PR rather than a follow-up.

---

## Sequence summary

| Slice | Lands | Spec cases | Gate | CI-verifiable |
|---|---|---|---|---|
| 1 | `ADMIN_EMAIL` catalog key + pins | 1–3 | devops-cli unit | yes |
| 2 | `apps/site` reads env | 17, 19 | site build + verify-pages | yes |
| 3 | **Contract + API deletions** | 4–10 | core + api unit, site build | yes |
| 4 | `apps/web` repoint + doc fixes | 11–16 | web unit | yes |
| 5 | `dns-email.yml` + workflow env | — | template validate | **no** — smoke |
| 6 | Runbook + charter rows | — | read-through | **no** — smoke |

≈ **19 cases**, no DB migration, one new CloudFormation stack.

---

## Cross-slice notes

- **The slice 2 → 3 order is the plan's one hard constraint.** Four `apps/site` files read `siteConfig.contact`; the field cannot be deleted until they stop. If slice 3's `type-check` fails on a site file, the fix belongs in slice 2's file set.
- **The fixture moves with the schema.** `site-config.fixture.json` is parsed against a `strictObject`, so its `contact` block and the schema field must be deleted in the *same* commit — splitting them breaks the site build in between.
- **Nothing renders an empty `mailto:` at any slice boundary.** The `qa@portalsai.io` fallback exists from slice 2 (site) and slice 4 (app), so even before slice 5 wires the deploy env, builds render an address we own. That is what makes 2–4 safely mergeable ahead of 5.
- **`seed()` never overwrites.** App-dev's `support-email` and `sales-email` already hold customer-facing addresses; only a manual `portalops vars set` changes them. It is a runbook step **and** a smoke check, because a staging surface showing `support@` is precisely the leak this ticket exists to prevent.
- **Doc-sync is inside the slices, not deferred** (CLAUDE.md → "Keeping Documentation in Sync"): `COMMANDS.md` in slice 1, `README.md` and both `SUBSCRIPTION_TIER_CARDS` docs in slice 4, the charter in slice 6. The smoke doc's wrong-address instruction is a bug in this PR, not a follow-up.
- **`apps/site` has no jest suite** — its gate is `npm run build` plus `verify-pages.mjs`. Slices 2 and 3 must run that build, not just the unit suites.
- **Prod stays untouched.** `deploy-site-prod.yml`'s early-exit still governs; prod values are a follow-up on #83. The DNS stack is the exception — it is domain-wide and deployed once.

---

## Next step

Implementation begins on this branch — slice 1 first, tests before code — once discovery, spec, and plan are reviewed and confirmed. Before slice 3, re-read the cross-slice note on ordering: it is the difference between a clean deletion and a broken build.
