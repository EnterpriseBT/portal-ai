---
name: ticket
description: Phase 1 of the Issue → PR workflow — create a correctly-typed GitHub issue with a PRD (feature) or repro + impact (bug) body, set the Issue Type via GraphQL, confirm the project-board card, and record the sizing decision (full docs vs condensed). Invoke as /ticket <feature|bug> <one-line summary>.
---

# /ticket — create a correctly-typed issue

You are executing **phase 1** of the workflow in `CLAUDE.md` → "Issue → PR Workflow". The output is a filed GitHub issue on `EnterpriseBT/portal-ai` with the right Issue Type, a body that follows the house template for its kind, and a recorded **sizing decision** that selects the doc path every later phase follows (`full` → `/discovery` → `/spec` → `/plan` → `/smoke`; `condensed` → `/discovery <N> condensed`).

This skill creates the ticket and **nothing else** — no branch, no docs, no code.

## Arguments

Invoked as `/ticket <feature|bug> <one-line summary>`. The type argument is optional — infer it from the description (reproduction/error/regression language → bug; capability/improvement language → feature). If neither reading is clear, ask once and stop.

**Epic parents are not created here.** If the request describes a multi-ticket grouping (several separable deliverables, phased work, "epic"), stop and route to `/epic` — it owns the parent issue, the sub-issue links, and the epic branch.

## Steps

### 1. Gather inputs — ask, never invent

The issue body is a contract with the team; **missing requirements are asked for, never invented**. Collect before scaffolding:

- **Feature:** the problem/goal (why now), the concrete deliverables, the externally-observable acceptance criteria, explicit out-of-scope items, references (related issues, file paths, precedents) — **and walk the PRD dimension checklist below.**
- **Bug:** the exact reproduction (prompt/steps), expected vs got, the impact (why it matters, who hits it), any evidence (transcripts, DB rows, screenshots), fix-direction hypotheses if the user has them. Bugs skip the checklist — the repro template has its own shape.

If the user's request already contains all of this, don't re-ask — confirm gaps only.

#### The PRD dimension checklist (feature tickets)

These are the requirement dimensions that repeatedly surface late when unasked (#212; the cautionary example is #176, where actor tiers and surface placement arrived as PRD amendments *after* discovery was drafted). This checklist is the **single source** for the dimensions — `/discovery`'s completeness gate reads it from this file. For each dimension, one of three things must be true before scaffolding: the conversation already answers it, the user answers a targeted question, or the user explicitly waives it.

1. **Actors & roles** — who uses/operates the capability: self-serve user, org owner, operator/admin (CLI), the portal agent? Any permission boundaries between them?
2. **Surfaces & placement** — where does it manifest (view/tab/dialog/CLI/API)? A new surface, or extending an existing one?
3. **Standard vs bespoke paths** — is there an enterprise/custom/manual-operator variant beyond the self-serve default?
4. **Lifecycle interactions** — how does it behave against adjacent features it touches (delete/tombstone, multi-org, tiers/billing, running jobs)?
5. **States & edge behavior** — user-visible empty/error/degraded/locked states worth requiring up front?

Ask as **one batched set of targeted questions** covering only the genuinely unanswered dimensions — never five rote questions when the request already answers three. Record an explicit waiver as `N/A — <reason>` in the relevant PRD section: a consciously skipped dimension is not a gap, and `/discovery`'s gate will not re-ask it. Distribute the answers into the template — actors/surfaces/bespoke paths shape `## Deliverables`, lifecycle/states shape `## Acceptance criteria`, waivers land where they apply.

### 2. Decide the sizing

Recommend **`condensed`** only when the change is single-package, introduces no new pattern, and changes no contract (same threshold as `CLAUDE.md`'s "Skip artifacts when proportionate"). Everything else is **`full`**. State the recommendation and the reason in one sentence; the user confirms. The decision is recorded in the body's `## Sizing` section and read later by `/discovery`.

### 3. Scaffold the body from the matching template

**Feature body template (PRD):**

```markdown
## Why

<1–2 paragraphs: the problem/goal, why now, any concrete caller or precedent.>

## Deliverables

- [ ] <concrete surface/capability 1>
- [ ] <…>

## Acceptance criteria

- <externally-observable truth 1>
- <…>

## Out of scope

- <explicit deferral + why>

## Sizing

<`full` | `condensed`> — <one-line reason>.

## References

- <related issues, file paths, docs, precedents>
```

**Bug body template:**

```markdown
## Repro

<exact steps or prompt. **Expected:** <…> **Got:** <…>>

## Impact

<why it matters, who hits it, how bad>

## Likely cause / fix direction

<hypotheses; "unknown" is acceptable>

## Evidence

<transcripts, DB rows, log lines, screenshots>

## Sizing

<`full` | `condensed`> — <one-line reason>.

## References

- <related issues, file paths>
```

### 4. Create the issue

```bash
gh issue create --repo EnterpriseBT/portal-ai --title "<short imperative title>" --body-file <scaffolded-body>
```

### 5. Set the Issue Type

GitHub's structured type field, set via GraphQL (per `CLAUDE.md` → "Filing an issue"):

```bash
gh api graphql -f query='mutation($id:ID!,$typeId:ID!){updateIssue(input:{id:$id,issueTypeId:$typeId}){issue{number}}}' -f id=<issueNodeId> -f typeId=<IT_…>
```

Fetch the issue node id via `repository.issue(number:N){id}` and the type ids via `repository.issueTypes(first:10){nodes{id name}}`. Use `Feature` or `Bug` (`Task` for chores; `Epic` belongs to `/epic`).

### 6. Confirm the board card

The **Portal AI** project board auto-adds new issues to `Todo`. Verify (`gh project item-list 1 --owner EnterpriseBT …` — needs the `project` token scope) and leave it in `Todo` — the card moves to `In Progress` when the first branch commit lands, not at filing time.

### 7. Hand off to the user

Report: the issue URL, the type set, the recorded sizing, and the next command — `/discovery <N>` (full) or `/discovery <N> condensed`.

**Hard rules:**

- **The Issue Type is always set.** An issue without a type is an incomplete ticket, not a style choice.
- **The sizing is always recorded** in the body — later phases read it; an unrecorded sizing re-opens the debate mid-cycle.
- **Ask, never invent.** Scaffolding structure is your job; requirements are the user's. An empty section prompts a question, not creative writing.
- **No branch, no docs, no code.** Phase 2 (`/discovery`) creates the branch.

## PRD amendments (post-filing)

When the user adds or changes a requirement after the ticket is filed ("add a requirement to the PRD: …"), the PRD and its branch move **together, in one action**:

1. **Update the issue body first** — the PRD is the record of truth; the new requirement lands in `## Deliverables` / `## Acceptance criteria`, not just in conversation.
2. **Run the new requirement through the dimension checklist** — if it raises fresh questions (a new actor? a new surface?), ask them now, not at review.
3. **Reconcile every in-flight artifact** on the ticket's branch (discovery/spec/plan, or the condensed doc) in the same action — a PRD that contradicts its branch docs is a bug in this change, not a follow-up.
4. **Commit the reconciliation** referencing the issue (`docs: <what changed> (#<N>)`).

## What this skill is not

- It is not `/epic` — multi-ticket parents, sub-issues, and epic branches live there.
- It is not `/discovery` — it doesn't survey code, create branches, or write docs.
- It doesn't move board cards to `In Progress`, assign people, or apply labels beyond what the user asks for.
