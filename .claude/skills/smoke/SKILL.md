---
name: smoke
description: Phase 5 of the Issue → PR workflow — scaffold the manual smoke-test checklist for a feature branch. Maps the spec's acceptance criteria to a docs/<SLUG>.smoke.md walkthrough the user runs against their own dev stack; the user's confirmation (plus green CI) is the merge gate. Invoke as /smoke [issue-number] after implementation.
---

# /smoke — scaffold the manual smoke-test checklist

You are scaffolding **phase 5** of the workflow in `CLAUDE.md` → "Issue → PR Workflow" — the last artifact before merge. A smoke doc is a **manual walkthrough the user performs against their own running servers**. It is never an automated script, never a jest suite, and never something you execute or check off yourself: the human confirmation is the point of the gate. The PR merges only after CI is green **and** the user has confirmed the walkthrough.

## Arguments

Invoked as `/smoke [issue-number]`. The number is optional — derive it from the spec (or condensed doc) on the current branch. If you can't resolve exactly one, ask once and stop.

## Steps

### 1. Check prerequisites on the current branch

```bash
git branch --show-current            # must be the feature branch, NOT main
ls docs/*.spec.md docs/*.md          # find the spec or condensed doc
git log --oneline main..HEAD         # implementation commits must exist
```

- **Implementation must be present.** If the branch has only docs commits, stop — the smoke doc verifies built behavior; scaffolding it early produces fiction. Tell the user to finish the plan's slices first.
- **A spec (or condensed doc) must be present.** No spec → stop with the right next command (`/spec <N>`, or `/discovery <N> condensed` for small tickets).
- **Condensed branch?** If the branch carries `docs/<SLUG>.md` (header says **small / condensed**), don't create a `.smoke.md` — append or refresh that doc's `## Smoke (manual, against your dev stack)` section using the same rules below, and skip to the hand-off.

### 2. Collect the three inputs

1. **The spec's Acceptance criteria** — the contract. **Coverage rule: every acceptance criterion maps to at least one walkthrough step.** This is the assertion the doc is built around.
2. **The plan's slices** — the natural grouping for the `§` sections.
3. **The branch diff** (`git diff main...HEAD --stat`) — a sweep for user-visible surfaces the spec under-specified (a new dialog, a changed helper text, a new CLI flag). Anything user-facing in the diff that no criterion covers gets its own step.

### 3. Read one reference smoke doc

Default to `docs/BULK_AGGREGATE.smoke.md` — preflight + sectioned walkthrough + sign-off + bug template, with sections independent after preflight. Prefer another (e.g. `docs/DEVOPS_CLI.smoke.md` for CLI-shaped work) if it's closer to the ticket.

### 4. Write `docs/<SLUG>.smoke.md`

```markdown
# <slug> — Smoke Suite

Manual smoke test for [#<N>](…) — <one line: what shipped>. **Branch under test:** `<branch>` (PR [#<P>](…)).

## Preflight

### Environment

- [ ] `git checkout <branch> && git pull --ff-only`
- [ ] `npm install` <+ build/migrate steps ONLY if this branch needs them — name the migration; omit and say "no migration" when there is none>
- [ ] `npm run dev` boots cleanly (API :3001, web :3000) <adapt to what the ticket touches>

### Fixtures

- [ ] <the data/org/station the walkthrough assumes, and how to get it>

### Reset between runs

- [ ] <how to re-run cleanly; "no reset needed — read-only" when true>

## §1 — <feature area, usually plan slice 1>

- [ ] <action: the exact prompt / click / command>
- [ ] <expected: the externally-observable result. Where DB state is the truth, name the `db:studio` table + column to inspect>

## §2 — <…>

## §<n> — Error & edge cases

- [ ] <the failure modes the spec's Risks name>

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
```

**Hard rules:**

- **Manual, never automated.** The doc instructs a human at their own dev stack (`npm run dev`, their Auth0 tenant, their DB). No script writes, no "run this test file".
- **Every box scaffolds unchecked, and you never check one** — not even ones you're confident about. Checking boxes is the user's act of confirmation; a pre-checked box forges the gate.
- **Coverage is complete:** every spec acceptance criterion → ≥ 1 step; every user-visible diff surface → ≥ 1 step. If a criterion can't be smoke-verified manually, say so in the doc rather than dropping it silently.
- **Steps are concrete:** exact prompts in quotes, exact commands, exact expected values or shapes — "works correctly" is not an expected result.
- **No commit, no push** — the user reviews the checklist, walks it, checks boxes, and confirms.

### 5. Hand off to the user

Stop. Report: the doc and its section/step counts, the acceptance-criteria → section mapping (so coverage is auditable at a glance), and the gate statement — the PR merges after CI is green **and** they've confirmed the walkthrough.

## What this skill is not

- It is not `/verify` or a test runner — nothing here executes the app.
- It is not the place to *fix* what the walkthrough will find — bugs found during the walk go through the doc's bug-filing template.
- It does not merge the PR, check CI, or confirm anything on the user's behalf.
