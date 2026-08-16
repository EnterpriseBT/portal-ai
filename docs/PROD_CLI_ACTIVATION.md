# Prod CLI activation & doc sweep — Condensed design (#387)

**Issue:** [EnterpriseBT/portal-ai#387](https://github.com/EnterpriseBT/portal-ai/issues/387) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83) · Task · **small / condensed**.

**Why.** The epic's last child. Every vendor runbook carries a literal "prod (pending #83)" section, and the charter says "future `prod`" throughout. Those were true when written and are now wrong instructions to the next contributor — which the standing docs-in-sync rule treats as a bug in the PR that made them wrong, not a follow-up.

## Current shape

Two of the ticket's deliverables turn out not to need this ticket:

| Deliverable | Status |
|---|---|
| The `prod` registry entry | **Shipped in #384.** Moved there deliberately: overrides force `kind: "development"` and cannot shadow a built-in, so provisioning prod without it would have run every write unguarded |
| Live guard verification | **Cannot happen here.** Needs a provisioned prod; rolls into the epic-level smoke |
| `packages/{devops-cli,admin-cli}/COMMANDS.md` | **No change needed** — verified: zero "pending"/"future prod"/#83 markers, and the guard matrix is already written by env *class* (development / staging / production) rather than by name |
| `.github/copilot-instructions.md` | **No change needed** — `:93` already states prod's guards without hedging |

What is left is the sweep itself, over six files.

## Decision 1 — rewrite living references, leave historical records alone

`grep "pending #83"` also hits four **smoke docs**, including one signed off by name and date:

> *Signed off on **2026-07-10** by **Ben Turner** … §5 N/A-live until #83, unit-covered*

**Those are not stale — they are accurate records of what was walked on a date.** Rewriting them to say prod exists would falsify a signed artifact and destroy the only evidence of what was actually verified. The same holds for every `.discovery.md` / `.spec.md` / `.plan.md`: they record what was known when the decision was made.

**Decision: the sweep touches reference documentation only** — the docs a contributor reads to learn how the system works *today*. Records of a past walkthrough or a past decision stay exactly as written. Where a smoke doc's caveat is now historical, that is a feature of the record, not a defect in it.

## Decision 2 — "activated" must not overclaim either

The tempting rewrite turns *"prod is not yet provisioned — unexercised until #83"* into *"prod works; here are the commands"*. **That would be false at merge time.** The registry entry and the guards are live in code, but no prod environment has been provisioned — that happens when an operator executes the epic's runbooks, which merging this PR does not do.

Replacing a wrong statement with a differently-wrong statement is the same bug in the opposite direction.

**Decision: the sweep replaces "pending a ticket" with "pending provisioning, and here is the runbook".** Prod is described as what it verifiably is — a first-class registry environment whose guards are enforced in code — with resource-dependent commands pointed at `docs/PROD_PROVISIONING.runbook.md`, `docs/PROD_DEPLOY.runbook.md` and `docs/PROD_STRIPE_LIVE.runbook.md`. That phrasing is durable: it stays true whether the epic merged yesterday or prod goes live next month, and it never needs a third sweep.

## Plan — 1 slice

- **Tests** — extend `packages/devops-cli/src/__tests__/deploy-parity.test.ts`: no file under `docs/` **except** `*.smoke.md`, `*.discovery.md`, `*.spec.md` and `*.plan.md` contains the string `pending #83`, and `CLAUDE.md` does not describe `prod` as `future`. The exclusions are Decision 1 expressed as an assertion, so the distinction survives the next person running the same grep. Run; fail.
- **Files** (six):
  - `docs/AWS_CLI_OPS.md` — `:5` boundary line, `:136-138` the prod section
  - `docs/AUTH0_CLI_OPS.md` — `:5`, `:32`, `:108-110`
  - `docs/STRIPE_CLI_OPS.md` — `:88-90`
  - `docs/CLI_OPERATIONS_CHARTER.md` — `:3`, `:56`, `:81`, `:102` ("future `prod`")
  - `docs/NATIVE_CLI_COVERAGE.md` — `:46`, which lists live `prod` as a coverage gap
  - `CLAUDE.md` — `:449`, "`local` · `app-dev` · future `prod`"
- Green, then `npm run lint && npm run type-check`.

## Smoke (manual)

Rolls into the epic-level walk (#83), where the live guard verification belongs.

1. `grep -rn "pending #83" docs/` returns only smoke and design docs — the historical records.
2. `portalai login --env prod` completes the device flow.
3. `portalops db tunnel --env prod` connects through the bastion.
4. A destructive op against prod exits `6`; a non-destructive mutation without `--confirm-prod` exits `5`. *(Verified in code during #384 — this is the live confirmation.)*
5. `portalops vars list --env prod` and `portalai org list --env prod` return real prod data.
6. Every mutating op appended a line to `~/.portalai/audit.log`, and no line contains a secret value.

## Out of scope

- **Provisioning anything.** The runbooks are executed by an operator; merging this changes no environment.
- **Centralized audit** (#179), **vendor-CLI wrapping** (#224/#225/#226) — independent.
- **A least-privilege operator IAM role.** #384 found the operator identity is a full-admin IAM user, which is worth its own ticket and is not a documentation fix.
- Rewriting smoke or design docs (Decision 1).
