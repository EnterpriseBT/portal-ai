# Development-cycle skills — Spec

**Issue:** [EnterpriseBT/portal-ai#178](https://github.com/EnterpriseBT/portal-ai/issues/178) · **Discovery:** `docs/DEV_CYCLE_SKILLS.discovery.md` · **PR:** #206 (draft)

Pins the contract for the remaining #178 scope: three new lifecycle skills (`/ticket`, `/smoke`, `/epic`), the condensed single-doc mode on `/discovery` (+ detection in the sibling skills), and the `CLAUDE.md` / `.github/copilot-instructions.md` workflow-doc updates. The formatting audit's deliverables already shipped (#205 baseline + CI gate; husky wiring committed on this branch).

## Key decisions (flag for review)

1. **Epic branch = deployment gate** (discovery D3, confirmed): `main` auto-deploys to app-dev, so epic children merge into `epic/<slug>` and only the finished epic reaches `main`.
2. **Sub-issue mechanics verified**: `addSubIssue` / `removeSubIssue` / `reprioritizeSubIssue` exist in the org's GraphQL schema, and #177 already uses native sub-issues — `/epic` formalizes that precedent. A real **`Epic` issue type** is created at the org level (confirmed in review; `POST /orgs/EnterpriseBT/issue-types` — needs a one-time `admin:org` token scope) and epic parents carry it; its node id joins the `Task`/`Bug`/`Feature` ids in `CLAUDE.md` → "Filing an issue".
3. **Child issues close only when the epic merges** (confirmed in review): the final `epic/<slug>` → `main` PR body carries `Closes #<parent>` **and** `Closes #<child>` for every child. Children stay open while merged-into-epic (their Status-table state says so); nothing closes at child-merge time. (GitHub auto-close only fires on default-branch merges, so the batch in the final PR is also the only place auto-close *can* work.)
4. **Final epic → `main` merge is rebase-merge preferred, squash fallback** (confirmed in review). Rebase preserves one-commit-per-child on `main` and satisfies the linear-history rule; squash is the fallback when rebase conflicts.
5. **Condensed mode lives on `/discovery`** (discovery D4): `/ticket` records the sizing; `/discovery <N> condensed` writes the single doc; `/spec`/`/plan` refuse politely; `/smoke` appends a section instead of creating a file.
6. **The smoke gate is human**: the skill scaffolds the checklist with every box unchecked and never checks one; merge requires CI green **and** the user's confirmation of the walkthrough.

## Scope

### In scope

1. `.claude/skills/ticket/SKILL.md` — new skill, phase 1.
2. `.claude/skills/smoke/SKILL.md` — new skill, phase 5 (pre-merge gate).
3. `.claude/skills/epic/SKILL.md` — new skill, epic coordination.
4. Condensed mode: edits to `discovery/SKILL.md` (mode + template), `spec/SKILL.md` + `plan/SKILL.md` (detection + refusal), covered by `/smoke`'s embedded mode.
5. `CLAUDE.md` → "Issue → PR Workflow" updates + a formatting-enforcement note; mirrored condensed into `.github/copilot-instructions.md`.

### Out of scope

- CI automation of the cycle, branch-protection changes for `epic/**` (documented as a manual settings recommendation only), auto-merge, auto-confirming smoke (per the ticket).
- Retroactive epic parents for shipped multi-phase families.
- An eslint pre-commit gate (discovery D6).
- Any runtime/product code — this PR ships markdown + the already-committed husky wiring only.

## Surface

All SKILL.md files follow the established shared shape (frontmatter `name` + one-sentence `description` naming the phase, artifact, and invocation; numbered `## Steps`; `**Hard rules**`; a "Hand off to the user" step; a `## What this skill is not` closer). Hand-off discipline varies by skill and is pinned per-skill below.

### `.claude/skills/ticket/SKILL.md` (new)

- **Invocation:** `/ticket <feature|bug> <one-line summary>` — type argument optional; inferred from the description (repro language → bug), asked once if ambiguous. Epic parents are refused and routed to `/epic`.
- **Steps pin:** (1) gather inputs — PRD material for features, repro+impact for bugs; **missing requirements are asked for, never invented**; (2) sizing decision (`full` vs `condensed`) — recommend `condensed` only when the change is single-package, no new pattern, no contract change; the user confirms; (3) scaffold the body from the matching template; (4) `gh issue create --repo EnterpriseBT/portal-ai`; (5) set Issue Type via the GraphQL mutation already documented in `CLAUDE.md` → "Filing an issue" (type ids: `Task`/`Bug`/`Feature` via `repository.issueTypes`); (6) confirm the project-board card landed in `Todo` (auto-add); (7) report the issue URL + the next command (`/discovery <N>` or `/discovery <N> condensed`).
- **Feature body template (PRD):** `## Why` → `## Deliverables` (checklist) → `## Acceptance criteria` (externally-observable checklist) → `## Out of scope` → `## Sizing` (one line: `full` or `condensed` + reason) → `## References`. Codified from #169/#192/#180.
- **Bug body template:** `## Repro` (exact steps/prompt, expected vs got) → `## Impact` → `## Likely cause / fix direction` → `## Evidence` (transcripts, DB rows) → `## Sizing` → `## References`. Codified from #155.
- **Hard rules:** Issue Type is always set (unset type = incomplete ticket); sizing is always recorded in the body; the skill creates the issue but **no branch, no docs, no code**.

### `.claude/skills/smoke/SKILL.md` (new)

- **Invocation:** `/smoke [issue-number]` — number optional, derived from the spec/condensed doc on the current branch. Prerequisites: implementation commits present on the branch **and** a spec (or condensed doc); otherwise stop with the right next command.
- **Inputs pin:** the spec's **Acceptance criteria** (every criterion maps to ≥ 1 walkthrough step — the coverage rule), the plan's slices (section grouping), and the branch diff (to catch surfaces the spec missed).
- **Output:** `docs/<SLUG>.smoke.md` in the `BULK_AGGREGATE.smoke.md` structure: title `# <slug> — Smoke Suite`; preamble (issue link, branch under test, PR link); `## Preflight` with `### Environment` (checkout, install, migrate, `npm run dev`, service sanity), `### Fixtures`, `### Reset between runs`; numbered `## §N — <feature area>` sections of checkbox steps with explicit expected-vs-got framing and `db:studio` inspection steps where DB state is the truth; `## Sign-off`; `## Bug-filing template` (Section / Expected / Got / Repro / identifiers).
- **Condensed mode:** when the branch carries `docs/<SLUG>.md` (condensed), append/refresh its `## Smoke (manual, against your dev stack)` section instead of creating a file.
- **Hard rules:** a smoke doc is a **manual walkthrough against the user's own running servers — never an automated script**; all boxes scaffold unchecked and the skill never checks one; no commit/push (user reviews, walks, confirms). The gate itself: the PR merges only after CI is green **and** the user has confirmed the walkthrough.

### `.claude/skills/epic/SKILL.md` (new)

- **Invocation:** `/epic <one-line epic summary>` (create) or `/epic <N>` (manage an existing parent: add children, refresh the status/dependency map, drive close-out).
- **Parent issue pin:** Issue Type **`Epic`** (the new org type; the skill verifies it exists and reports the one-time creation command if not); body: overview/arc paragraph → `## Status` table (child → layer/role → state: `Todo` / `In progress` / `Merged into epic` / `Closed`, updated on every child state change) → `## Children & dependencies` (which child blocks which) → `## Out of scope`. Reference exemplar: #177. Board card `Todo` → `In Progress` at epic-branch creation.
- **Children pin:** created with `/ticket`'s templates (the skill embeds the same templates by reference, not copy); linked via GraphQL `addSubIssue(input:{issueId, subIssueId})`; each child body names its dependencies and its child branch.
- **Branch mechanics pin (the new convention):**
  - `epic/<slug>` created from `main` and pushed at epic creation.
  - Child branches `feat/<child-slug>` (or `fix/`) branch **from the epic branch**; child PRs set **base = `epic/<slug>`**; children squash-merge into the epic branch after review + CI (unit/integration workflows already run on all non-`main` pushes).
  - **Keep-pace rule:** before each child PR merges, the epic branch merges `main` in (`git merge main`, merge commits allowed on the epic branch — they vanish at final rebase/squash); the final epic → `main` PR is therefore never a big-bang integration.
  - Child issues stay **open** while merged-into-epic; the parent's Status table records the state (Key decision 3).
  - Close-out: all children merged + epic CI green + user-confirmed epic smoke → final PR `epic/<slug>` → `main`, body `Closes #<parent>` + `Closes #<child>` for every child (the single closing event), **rebase-merge preferred / squash fallback** (Key decision 4), `--delete-branch`.
- **Hard rules:** the epic branch exists to keep half-finished epics off app-dev — children never PR to `main` directly while their epic is open; the parent body's Status table is the record-of-truth and is updated in the same action as every child state change; no code, no child implementation.

### Condensed mode — edits to existing skills

- **`discovery/SKILL.md`:** Arguments section gains `condensed` (`/discovery <N> [condensed]`); if the issue body's `## Sizing` says `condensed`, that is the default. Condensed path: same branch-creation step; survey shrinks to targeted reads (Explore agent optional); output is **`docs/<SLUG>.md`** (not `.discovery.md`) in the `PORTAL_MESSAGE_TIMESTAMPS.md` shape: header line (`Issue · type · **small / condensed** (discovery + spec + plan + smoke in one doc)`) → `**Why.**` → `## Current shape` (citation table) → `## Decision — <name>` (one per real decision, chosen not leaned) → `## Plan — <n> slice(s)` (Files / Tests per slice) → `## Smoke (manual, against your dev stack)` (numbered steps) → `## Out of scope`. Target ≤ 80 lines. Same no-commit hand-off.
- **`spec/SKILL.md` + `plan/SKILL.md`:** step 1 gains condensed detection — if the branch carries `docs/<SLUG>.md` and no `docs/<SLUG>.discovery.md`, stop: the ticket took the condensed path; the contract/slices live in the single doc; offer to extend it instead.
- **`discovery/SKILL.md` "What this skill is not":** the trivial-ticket routing updates from "go straight to implementation" to naming the condensed option explicitly.

### `CLAUDE.md` → "Issue → PR Workflow" edits

- **Artifact table:** grows to five artifacts — row 5: *Smoke* — `docs/<SLUG>.smoke.md` manual checklist, drafted after implementation, **confirmed by a human before merge**; condensed tickets embed it in the single doc. Surrounding "four artifacts" phrasing updates accordingly.
- **New subsection "Ticket kinds & body templates":** feature (PRD) / bugfix (repro + impact) / epic (parent + children); the sizing decision (`full` | `condensed`) recorded in the issue body at creation; the per-phase skill table (`/ticket`, `/discovery`, `/spec`, `/plan`, `/smoke`, `/epic`). "Filing an issue" gains the `Epic` issue type + its node id alongside `Task`/`Bug`/`Feature`.
- **New subsection "Epic branches":** the deployment-gate rationale (main auto-deploys to app-dev) + the branch mechanics exactly as pinned in the `/epic` surface above, including keep-pace, manual child-issue close, and the final-merge style. Notes `epic/**` branch protection as an optional manual settings step.
- **New subsection "The smoke gate":** merge requires CI green + user-confirmed smoke walkthrough; PR test-plan checklists reference the smoke doc.
- **New subsection "Condensed path for small tickets":** when sizing chose condensed — one `docs/<SLUG>.md`, exemplar `docs/PORTAL_MESSAGE_TIMESTAMPS.md`.
- **Formatting enforcement note** (outside the workflow section, next to Key Scripts): pre-commit prettier via husky + lint-staged (self-installs on `npm install` via `prepare`), CI `format:check` in `unit-test.yml`, `routeTree.gen.ts` exclusion, md not formatted.

### `.github/copilot-instructions.md` mirror

New condensed section `## Issue → PR workflow (lifecycle)` (~12 lines, matching the file's existing altitude): five artifacts + skills table, ticket kinds + sizing, epic-branch deployment gate, smoke gate, condensed path, formatting hook. No web-pattern content added (stays consistent with the file's current abridgement).

## Migration / Seed

None — no schema change; this PR ships markdown and repo config only.

## TDD test plan

No jest surface — the deliverables are markdown skills and docs; **automated test cases: 0**. Verification is dogfooding, per slice:

- **`/ticket`:** create a scratch feature issue and a scratch bug issue; assert body sections, Issue Type set, board card in `Todo`, sizing recorded; close both `--reason not-planned`.
- **`/epic`:** create a scratch parent + one scratch child; assert `subIssues.totalCount = 1` via GraphQL, epic branch pushed, Status table present; delete branch, close both.
- **Condensed:** dry-run `/discovery <scratch> condensed` shape against the pinned template (no commit).
- **`/smoke`:** dogfood on **this ticket** — `/smoke 178` scaffolds `docs/DEV_CYCLE_SKILLS.smoke.md`, which then serves as #178's own pre-merge gate.
- **Docs:** `CLAUDE.md`/copilot mirror reviewed section-by-section against the surface above (doc-sync check is part of this PR, not a follow-up).

## Acceptance criteria

- [ ] `/ticket`, `/smoke`, `/epic` appear in the skill list and run end-to-end per their SKILL.md steps.
- [ ] A `/ticket`-created issue has the pinned body sections, a set Issue Type, a recorded sizing, and a `Todo` board card.
- [ ] An `/epic`-created parent has native sub-issue children, a pushed `epic/<slug>` branch, and a Status/dependency table.
- [ ] `/discovery <N> condensed` produces a single `docs/<SLUG>.md` in the pinned shape; `/spec` and `/plan` refuse on a condensed branch with a helpful message.
- [ ] `/smoke` output maps every spec acceptance criterion to ≥ 1 unchecked walkthrough step; embedded mode works on condensed branches.
- [ ] `CLAUDE.md` documents the five-artifact model, ticket kinds, epic branches, smoke gate, condensed path, and formatting enforcement; `.github/copilot-instructions.md` carries the condensed mirror.
- [ ] `docs/DEV_CYCLE_SKILLS.smoke.md` exists (dogfooded) and is user-confirmed before this PR merges.

## Risks & rollback

- **Everything here is markdown + git convention — rollback is `git revert` of the offending commit; no runtime exposure, no fail-open/closed dimension.**
- **Epic-branch drift** is the real operational risk; the keep-pace rule is the mitigation and it lives in both the skill and `CLAUDE.md` (documented twice by reference, not copy, per the discovery's contract-stability lean).
- **GraphQL surface drift** (sub-issue mutations are newish): the skill probes with a clear error path (stop and report) rather than half-creating an epic. Board mutations need the `project` scope — already documented in `CLAUDE.md`; creating the `Epic` issue type needs a one-time `admin:org` scope (`gh auth refresh -h github.com -s admin:org`).
- **Rebase-merge of an epic PR can conflict** where keep-pace merges touched the same lines; the documented fallback is squash. Detection is immediate (GitHub blocks the merge).

## Files touched

- New: `.claude/skills/ticket/SKILL.md`, `.claude/skills/smoke/SKILL.md`, `.claude/skills/epic/SKILL.md`
- Edit: `.claude/skills/discovery/SKILL.md` (condensed mode + template), `.claude/skills/spec/SKILL.md`, `.claude/skills/plan/SKILL.md` (condensed detection)
- Edit: `CLAUDE.md` (workflow section + formatting note), `.github/copilot-instructions.md` (condensed mirror)
- New (during dogfood): `docs/DEV_CYCLE_SKILLS.smoke.md`

## Next step

`docs/DEV_CYCLE_SKILLS.plan.md` slices this into roughly five commits on this branch: (1) `/ticket`, (2) condensed mode across discovery/spec/plan, (3) `/smoke`, (4) `/epic`, (5) the `CLAUDE.md` + copilot-instructions edits — with the `/smoke 178` dogfood landing as part of the gate before merge, not as a slice of its own.
