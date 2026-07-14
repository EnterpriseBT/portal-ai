# PRD authoring hardening — Condensed design (#212)

**Issue:** [EnterpriseBT/portal-ai#212](https://github.com/EnterpriseBT/portal-ai/issues/212) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every dev-cycle phase is codified except PRD authoring: `/ticket`'s "gather inputs" step is one "ask, never invent" bullet with a category list, there's no dimension checklist to elicit against, no procedure for amending a PRD mid-flight, and `/discovery` trusts whatever body it finds. #176 is the evidence — "custom/enterprise subscriptions" and "dedicated billing tab" (actor-tier and surface-placement questions) surfaced only after the discovery doc existed, forcing rework. Touches `.claude/skills/` + `CLAUDE.md` (markdown only).

## Current shape

| Piece | Location | Note |
|---|---|---|
| `/ticket` step 1 "Gather inputs" | `.claude/skills/ticket/SKILL.md:20-27` | One bullet per ticket kind; no dimensions, no protocol |
| Feature PRD template | `.claude/skills/ticket/SKILL.md:35-63` | Why / Deliverables / Acceptance / Out of scope / Sizing / References |
| `/discovery` step 1 "Fetch the issue" | `.claude/skills/discovery/SKILL.md:18` | Checks existence/state/type only — never PRD completeness |
| Workflow ticket templates | `CLAUDE.md:448` ("Ticket kinds & body templates") | Describes body shapes, not elicitation |
| Abridged mirror | `.github/copilot-instructions.md:77` | One-paragraph workflow summary; "ticket = PRD" stays true |

## Decision — single-source checklist in `/ticket`; `/discovery` gates by reference

**Where the checklist lives.** Options: (a) duplicate the dimension list in both skills — drifts; (b) canonical in `CLAUDE.md`, both skills point at it — puts execution detail in the always-loaded doc that stays deliberately terse about phase internals; (c) canonical in `/ticket`'s SKILL.md (the phase that owns PRD authoring), `/discovery` references it by path. **Chosen: (c).** The elicitation protocol is `/ticket` step-1 material; `/discovery`'s gate says "check the body against the PRD dimension checklist in `.claude/skills/ticket/SKILL.md`" and reads that file at run time — one source, no drift. `CLAUDE.md`'s "Ticket kinds & body templates" gains one sentence naming the checklist's existence.

**The dimensions** (feature PRDs only; bugs keep the repro template):

1. **Actors & roles** — who uses/operates it: self-serve user, org owner, operator/admin (CLI), the portal agent; permission boundaries.
2. **Surfaces & placement** — where it manifests (view/tab/dialog/CLI/API); new surface vs extending an existing one.
3. **Standard vs bespoke paths** — does the capability have an enterprise/custom/manual-operator variant beyond the self-serve default?
4. **Lifecycle interactions** — behavior against adjacent features it touches (delete/tombstone, multi-org, tiers/billing, running jobs).
5. **States & edge behavior** — user-visible empty/error/degraded/locked states worth requiring up front.

**Gate behavior.** `/discovery` (both modes), feature issues only: after fetching the issue, evaluate the PRD against the checklist. Gaps → ask the user (one batched set of targeted questions), update the issue body, *then* survey/draft. Explicit "not applicable" answers are recorded in the PRD (a dimension consciously skipped ≠ a gap). The gate is blocking — a discovery doc drafted against an incomplete PRD is the failure mode this ticket exists to prevent.

**Amendment procedure** (new `/ticket` section, referenced from `CLAUDE.md`): any post-filing scope change — a feature requirement added, or a bug's repro/impact shifting — updates the issue body **and**, if a branch exists, reconciles every in-flight artifact (discovery/spec/plan/condensed doc) in the same action, committing the reconciliation with a reference to `#<N>` — codifying what #176 did by hand. Only feature amendments run the dimension checklist; the reconciliation rule is ticket-kind-agnostic.

## Plan — 1 slice

**Files**
- `.claude/skills/ticket/SKILL.md` — edit: step 1 becomes "Gather inputs — the PRD dimension checklist" (protocol: walk dimensions, batch targeted questions, record explicit N/As); new "PRD amendments (post-filing)" section after step 7.
- `.claude/skills/discovery/SKILL.md` — edit: new step between "Fetch the issue" and "Derive the slug": "PRD completeness gate (feature issues)"; condensed-mode section notes the gate applies there too.
- `CLAUDE.md` — edit: "Ticket kinds & body templates" gains one sentence on the checklist + amendment procedure.
- `.github/copilot-instructions.md` — verify only; the abridged summary's claims are unchanged (expected: no edit).

**Tests** — none; markdown-only (no `src/**` glob is touched, so lint-staged/prettier don't apply to skills; `docs/*.md` is deliberately unformatted). Verification is the smoke walkthrough.

## Smoke (manual, against your dev stack)

1. In a fresh Claude Code session, run `/ticket feature <deliberately thin one-liner>` (e.g. "add CSV export"). **Check:** before any issue is filed, you get one batched set of questions covering actors, surface/placement, bespoke paths, lifecycle, and states — not an issue scaffolded from inference. Cancel without filing.
2. Create a scratch feature issue with a thin body (or reuse one), then run `/discovery <N>`. **Check:** the gate asks about the missing dimensions and updates the issue body *before* any branch survey/doc drafting begins. Close the scratch issue after.
3. On an in-flight ticket with a committed discovery doc, tell the agent to "add a requirement to the PRD: <X>". **Check:** the issue body and the branch's doc(s) are updated together, in one action, with a commit referencing the issue.
4. Read the updated `/ticket` + `/discovery` SKILL.md files and `CLAUDE.md` diff. **Check:** the checklist exists in exactly one place (`ticket/SKILL.md`) and `/discovery` references it by path.

## Out of scope

- **A standalone `/prd` skill** — rejected in ticket triage: the PRD is the issue body; its protocol lives in the phase that owns the body.
- **Bug-ticket repro template** — elicitation targets feature PRDs.
- **`/spec` / `/plan` / `/smoke` / `/epic` changes** — no cross-references there today that break.
- **Retrofitting existing open tickets** — the `/discovery` gate catches them naturally when they're picked up.
