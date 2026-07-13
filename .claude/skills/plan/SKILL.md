---
name: plan
description: Phase 3b of the Issue → PR workflow — scaffold the phased TDD implementation plan. Reads the spec already on the branch, writes docs/<SLUG>.plan.md as ordered slices (each a testable commit) with a per-slice test-first loop, leaves it ready for the user to refine. Invoke as /plan [issue-number] after /spec.
---

# /plan — scaffold the phased TDD plan doc for an issue

You are scaffolding **phase 3b** of the workflow in `CLAUDE.md` → "Issue → PR Workflow". The plan turns the spec's contract into an **ordered sequence of TDD slices**, each a single testable unit that lands as **one commit** on the same branch (per `CLAUDE.md` → "Phase = commit, not PR"). It comes **after** the spec.

You **do not commit, do not push, do not open a PR** — the user reviews and refines the draft first (same hand-off discipline as `/discovery` and `/spec`).

## Arguments

Invoked as `/plan [issue-number]`. Optional — if omitted, derive from the spec doc on the current branch (step 1). If you can't resolve exactly one, ask once and stop.

## Steps

### 1. Locate the spec doc on the current branch

The plan builds directly on the spec. Confirm setup:

```bash
git branch --show-current          # must be the feature branch, NOT main
ls docs/*.spec.md docs/*.discovery.md
```

- **Condensed-path detection.** If the branch carries a condensed single doc — `docs/<SLUG>.md` whose header says **small / condensed** — and no `docs/<SLUG>.discovery.md`, stop: this ticket took the condensed path (`/discovery <N> condensed`), and the contract + plan live in that single doc. Offer to extend the condensed doc instead; do not scaffold a separate plan.
- **The spec doc is a prerequisite.** If there is no `docs/<SLUG>.spec.md` on this branch, stop and tell the user to run `/spec <N>` first. The plan sequences the spec's surface + test plan; without a pinned contract there's nothing to slice.
- If you're on `main` or a branch with no spec, stop and ask. **Never create a new branch** — the plan commits to the *same* branch discovery/spec used.
- Derive `<SLUG>` from the spec file name.

### 2. Read the spec (+ discovery) + one reference plan

- Read `docs/<SLUG>.spec.md` in full — its **Surface**, **TDD test plan** (case counts), and **Files touched** are the raw material you sequence. Skim `docs/<SLUG>.discovery.md` for the sequencing rationale (which decisions unblock which).
- Read **one** existing plan to anchor the house style. Default to `docs/TOOL_COST_GATE.plan.md` (clear slice shape + sequencing rationale) or `docs/SUBSCRIPTION_TIER_POLICY.plan.md`. If the issue resembles another, prefer it.

### 3. Decide the slice boundaries

A good slice is: **(a)** independently testable (its own failing-then-green suite), **(b)** leaves the repo compilable + all tests green at its boundary, **(c)** small enough to review as one commit. Sequence so each slice depends only on earlier ones (no forward deps) — pure/leaf logic first, wiring later, cleanup/lock last. Prefer 3–6 slices; a large feature may need more, a small one may be a single slice (say so rather than padding).

### 4. Write `docs/<SLUG>.plan.md`

Follow the house structure:

```markdown
# <Feature name> — Plan

**<1–2 sentence lead: what the plan implements, TDD-sequenced.>**

Spec: `docs/<SLUG>.spec.md`. Discovery: `docs/<SLUG>.discovery.md`. Issue: #<N> (epic #<M> if applicable). <Note any shipped dependency this builds on.>

<N> slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `<branch>`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd <pkg> && npm run test:unit
cd <pkg> && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — <one line per slice on why it sits where it does; call out which slice unblocks a dependent ticket, if any>.

---

## Slice 1 — <name>

<1–2 sentences on what this slice delivers.>

**Files**

- New: `<path>` — <what>.
- Edit: `<path>` — <what>.

**Steps**

1. **Tests (spec cases <refs>).** <the failing tests to write first, referencing the spec's test-plan case numbers/names>. Run; fail.
2. **Implement** <the smallest change to green them>. Green.
3. Lint + type-check.

**Done when:** <the externally-checkable condition — which cases pass, what nothing-else-yet-references>.

**Risk:** <none / what to watch>.

---

## Slice 2 — <name>

…

---

## Sequence summary

<A compact ordered list or table: slice → what lands → gating check. Lets the reader see the whole arc at a glance.>

## Cross-slice notes

<Shared gotchas: migration ordering, a type that spans slices, a test that only goes green after the final wire-up, cache-invalidation touch points, doc surfaces to update in the same PR (per CLAUDE.md → "Keeping Documentation in Sync").>

## Next step

<One sentence: implementation begins on this branch, slice 1 first, only after discovery/spec/plan are reviewed and confirmed.>
```

**Hard rules:**

- **Every slice is TDD.** Tests first (referencing the spec's enumerated cases), then the smallest implementation, then a focused run, then lint + type-check at the boundary. A slice with no test step is not a slice.
- **Every slice leaves the tree green + compilable.** No "temporarily broken between slices." If a behavior only fully works after a later slice, its test lives in that later slice — don't write a test that must fail across a boundary.
- **No forward dependencies.** Slice N uses only slices 1…N-1. If you find yourself needing something from a later slice, reorder.
- **Map to the spec, don't re-derive it.** Cite the spec's test-plan case numbers and Files-touched entries. The plan is a sequencing of the contract, not a second contract.
- **Same branch, commit-per-slice.** The plan does not create branches or PRs. Each slice is a commit on the branch discovery created; the PR (opened around discovery) grows commit-by-commit.
- **Flag doc-sync work as an explicit slice or cross-slice note** when the change touches a documented capability (tool descriptions, help/glossary, READMEs, CLAUDE.md) — stale docs are a bug in the same PR.

### 5. Hand off to the user

Stop. Do **not** stage, commit, push, or open a PR. Report:

- The doc you wrote, its line count, and the slice count.
- 2–3 things to confirm: any slice boundary that was a judgment call, any slice whose test can't go green until a later one (a smell to resolve), any sequencing risk.
- The next step: once discovery + spec + plan are confirmed, implementation starts — slice 1, tests-first, one commit per slice.

## What this skill is not

- It does **not** implement. It produces the plan; the user confirms, then implementation follows the slices.
- It does **not** re-open design decisions (discovery) or re-pin the contract (spec). If a decision turns out wrong while planning, kick back to the spec/discovery doc rather than quietly diverging.
- It does **not** create branches, run CI, move board cards, or commit.
