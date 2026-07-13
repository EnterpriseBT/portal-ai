# Development-cycle skills (remaining #178 scope) — Discovery

**Issue:** [EnterpriseBT/portal-ai#178](https://github.com/EnterpriseBT/portal-ai/issues/178)

**Why this exists.** The Issue → PR workflow lives in `CLAUDE.md`, but the agent can only execute the middle of it deterministically: `/discovery`, `/spec`, and `/plan` exist (PR #185); ticket creation, smoke-test scaffolding, epic coordination, and the condensed small-ticket path are still prose the agent re-derives each time, so the cycle drifts at its two ends. This discovery covers the remaining #178 scope — `/ticket`, `/smoke`, `/epic`, the condensed-doc path, and the `CLAUDE.md` + `.github/copilot-instructions.md` documentation updates. It also carries a requested audit of the repo's code-formatting enforcement (none existed) and records the hardening applied during discovery. This is the discovery that turns the rest of the PM cycle into per-phase skills instead of improvisation.

## The current shape

### Lifecycle skills today

| Skill | File | Owns |
|---|---|---|
| `/discovery` | `.claude/skills/discovery/SKILL.md` | Branch creation + `docs/<SLUG>.discovery.md` |
| `/spec` | `.claude/skills/spec/SKILL.md` | `docs/<SLUG>.spec.md` (contract) on the same branch |
| `/plan` | `.claude/skills/plan/SKILL.md` | `docs/<SLUG>.plan.md` (TDD slices) on the same branch |

Shared conventions the new skills must mirror: YAML frontmatter (`name` + one-sentence `description` naming the phase and artifact); explicit argument handling ("if ambiguous, ask once and stop"); numbered steps; prerequisite checks that stop with instructions (e.g. `/spec` refuses without a discovery doc); "hard rules" blocks (no invented paths, npm test scripts never raw jest); a "hand off to the user" step that **never commits/pushes/opens PRs** and reports the doc + 2–3 refinement flags; and a closing "What this skill is not" section that routes out-of-scope invocations to the right sibling.

### CLAUDE.md "Issue → PR Workflow" — coverage and gaps

Documented today: the four-artifact table and thresholds, "one feature = one branch = one PR", phase = commit not PR, multi-PR splits only for context-window reasons, enterprise-scale discovery lens, filing an issue (Issue Type via GraphQL, project-board IDs and one-liners), branching/commits/PR/after-merge conventions, branch protection.

Not documented (the #178 doc deliverable): the three ticket kinds (feature / bugfix / epic) and their body templates (PRD vs repro+impact), the sizing decision (full docs vs condensed) and where it's recorded, the epic-branch model, the manual-smoke confirmation gate before merge, and the `.smoke.md` artifact itself (the four-artifact table ends at implementation).

### Smoke-doc corpus

15 `docs/*.smoke.md` files share a de-facto structure: preamble (issue link + scope), a **Preflight** section (env setup, fixtures, reset instructions), numbered `§` walkthrough sections each with checkbox steps ("Ask X", "Confirm Y", "Check Z via `db:studio`"), expected-vs-got framing, a sign-off checklist, and a bug-filing template. Best canonical reference: `docs/BULK_AGGREGATE.smoke.md` (183 lines — preflight + 8 sections + sign-off + template, sections independent after preflight). Per the standing convention, a smoke doc is a **manual checklist walked against the user's own running servers**, never an automated script.

### Multi-phase precedents — no epics yet

Multi-PR features (`CUSTOM_TOOLPACK_REGISTRATION_PHASE_1..6`, `API_CONNECTOR_PHASE_1..4`, `ENTITY_RECORDS_WIDE_TABLE_PHASE_1..3`, `LARGE_DATA_OPS_PHASE_1..4`) were coordinated as **sequential PRs straight to `main`**, one shared discovery/proposal doc plus per-phase spec/plan pairs, commits titled `feat(scope): phase N [PR X] — …`. There is **no precedent** for an epic branch or GitHub sub-issues in this repo — the ticket's epic-branch model is a new convention, not a codification of practice.

### Condensed-doc precedent

`docs/PORTAL_MESSAGE_TIMESTAMPS.md` (issue #180, 53 lines) is the shape: a single `docs/<SLUG>.md` labeled "**small / condensed** (discovery + spec + plan + smoke in one doc)" with Why → Current shape → Decision → Plan (one slice) → Smoke (3 manual bullets) → Out of scope. Smoke is embedded, not a separate file.

### Issue bodies — de-facto templates worth codifying

Features (#169, #180, #192): Why/Goal → scope/capabilities bullets → **Acceptance criteria** → Out of scope → **Sizing** → References. Bugs (#155): Repro (exact prompt, expected vs got) → Why it matters → Likely cause / fix direction → Evidence. No formal template exists; `/ticket` codifies these.

### Formatting toolchain audit (requested during discovery)

- **Config:** shared root `.prettierrc.json` (double quotes, 80 cols, 2-space); per-package `format` / `format:check` scripts scoped to `src/**/*.{ts,tsx,json,css,scss}` (`ts,json` for node packages), run via turbo (`turbo.json` `format` task). `docs/*.md`, root configs, and `.claude/skills/` are **not** covered by any format glob.
- **Enforcement: none.** No husky, no lint-staged, and neither `.github/workflows/unit-test.yml` nor `integration-test.yml` runs `lint` or `format:check`. Consequence: real drift — `format:check` failed on **~480 files across all seven packages** against the lockfile's own prettier (3.8.1; the per-package `^3.4.2` ranges had been floated forward by the lockfile at some point with no accompanying reformat).
- **Instability found:** two files (`apps/api/src/__tests__/utils/row-async-memory-smoke.test.ts`, `packages/admin-cli/src/__tests__/store.test.ts`) hit a prettier idempotency bug — `--write` output failed `--check` — triggered by comments between a callback argument and a following timeout argument. The api file's timeout comment was hoisted onto a named `SMOKE_TIMEOUT_MS` constant (semantics unchanged) to make it format stably; the admin-cli file converged cleanly on a second pass.
- **Hardening applied on this branch** (working tree, uncommitted): root devDeps `husky` + `lint-staged` + `prettier@3.8.1` (pinned to match the lockfile so no style delta); `"prepare": "husky"`; `.husky/pre-commit` → `npx lint-staged`; root `lint-staged` config running `prettier --write` over the same globs the format scripts cover; `.prettierignore` + a `!src/routeTree.gen.ts` glob exclusion in `apps/web/package.json` (TanStack Router owns that file's formatting — prettier fights the generator); full-repo reformat to a clean baseline. Verified: `npm run format:check` green monorepo-wide, `npm run type-check` green (10/10), staged-file hook functionally tested.

## The design space

### Decision 1 — `/ticket` shape

**A. One `/ticket` skill, type + sizing resolved interactively.** Asks (or infers from the user's description) feature vs bug vs small; scaffolds the matching body template; sets Issue Type via the existing GraphQL snippet; records `Sizing: full / condensed` in the body; leaves the board card in `Todo`. **B. Separate `/ticket-feature` and `/ticket-bug` skills.** **C. `/ticket` also creates epic parents.**

| | A | B | C |
|---|---|---|---|
| Matches "skill per phase" | Yes | Fragments the phase | Overloads it |
| Body templates | Both, selected | One each | Three |
| Epic handling | Delegates to `/epic` | Delegates | Duplicated with `/epic` |

**Lean: A.** One phase, one skill; the feature/bug fork is a template choice, not a workflow difference — and epics have genuinely different mechanics (children, branch), so they stay in `/epic`.

### Decision 2 — `/smoke` inputs and timing

**A. Scaffold from the spec's acceptance criteria + plan's slices**, invoked after implementation, on the same branch; canonical structure lifted from `BULK_AGGREGATE.smoke.md`. **B. Scaffold from the diff** (read the implementation commits). **C. Freeform from the issue.**

**Lean: A.** Acceptance criteria are exactly the externally-observable truths a smoke walkthrough verifies; the diff is an input for *coverage checking*, not the source of the checklist. For condensed tickets, `/smoke` embeds the section into the single doc instead of creating `docs/<SLUG>.smoke.md`.

### Decision 3 — epic model: branch + sub-issues vs existing sequential practice

**A. As the ticket prescribes:** parent issue + GitHub native sub-issues (GraphQL `addSubIssue`), an `epic/<slug>` branch children branch from and merge into, epic branch merges to `main` once all children merge and CI passes. **B. Formalize existing practice:** parent issue with a dependency map + task list, children as sequential PRs to `main`, no epic branch. **C. Native sub-issues, but children PR straight to `main`** (A's tracking, B's merging).

| | A | B | C |
|---|---|---|---|
| Matches ticket text | Yes | No | Partially |
| Matches repo precedent | No precedent | Yes (4 features) | Tracking new, merge familiar |
| Long-lived-branch drift risk | High (epic branch trails `main`) | None | None |
| Children shippable independently | No (land on epic branch) | Yes | Yes |
| Linear-history / squash fit | Epic merge is a second squash layer | Clean | Clean |
| Big-bang risk at epic merge | High | Low | Low |

**Lean: A — confirmed in review.** The repo's practice so far has been trunk-based (every multi-phase feature shipped children to `main` sequentially), but merging to `main` auto-deploys to the app-dev environment (`.github/workflows/deploy-dev.yml`), and the upcoming large features must not land there half-finished as child PRs merge. The epic branch is a **deployment gate**, not a tracking device: children merge into `epic/<slug>` (getting review + CI per child), and only the completed epic merges to `main`/app-dev. The drift cost is real and gets a documented mitigation: the epic branch rebases (or merges) `main` on a defined cadence — at minimum before each child merges into it — so the final epic → `main` merge is never a big-bang integration.

### Decision 4 — where the condensed path lives

**A. A mode of `/discovery`** (`/discovery <N> condensed`): same branch-creation duties, writes single `docs/<SLUG>.md` in the `PORTAL_MESSAGE_TIMESTAMPS.md` shape. **B. A standalone `/condensed` skill.** **C. `/ticket` scaffolds the condensed doc itself.**

**Lean: A.** The condensed doc replaces discovery+spec+plan+smoke, but its *position* in the cycle is phase 2 (first artifact on a fresh branch) — reusing `/discovery`'s branch logic avoids a fourth copy of it. `/ticket`'s sizing decision selects the path; `/spec`, `/plan`, `/smoke` refuse politely when the branch carries a condensed doc.

### Decision 5 — documentation mirroring

`CLAUDE.md` gets the full new content (ticket kinds + body templates, sizing, epic model, smoke gate, condensed path, and the new formatting-hook convention); `.github/copilot-instructions.md` gets the same edits at its existing abridgement level (it already mirrors the workflow and discovery-lens sections condensed, and omits web-specific pattern sections). **Lean: mirror condensed, matching the file's current altitude.**

### Decision 6 — formatting enforcement scope (applied)

Hook = **prettier only** on staged files matching the existing format-script globs; no eslint in the hook (web's `lint` is `--max-warnings 0` over the whole app — too slow and too strict for per-commit); prettier pinned at 3.8.1 (lockfile's existing resolution — a bump to 3.9.x restyles ~490 files *again* and hit the idempotency bug harder, verified during the audit). **Lean: as applied; adding `format:check` (and `lint`) to CI is recommended but held as an open question because #178 scopes CI automation out.**

## Tradeoff comparison

| | D1: one `/ticket` | D2: smoke-from-spec | D3: epic branch (A) | D4: condensed in `/discovery` | D5: mirror condensed | D6: prettier-only hook |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | No (already applied) |
| New convention vs codification | Codifies | Codifies | **New — no precedent** | Codifies | Codifies | New, minimal |

## Recommendation

1. `/ticket`: one skill; feature (PRD) and bug (repro+impact) body templates codified from #169/#192/#155; sets Issue Type via GraphQL; records the sizing decision (`full` / `condensed`) in the issue body; board card stays `Todo`.
2. `/smoke`: scaffolds `docs/<SLUG>.smoke.md` from the spec's acceptance criteria and the plan's slices, in the `BULK_AGGREGATE.smoke.md` structure (preflight, `§` sections, sign-off, bug template); same branch, no commit; embeds a section instead when the branch is condensed.
3. `/epic`: parent issue + native sub-issues + `epic/<slug>` branch (Decision 3, confirmed): children branch from and merge into the epic branch; the epic branch keeps pace with `main` on a documented cadence; only the finished epic merges to `main` (and thus deploys to app-dev).
4. Condensed path: `/discovery <N> condensed` writes single `docs/<SLUG>.md` (Why → Current shape → Decision → Plan → Smoke → Out of scope); the other phase skills detect and defer to it.
5. `CLAUDE.md` "Issue → PR Workflow" gains: ticket kinds + templates, sizing, the smoke-confirmation gate ("merge once CI passes **and** the smoke doc is user-confirmed"), the epic model, the condensed option, and the pre-commit formatting hook; `.github/copilot-instructions.md` mirrors condensed.
6. Formatting: the ~480-file mechanical reformat, the `routeTree.gen.ts` exclusions, the idempotency source fix, and the new CI `format:check` step land as a standalone `chore/format-baseline` PR merged before this branch's PR; the husky + lint-staged wiring stays on this branch.

## Open questions

1. **Epic branch vs sequential child PRs to `main`** (Decision 3). **Resolved in review: epic branch.** The repo has been trunk-based so far, but `main` auto-deploys to app-dev — the epic branch exists so half-finished epics never deploy as child PRs merge. Mandatory keep-pace-with-`main` cadence documented alongside.
2. **Are GitHub sub-issues available on the org plan?** `addSubIssue` GraphQL is used by `/epic`; needs a one-off probe before the spec pins it. **Lean: yes (generally available since 2025); verify during spec with a scratch issue.**
3. **Where does the ~480-file baseline reformat land?** **Resolved in review: a separate `chore/format-baseline` PR merged before this branch's PR; the husky wiring stays here.**
4. **Should CI run `format:check` + `lint`?** The hook is client-side and bypassable (`--no-verify`). **Resolved in review: add a `format:check` step to `unit-test.yml` — it ships in the `chore/format-baseline` PR so gate and clean baseline land atomically. A full lint gate stays a follow-up ticket.**
5. **Should `docs/*.md` be prettier-formatted?** Skills now generate most docs; md is outside every format glob today, and prettier would churn hand-aligned tables in ~100 existing docs. **Lean: no — leave md unformatted; revisit only if doc diffs get noisy.**

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A: dev-tooling and docs; no runtime state. The one check-then-act (branch-exists check in `/discovery`/`/epic`) is single-operator.
- **Accuracy & auditability** — Lean: the issue body remains the record-of-truth (doc links appended per artifact, sizing recorded); `/epic` keeps the dependency map in the parent body, not in chat.
- **Failure modes** — Lean: the pre-commit hook fails **closed** (blocked commit) with `--no-verify` as the documented escape hatch; skills fail closed too (stop-and-ask on missing prerequisites, never invent).
- **Scale & unbounded growth** — N/A: bounded by ticket count; smoke docs and skills are O(feature).
- **Multi-tenancy** — N/A: repo tooling, not product surface.
- **Contract stability** — Lean: skills encode conventions by *reference* to `CLAUDE.md` sections rather than duplicating prose, so a convention edit doesn't require touching five SKILL.md files.
- **Data lifecycle** — N/A: docs live in git; no retention windows.

## What this doesn't decide

- The exact PRD/repro template field lists — spec-level detail, pinned in `docs/DEV_CYCLE_SKILLS.spec.md` from the #169/#192/#155 exemplars.
- Automating CI or branch protection (out of scope per the ticket), beyond the one-line `format:check` step in open question 4.
- Auto-confirming smoke tests — the human confirmation gate stays human (ticket out-of-scope).
- Whether existing multi-phase families (e.g. toolpack registration) get retroactive epic parents — no; the epic model applies to new work.
- An eslint pre-commit gate — deliberately excluded from the hook (Decision 6); would need per-package incremental lint to be fast enough.

## Next step

`/spec 178` on this branch pins the contract: the five SKILL.md surfaces (frontmatter, arguments, steps, hard rules, hand-off), the two issue-body templates, the condensed-doc structure, the exact `CLAUDE.md` section edits and their copilot-instructions mirror, and the sub-issue GraphQL calls — then `/plan 178` slices it (likely: `/ticket` → `/smoke` → condensed path → `/epic` → docs edits, one commit each, with the formatting baseline landing first per open question 3).
