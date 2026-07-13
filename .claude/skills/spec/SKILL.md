---
name: spec
description: Phase 3a of the Issue → PR workflow — scaffold the contract doc for a feature. Reads the discovery doc already on the branch, writes docs/<SLUG>.spec.md (scope, surface/contract, TDD test plan, acceptance, risks), leaves it ready for the user to refine. Invoke as /spec [issue-number] after /discovery.
---

# /spec — scaffold the spec (contract) doc for an issue

You are scaffolding **phase 3a** of the workflow in `CLAUDE.md` → "Issue → PR Workflow". The spec is the **contract**: it pins the exact surface (signatures, schemas, columns, error codes, endpoint shapes) and the TDD test plan the plan doc will slice. It comes **after** discovery and **before** the plan — all three live on the **same** `feat/`/`fix/` branch.

You **do not commit, do not push, do not open a PR** — the user reviews and refines the draft first (same hand-off discipline as `/discovery`).

## Arguments

Invoked as `/spec [issue-number]`. The issue number is optional — if omitted, derive it from the discovery doc on the current branch (step 1). If you can't resolve exactly one issue, ask once and stop.

## Steps

### 1. Locate the discovery doc + issue on the current branch

The spec builds directly on discovery. Confirm you're set up:

```bash
git branch --show-current          # must be the feature branch, NOT main
git status --short                 # note any uncommitted work
ls docs/*.discovery.md             # find the discovery doc on this branch
```

- **Condensed-path detection.** If the branch carries a condensed single doc — `docs/<SLUG>.md` whose header says **small / condensed** — and no `docs/<SLUG>.discovery.md`, stop: this ticket took the condensed path (`/discovery <N> condensed`), and the contract + plan live in that single doc. Offer to extend the condensed doc instead; do not scaffold a separate spec.
- **The discovery doc is a prerequisite.** If there is no `docs/<SLUG>.discovery.md` on this branch, stop and tell the user to run `/discovery <N>` first (or point them at an existing discovery doc). Do not invent a spec from the issue alone — the spec's job is to make the discovery's *recommendations* concrete, and its **Open questions must be resolved** first.
- If you're on `main` (or a branch with no discovery doc), stop and ask which branch/doc to use. **Never create a new branch** — the spec commits to the *same* branch discovery created.
- Derive `<SLUG>` from the discovery file name. Fetch the issue:

```bash
gh issue view <N> --repo EnterpriseBT/portal-ai --json number,title,body,state,issueType
```

### 2. Read the discovery doc + one reference spec

- Read `docs/<SLUG>.discovery.md` in full. Its **Recommendation** and resolved **Open questions** are the decisions the spec turns into a contract. If any open question is still unresolved (no confirmed answer), **stop and surface it** — the spec can't pin a contract over an open decision.
- Read **one** existing spec to anchor the house style. Default to `docs/SUBSCRIPTION_TIER_POLICY.spec.md` (layered surface + per-layer test plan) or `docs/TOOL_COST_GATE.spec.md` (service-shaped). If the issue resembles another, prefer that one.

### 3. Pin exact current signatures (targeted, not a re-survey)

Discovery already surveyed the architecture. The spec needs the **exact** shape of what you'll extend — real signatures, real Zod schemas, real column lists, real error-code enum location. Lift file paths from the discovery doc's citations, then do **targeted `Read`s** of those specific symbols to get their current signatures right. Reach for a focused **Explore agent** only if discovery left a genuine gap in the surface you must specify. Do not re-run the whole discovery survey.

### 4. Write `docs/<SLUG>.spec.md`

Follow the house structure (adapt section granularity to the ticket — a single-package change collapses layers; a cross-cutting one expands them):

```markdown
# <Feature name> — Spec

<1–2 sentence lead: what this spec pins. Link the discovery doc + issue.>

## Key decisions (flag for review)

<Optional but recommended: a short numbered list lifting the discovery's resolved decisions + enterprise-scale leans that the reader should confirm are correctly captured before implementation. Omit only for the most trivial tickets.>

## Scope

### In scope
### Out of scope

## Surface

<The contract — the heart of the spec. One `###` subsection per file/symbol/artifact being added or changed. Spell out EXACT signatures, Zod schema fields + refinements, Drizzle columns + constraints, `ApiCode` additions (with the DOMAIN_FAILURE names), endpoint method+path+query params+`@openapi` shape, response/deny shapes. This is what the tests assert against — be precise, cite real paths.>

## Migration
## Seed

<Only when the DB schema changes. Name the migration (`npm run db:generate -- --name <…>`), the ordering constraints (e.g. seed-before-FK), and any backfill. Omit both if there's no schema change — say so explicitly.>

## TDD test plan

<One `###` per layer/package, each naming the real test file path and the representative cases. End with a **Totals ≈ N cases** line. Tests run via `npm run test:unit` / `npm run test:integration` from each package — NEVER invoke jest/npx directly (missing NODE_OPTIONS breaks ESM). Note explicitly if a migration/seed needs its own test, or if none is needed.>

## Acceptance criteria

<Checklist of externally-observable truths that must hold when the feature is done — not implementation steps.>

## Risks & rollback

<What could break, how it's detected, how to back out. For billing/contract/multi-tenant tickets, name the fail-mode (fail-open vs. fail-closed) and its cost/safety implication.>

## Files touched

<Bulleted new/edit list — the concrete file inventory the plan will sequence.>

## Next step

<One paragraph: the plan doc (`docs/<SLUG>.plan.md`) that follows, and roughly how many TDD slices it will carve — each a testable commit on this same branch.>
```

**Hard rules:**

- **The spec is a contract, not a design exploration.** Discovery weighs options; the spec states the chosen shape precisely enough that tests can be written against it. No "Lean:" lines here — decisions are already made.
- **Every open question from discovery must be resolved before you write the surface.** If one isn't, stop and get the answer.
- **No invented paths or signatures.** Cite real files; read the current signature before you specify its extension.
- **Test plan uses the npm scripts, never raw jest.** State the per-package commands and give a case-count total so the plan can slice to it.
- **Carry the enterprise-scale leans forward.** Any concurrency/auditability/failure-mode/multi-tenancy decision the discovery made must appear in the Surface or Key decisions — the spec is where "atomic conditional charge" or "split fail policy" becomes a named function/behavior, not prose.
- **Length: proportionate.** A localized change is 60–120 lines; a cross-cutting contract can run longer. The Surface section earns most of the length.

### 5. Hand off to the user

Stop. Do **not** stage, commit, push, or open a PR. Report:

- The doc you wrote and its line count.
- 2–3 things to confirm before the plan: any Key decision you inferred rather than found stated, any surface detail you had to guess, any spot where the discovery was thin.
- The next command: `/plan <N>` (once the spec is confirmed) — it lands on this same branch.

## What this skill is not

- It is **not** discovery. If there's no discovery doc and the ticket warrants one, send the user to `/discovery` first. For a *trivial* ticket (one-liner, localized bug) that skips discovery, a spec is usually overkill too — go straight to implementation, or use the condensed single-doc path.
- It does **not** slice the work into TDD phases — that's `/plan`. The spec's "TDD test plan" enumerates *what* is tested; the plan sequences *when* each slice lands.
- It does **not** create branches, run CI, move board cards, or commit. Discovery created the branch; implementation commits.
