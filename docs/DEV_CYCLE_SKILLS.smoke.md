# dev-cycle-skills — Smoke Suite

Manual smoke test for [#178](https://github.com/EnterpriseBT/portal-ai/issues/178) — the `/ticket`, `/smoke`, `/epic` lifecycle skills, the condensed single-doc mode, and the `CLAUDE.md` / copilot-instructions workflow updates. **Branch under test:** `feat/dev-cycle-skills` (PR [#206](https://github.com/EnterpriseBT/portal-ai/pull/206)).

Nothing here boots the app — the deliverables are agent skills and docs, so the "stack" is a Claude Code session on this branch plus the GitHub repo. Every GitHub object created below is scratch: close issues `--reason "not planned"` and delete scratch branches when a section ends.

Acceptance-criteria coverage: AC1 → §1; AC2 → §2; AC4 → §3; AC3 → §4; AC5 → §5; AC6 → §6; AC7 → Sign-off.

## Preflight

### Environment

- [ ] `git checkout feat/dev-cycle-skills && git pull --ff-only`
- [ ] No migration, no build needed — markdown-only branch (plus the husky hook: `npm install` once so `prepare` installs it)
- [ ] Start (or restart) a Claude Code session in the repo so the new skills load

### Fixtures

- [ ] `gh auth status` — token works; has `project` scope (board checks) — `admin:org` no longer needed (the `Epic` type already exists)

### Reset between runs

- [ ] Close any leftover `SCRATCH:`-titled issues `--reason "not planned"`; delete any leftover `epic/scratch-*` branches (local + remote)

## §1 — Skills are registered (AC1)

- [ ] In the Claude Code session, the skill list (or typing `/`) shows all six lifecycle skills: `/ticket`, `/discovery`, `/spec`, `/plan`, `/smoke`, `/epic`

## §2 — `/ticket` (AC2)

- [ ] Invoke `/ticket feature <a one-line scratch feature>` — answer its questions; title the issue `SCRATCH: …`
- [ ] The created issue body has exactly the sections `## Why`, `## Deliverables`, `## Acceptance criteria`, `## Out of scope`, `## Sizing`, `## References`, and the Sizing line reads `full` or `condensed` with a reason
- [ ] Issue Type shows **Feature** on the issue page; the Portal AI board shows the card in **Todo**
- [ ] Invoke `/ticket bug <a one-line scratch bug>` — body has `## Repro` (with Expected/Got), `## Impact`, `## Likely cause / fix direction`, `## Evidence`, `## Sizing`, `## References`; Issue Type shows **Bug**
- [ ] Ask `/ticket` for a multi-ticket epic — it refuses and routes to `/epic` without creating anything
- [ ] Clean up: close both scratch issues `--reason "not planned"`

## §3 — Condensed mode (AC4)

- [ ] On a scratch issue whose `## Sizing` says `condensed`, invoke `/discovery <N>` **without** the `condensed` argument — it announces condensed mode from the sizing and proceeds
- [ ] The draft is a single `docs/<SLUG>.md` (no `.discovery.md`): header line ends `**small / condensed** (discovery + spec + plan + smoke in one doc)`; sections `**Why.**`, `## Current shape`, `## Decision — <…>`, `## Plan — <n> slice(s)`, `## Smoke (manual, against your dev stack)`, `## Out of scope`; ≤ ~80 lines
- [ ] With only that condensed doc on the branch, invoke `/spec` — it stops, says the ticket took the condensed path, and offers to extend the single doc (no `docs/<SLUG>.spec.md` created)
- [ ] Same for `/plan` — refuses, no `docs/<SLUG>.plan.md` created
- [ ] Clean up: delete the scratch branch + doc; close the scratch issue

## §4 — `/epic` (AC3)

- [ ] Invoke `/epic <a one-line scratch epic>` with two scratch children described — parent issue created with Issue Type **Epic** (the purple org type)
- [ ] Parent body has the overview paragraph, `## Status` table (one row per child with a state column), `## Children & dependencies`, `## Out of scope`
- [ ] Children exist as **native sub-issues** (parent's sub-issue list shows them; `subIssues.totalCount` matches), each with `/ticket`-conformant bodies naming their dependencies + child branch
- [ ] `epic/<slug>` branch exists on origin, created from current `main`
- [ ] The skill's close-out guidance (visible in its report / the parent body) says: children merge into the epic branch, batch `Closes #parent` + `Closes #child…` lands only in the final epic → `main` PR, rebase-merge preferred / squash fallback
- [ ] Clean up: delete the scratch epic branch (local + remote); close parent + children `--reason "not planned"`

## §5 — `/smoke` (AC5)

- [ ] This very document exists because `/smoke 178` scaffolded it — spot-check the coverage line above: every AC (1–7) maps to a section
- [ ] Every checkbox in this file arrived **unchecked** in the committed scaffold (`git show <slice-3 commit> -- docs/DEV_CYCLE_SKILLS.smoke.md | grep -c "\[x\]"` → 0)
- [ ] On a branch carrying a condensed doc (reuse §3's before cleanup), invoke `/smoke` — it appends/refreshes the doc's `## Smoke` section and creates **no** `.smoke.md` file

## §6 — Workflow docs (AC6)

- [ ] `CLAUDE.md` → "Issue → PR Workflow": the artifact table has **five** rows (smoke is row 5); subsections "Ticket kinds & body templates", "Epic branches", "The smoke gate", "Condensed path for small tickets" all present
- [ ] "Filing an issue" lists the `Epic` issue type with node id `IT_kwDODs25Bc4CFje_`, and the close-reason example reads `--reason "not planned"` (not `not-planned`)
- [ ] The formatting note near Key Scripts documents the husky + lint-staged pre-commit hook and the CI `format:check` step
- [ ] `.github/copilot-instructions.md` has the condensed `## Issue → PR workflow (lifecycle)` section, consistent with the file's abridged altitude
- [ ] Sanity: make a scratch edit that mis-formats a `src/**` file, `git add` + `git commit` on a scratch branch — the pre-commit hook reformats it; then discard the scratch commit/branch

## Sign-off

- [ ] Every section above verified
- [ ] All scratch issues closed and scratch branches deleted (search issues for `SCRATCH:`, branches for `epic/scratch`)
- [ ] <date + name> — confirmed against my own session + the GitHub repo (AC7)

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (issue/branch/PR):
