# Development-cycle skills — Plan

**Implements the remaining #178 scope as five slices: three new lifecycle skills, the condensed single-doc mode, and the workflow-doc updates — each a reviewable commit verified by dogfooding.**

Spec: `docs/DEV_CYCLE_SKILLS.spec.md`. Discovery: `docs/DEV_CYCLE_SKILLS.discovery.md`. Issue: #178. Builds on shipped groundwork: #205 (format baseline + CI gate) and this branch's husky wiring + `/discovery`/`/spec`/`/plan` skills (PR #185).

Five slices, each leaving the repo green and each landing as a **commit on `feat/dev-cycle-skills`** — one feature, one PR (#206). The spec's TDD test plan has **0 automated cases** (deliverables are markdown skills and docs), so each slice's test step is its **dogfood verification** from the spec — run before the commit is considered done, with scratch artifacts cleaned up. `npm run lint && npm run type-check` still run at each boundary (they're cheap and catch accidental non-doc touches); no jest surface exists or is added.

Sequencing rationale — `/ticket` first (phase 1 of the cycle; defines the body templates and the sizing decision every later skill references). Condensed mode second (edits the three existing skills; consumes `/ticket`'s sizing contract). `/smoke` third (independent of epic; unblocks this PR's own merge gate). `/epic` fourth (references `/ticket`'s templates and needs the one-time `Epic` issue-type creation). Docs last (documents only what is then true — no forward references to unshipped behavior).

---

## Slice 1 — `/ticket` skill

The phase-1 skill: correctly-typed issue creation with PRD/repro body templates and the recorded sizing decision.

**Files**

- New: `.claude/skills/ticket/SKILL.md` — per spec §Surface `/ticket`: invocation + type inference, the seven pinned steps, both body templates (feature PRD from #169/#192/#180; bug from #155), hard rules (ask-don't-invent, type always set, sizing always recorded, no branch/docs/code).

**Steps**

1. **Verify (spec test plan, `/ticket` dogfood).** Draft the skill; invoke `/ticket` for one scratch feature and one scratch bug. Assert: body sections match the pinned templates; Issue Type set (`Feature`/`Bug`); board card in `Todo`; sizing line present; epic requests refused with a route to `/epic`.
2. **Fix** any drift between the scaffold and the spec's pinned sections. Re-run the failing assertion only.
3. Close scratch issues (`--reason not-planned`); lint + type-check.

**Done when:** both scratch issues matched the pinned templates end-to-end and the skill appears in the skill list.

**Risk:** none — additive file; nothing references it yet.

---

## Slice 2 — condensed single-doc mode

The small-ticket path: `/discovery <N> condensed` writes one `docs/<SLUG>.md`; `/spec`/`/plan` detect and refuse.

**Files**

- Edit: `.claude/skills/discovery/SKILL.md` — `condensed` argument (+ issue-body `## Sizing` default), the condensed output template (spec §Surface "Condensed mode", `PORTAL_MESSAGE_TIMESTAMPS.md` shape, ≤ 80 lines), updated "What this skill is not" routing.
- Edit: `.claude/skills/spec/SKILL.md`, `.claude/skills/plan/SKILL.md` — step-1 condensed detection: `docs/<SLUG>.md` present without `.discovery.md` → stop with the extend-the-single-doc message.

**Steps**

1. **Verify (spec test plan, condensed dry-run).** Dry-run the condensed template shape against a scratch scope (no branch, no commit — template conformance only): header line, `**Why.**`, `## Current shape`, `## Decision — <name>`, `## Plan — <n> slice(s)`, `## Smoke (manual…)`, `## Out of scope`. Then assert `/spec`/`/plan` refuse on a branch carrying only a condensed doc.
2. **Fix** template/detection drift.
3. Lint + type-check.

**Done when:** the dry-run doc matches the pinned shape and both sibling skills refuse correctly.

**Risk:** wording drift between the three edited skills — keep the detection paragraph identical in `/spec` and `/plan` (contract-stability lean: reference `CLAUDE.md`, don't re-explain).

---

## Slice 3 — `/smoke` skill

The phase-5 gate: scaffold the manual walkthrough from the spec's acceptance criteria.

**Files**

- New: `.claude/skills/smoke/SKILL.md` — per spec §Surface `/smoke`: prerequisites, the three inputs (acceptance criteria / plan slices / branch diff), the `BULK_AGGREGATE.smoke.md` output structure, condensed embedded mode, hard rules (manual-never-automated, boxes never pre-checked, coverage rule, no commit).

**Steps**

1. **Verify (spec test plan, `/smoke 178` dogfood).** Draft the skill; run `/smoke 178` against this branch. Assert: `docs/DEV_CYCLE_SKILLS.smoke.md` maps **every** spec acceptance criterion to ≥ 1 unchecked step; Preflight covers checkout/install (no migrate step — spec says no schema change); sign-off + bug template present.
2. **Fix** coverage gaps or structure drift. The dogfooded smoke doc **stays on the branch** — it is #178's own pre-merge gate (spec acceptance criterion 7).
3. Lint + type-check.

**Done when:** `docs/DEV_CYCLE_SKILLS.smoke.md` exists, covers all acceptance criteria, all boxes unchecked.

**Risk:** the dogfood output is also a deliverable — review it as content, not just as skill-exercise.

---

## Slice 4 — `/epic` skill + `Epic` issue type

Epic coordination: parent + sub-issues + the epic-branch deployment gate.

**Files**

- New: `.claude/skills/epic/SKILL.md` — per spec §Surface `/epic`: create/manage invocations, parent-issue pin (Issue Type `Epic`, Status + dependency tables, #177 exemplar), child creation via `/ticket` templates + `addSubIssue`, branch mechanics (children from/into `epic/<slug>`, keep-pace merges, batch `Closes` in the final PR only, rebase-preferred/squash-fallback, `--delete-branch`), hard rules.

**Steps**

1. **One-time org setup.** Create the `Epic` issue type: `gh api -X POST orgs/EnterpriseBT/issue-types -f name="Epic" …` — **requires `admin:org` scope** (`gh auth refresh -h github.com -s admin:org`, run by the user). Record the returned node id for slice 5's `CLAUDE.md` edit.
2. **Verify (spec test plan, `/epic` dogfood).** Draft the skill; create a scratch parent + one scratch child. Assert: parent Issue Type is `Epic`; `subIssues.totalCount = 1` via GraphQL; `epic/<slug>` branch pushed; Status/dependency tables present; child body names its branch + dependencies.
3. **Fix** drift; then clean up — delete the scratch epic branch (local + remote), close both scratch issues `--reason not-planned`.
4. Lint + type-check.

**Done when:** the scratch epic round-trip passed every assertion and all scratch artifacts are gone.

**Risk:** blocked at step 1 until the user grants `admin:org`. If the scope isn't granted when this slice starts, the slice proceeds with the skill's documented fallback (verify-and-report path) and the type id lands in slice 5 once created — flag it in the PR test plan rather than silently shipping without it.

---

## Slice 5 — `CLAUDE.md` + `.github/copilot-instructions.md`

The doc sync: document the five-artifact model and every convention the skills now enforce.

**Files**

- Edit: `CLAUDE.md` — per spec §Surface: artifact table → five rows; new subsections "Ticket kinds & body templates" (+ `Epic` type id in "Filing an issue"), "Epic branches", "The smoke gate", "Condensed path for small tickets"; formatting-enforcement note near Key Scripts.
- Edit: `.github/copilot-instructions.md` — new `## Issue → PR workflow (lifecycle)` condensed section (~12 lines, existing altitude).

**Steps**

1. **Verify (spec test plan, docs review).** Draft the edits; walk the spec's §Surface "CLAUDE.md edits" + "copilot-instructions mirror" bullet-by-bullet against the diff — every pinned subsection present, no stale "four artifacts" phrasing left (`grep -n "four artifact" CLAUDE.md` returns only the historical-context uses the spec allows, i.e. none), skill table lists all six skills.
2. **Fix** gaps.
3. Lint + type-check.

**Done when:** both files carry every pinned edit and the mirror stays at its established abridgement level.

**Risk:** `CLAUDE.md` is also this repo's agent contract — a wrong convention statement propagates to every future session; review this diff most carefully.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | `/ticket` skill | scratch feature + bug issues match templates |
| 2 | condensed mode (3 skill edits) | dry-run shape + sibling refusals |
| 3 | `/smoke` skill + `docs/DEV_CYCLE_SKILLS.smoke.md` | every acceptance criterion mapped, boxes unchecked |
| 4 | `/epic` skill + `Epic` org issue type | scratch epic round-trip green, artifacts cleaned |
| 5 | `CLAUDE.md` + copilot mirror | spec §Surface walked bullet-by-bullet |

After slice 5: the user walks `docs/DEV_CYCLE_SKILLS.smoke.md` (the gate this ticket itself introduces), then PR #206 leaves draft and merges on CI green + smoke confirmation.

## Cross-slice notes

- **Scratch hygiene:** slices 1 and 4 create real GitHub objects — every scratch issue closes `--reason not-planned` and every scratch branch deletes before the slice commits; nothing scratch appears in the PR.
- **`Epic` type id spans slices 4 → 5:** created in 4, documented in 5. If `admin:org` is granted before slice 4, no gap; otherwise slice 5 holds the placeholder until the id exists (never commit an invented id).
- **Doc-sync is slice 5 by design** (not a per-slice touch): the skills are the capability, `CLAUDE.md` is the doc surface, and they land in the same PR per "Keeping Documentation in Sync".
- **`docs/DEV_CYCLE_SKILLS.smoke.md` is a deliverable, not scratch** — it stays, and its confirmation is the merge gate.
- **No jest, no migration, no seed** anywhere in this plan (spec: 0 automated cases; no schema change).

## Next step

Implementation begins on this branch — slice 1 first, verification-first, one commit per slice — discovery, spec, and plan are all review-confirmed.
