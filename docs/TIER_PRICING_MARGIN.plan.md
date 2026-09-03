# Profit-optimized production tier pricing — Plan

**Sequenced execution of the margin pass: gather live cost inputs into the durable model, decide numbers against thresholds T1–T4, land the catalog + guard tests, roll out to production, file the justified follow-ups.**

Spec: `docs/TIER_PRICING_MARGIN.spec.md`. Discovery: `docs/TIER_PRICING_MARGIN.discovery.md`. Issue: #495. Builds on shipped #325/#394 (current ceilings + live prices), #218 (`tier apply`), #176/#260 (billing surface).

Five slices, each a commit (or small commit group) on **`feat/tier-pricing-margin`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"). This ticket is unusual: slices 1–2 are **analysis commits** whose gate is the spec's pinned doc shape (there is no unit suite for a cost model — saying so per the plan rules rather than padding fake test steps); slice 3 is the one classic TDD code slice; slice 4 is operator work gated by the smoke doc; slice 5 is close-out.

For the code slice, tests run via npm scripts only (`feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
```

Sequencing rationale — inputs before decisions, decisions before code, code merged before prod converges, follow-ups after the numbers are final:

- **Slice 1** — the model doc skeleton + every live input, so the decision pass argues from data.
- **Slice 2** — the analysis + decision record; **ends at a user gate** (thresholds + decided numbers confirmed).
- **Slice 3** — the catalog/tests/copy commit; needs slice 2's numbers, and slice 1's doc must exist for the catalog comment's `lint:doc-pointers`-gated citation.
- **Slice 4** — rollout; needs the merged numbers (Stripe writes reference the decided amounts; `tier apply` converges the merged catalog).
- **Slice 5** — follow-up tickets carry the model's final figures, so they file last.

No migration, no seed change (spec → Migration/Seed).

---

## Slice 1 — `docs/TIER_PRICING_MODEL.md` skeleton + live inputs

Create the durable model doc with all seven spec-pinned sections, and populate the three *input* sections with sourced values.

**Files**

- New: `docs/TIER_PRICING_MODEL.md` — sections per spec §Surface: Vendor rate table · Fixed monthly cost · Usage scenarios · Formulas · Per-tier results · Decision record · Re-run procedure (later sections scaffolded, filled in slice 2).

**Steps**

1. **Baseline reads (recorded into the doc):**
   - Stripe live: current prices on `plus_monthly`/`pro_monthly` + live subscription count — read-only inspection key per `docs/STRIPE_CLI_OPS.md`.
   - AWS prod: live stack parameters (`aws cloudformation describe-stacks`) for backend/database/cache/frontend/site → fixed monthly cost table. (Container caveat: `aws login --remote` in a real terminal, then `eval "$(aws configure export-credentials --format env)"` before any JS-SDK-backed `portalops` call — `project_aws_login_sdk_limitation`.)
   - Usage aggregates: `tool_usage_ledger` per-tool/per-class totals for the periods that exist (read-only SQL via `portalops db psql --env prod`), snapshotted into §Usage scenarios (ledger retention time-bounds re-reads).
   - Vendor rates: published Anthropic (Sonnet 4.6 in/out, Opus 4.8 for codegen — ids cross-checked against `ai.service.ts`), Tavily, Mapbox pricing — each row with source URL + as-of date.
2. **Gate (no unit suite):** the doc-shape checklist against spec §Surface item-by-item — all seven sections present, every rate row carrying source + as-of, fixed costs from *live* params not CFN defaults. `npm run lint` at root (doc-pointer lint sees the new durable doc).
3. Commit: `docs: tier pricing model — inputs baseline (#495)`. Open the draft PR (`Closes #495`) so subsequent slices grow it.

**Done when:** the model doc exists with populated inputs and scaffolded analysis sections; the Stripe baseline (prices + subscriber count) is recorded.

**Risk:** prod reads blocked (credentials, key not provisioned). Surface immediately rather than substituting guesses — an input the operator can't read yet gets an explicit `TODO(source)` marker, and slice 2 cannot conclude while one remains.

---

## Slice 2 — Analysis + decision record (**user gate**)

Fill the model: scenarios, formulas with the confirmed thresholds, per-tier results, the decision record, and the structural evaluations.

**Files**

- Edit: `docs/TIER_PRICING_MODEL.md` — §Usage scenarios (light/expected/heavy per tier, ledger-justified or marked estimates), §Formulas (T1–T4 spelled with confirmed values), §Per-tier results (price, expectedCost, ceilingCost, margin, pass/fail), §Decision record (dated amounts + allocations + grandfather posture given the actual subscriber count), §Re-run procedure. Structural evaluations (annual, top-ups, agent-turn ceiling, `perToolCaps` enforcement) each end `implement-here | file-follow-up | rejected(reason)`.

**Steps**

1. **Confirm thresholds with the user first** — T1 80% margin, T2 ≤2× ceiling exposure, T3 $5/$25 free-tier budget, T4 custom floor (spec Key decision 6) are proposals until confirmed; the arithmetic runs against the confirmed values.
2. Compute per-tier results; where a tier fails T1/T2, adjust price or allocation and re-state — the doc shows the failing first pass and the adjustment, not just the answer.
3. Write the decision record + structural verdicts.
4. **Gate:** every T1–T4 row has an explicit pass/fail; no `TODO(source)` markers remain; **the user confirms the decided amounts and allocations before slice 3 starts** — this is the review the whole ticket exists for.
5. Commit: `docs: tier pricing model — analysis + decision record (#495)`.

**Done when:** the model is complete and the user has signed off on the numbers.

**Risk:** thin usage data pushes the "expected" scenario toward guesswork. Mitigated by the three-scenario sensitivity + labeled estimates (spec Risks); the re-run procedure is the corrective, not false precision now.

---

## Slice 3 — Catalog magnitudes + guard tests + conditional copy (TDD)

The one code slice: pin the new invariants, land the decided allocations/entitlements, replace the safety-ceiling comment.

**Files**

- Edit: `packages/core/src/__tests__/registries/tier-catalog.test.ts` — spec cases 2–4 (metered ascent, entitlement-ladder monotonicity, rate/quota coherence).
- Edit: `packages/core/src/registries/tier-catalog.ts` — decided charge-grid numbers + `builtinToolpacks`/`customToolpacks` per the decision record; doc comment replaced per spec (cites `docs/TIER_PRICING_MODEL.md`; must-not-change fields untouched).
- Conditional edit: `packages/core/src/content/faq.util.ts` + its pinning test (spec case 5) — only if an entitlement set moved (the GIS/"Pro and Enterprise plans" sentence at `faq.util.ts:237`).

**Steps**

1. **Tests (spec cases 2–4).** Write the three invariants. Note honestly: these are *pinning* tests — they already pass against the current values (verified: current numbers satisfy all three), so red-first doesn't apply; their job is making a future regression loud. Run: green against old values.
2. **Implement:** the decided magnitudes/entitlements + the comment replacement. Guard tests (existing spec case 1 + new 2–4) stay green — a decided number that violates an invariant kicks back to slice 2, not to the test file.
3. Conditional FAQ copy (case 5) if entitlements moved; re-pin its test.
4. `cd packages/core && npm run test:unit`; root `npm run lint && npm run type-check && npm run test` (catalog values flow into api/web fixtures — a broken downstream assumption surfaces here).
5. Commit: `feat(core): margin-tuned tier allocations + entitlements (#495)`.

**Done when:** spec cases 1–4 (+5 if triggered) pass; the catalog matches the decision record exactly; root suites green.

**Risk:** a downstream test pins a current allocation number as a fixture. If one fails, update the fixture to read from `TIER_CATALOG_BY_SLUG` rather than re-hardcoding.

---

## Slice 4 — Production rollout + smoke evidence

Operator work per spec §Rollout, gated by the smoke checklist. Run `/smoke 495` first to scaffold `docs/TIER_PRICING_MARGIN.smoke.md` from the spec's acceptance criteria.

**Files**

- New (via `/smoke`): `docs/TIER_PRICING_MARGIN.smoke.md` — then updated with evidence per step.

**Steps** (spec §Rollout, in order — prod guards mean every mutation carries `--yes --confirm-prod`):

1. Re-verify baseline (step 1) matches slice 1's recording; abort into a re-read if drifted.
2. Reprice changed tiers: `stripe prices create … --lookup-key <key> --transfer-lookup-key` against the live product ids.
3. **Rebuild the CLIs before running them** (`npm run build` — `npx portalops` executes `dist/`, `project_npx_uses_stale_dist`), then `portalops tier apply --env prod --yes --confirm-prod`; exit 8 = fix Stripe and re-run (idempotent).
4. Stripe Dashboard: Billing-Portal switch allow-list → new price objects.
5. Vendor caps: Anthropic/Tavily/Mapbox resized to the model's ceiling figures.
6. Verify: prod `site-config` payload, `www.portalsai.io/pricing`, Settings plan cards, one live checkout at the decided amount; grandfathered subs untouched.
7. Record evidence in the smoke doc — **the human checks the boxes**; steps 2–6 are manual-only (live Stripe/AWS/vendor dashboards), the verify reads are agent-assistable.

**Done when:** every smoke box is human-checked or carries a recorded reason (per `feedback_prod_smoke_scope`, prod smoke = vendor-integration checks; app logic was covered pre-merge).

**Risk:** partial rollout (prices created, apply failed). Safe order by construction — apply fails closed before any row write, and until apply succeeds nothing user-visible changed; rollback per spec (re-transfer lookup key + revert + re-apply).

---

## Slice 5 — Follow-up tickets + close-out

**Steps**

1. File each `file-follow-up` verdict from the model's structural evaluations as its own `/ticket`, body carrying the model's numbers (the T3 trigger makes the agent-turn ceiling mandatory-if-breached).
2. Confirm each `rejected` verdict is recorded with its reason in the model doc (spec acceptance criterion).
3. Append the doc links to issue #495's body (the issue is the index); PR out of draft.
4. Commit anything outstanding: `docs: record structural verdicts + follow-ups (#495)`.

**Done when:** spec acceptance criteria all hold; PR ready for the merge gate (CI green + human-confirmed smoke).

**Risk:** none — bookkeeping.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | model doc + live inputs (Stripe baseline, stack params, rates, ledger snapshot) | doc-shape checklist vs spec; no unverified input |
| 2 | analysis, T1–T4 results, decision record, structural verdicts | **user confirms thresholds + numbers** |
| 3 | catalog magnitudes/entitlements + 3 guard invariants (+ conditional FAQ) | spec cases 1–5; root suites green |
| 4 | Stripe live prices, `tier apply`, portal list, vendor caps | smoke doc, human-checked |
| 5 | follow-up tickets, issue index, PR ready | spec acceptance criteria |

Total ≈ **4–5 unit cases** (spec §TDD) — the substance is gated by slice 2's user sign-off and slice 4's smoke, as the spec says.

## Cross-slice notes

- **Two explicit user gates:** thresholds at slice 2 step 1, decided numbers at slice 2 step 4. Slice 3 must not start on unconfirmed numbers — the catalog commit is the irreversible-looking artifact reviewers anchor on.
- **`lint:doc-pointers` ordering:** the slice-3 catalog comment cites `docs/TIER_PRICING_MODEL.md` (durable, gated) — slice 1 lands it first, so the pointer never dangles.
- **Amounts hygiene:** decided dollar figures appear in `TIER_PRICING_MODEL.md` §Decision record only, as dated non-authoritative snapshots — never in `tier-catalog.ts`, tests, or fixtures (`feedback_pricing_lives_in_stripe`).
- **Doc-sync check (CLAUDE.md rule):** allocation numbers render from data (no copy edits); only entitlement moves touch prose (FAQ case 5). Glossary is qualitative and survives. No README/CLAUDE.md convention changes — this pass changes numbers, not machinery.
- **Operator environment:** live AWS needs the remote-login + `export-credentials` dance in this container; `stripe` CLI runs bare (vendor plugins removed); all prod mutations are `--yes --confirm-prod`-guarded; destructive prod ops are blocked outright — nothing in slice 4 is destructive.
- **Grandfather correctness** is code-verified, not hoped: terminal-status downgrade precedes the price lookup and unmapped-live-price holds the tier (`billing.service.ts:96-114`) — the expected "unmapped price" warnings on grandfathered subs are noted in the smoke doc so nobody treats them as a regression.

## Next step

With discovery, spec, and plan confirmed, implementation starts at slice 1 on this branch — the model-doc skeleton plus the live input reads (the first act is the Stripe baseline: current amounts + subscriber count).
