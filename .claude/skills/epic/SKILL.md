---
name: epic
description: Epic coordination for the Issue → PR workflow — create a parent tracking issue (Issue Type Epic) with native sub-issue children and an epic/<slug> branch the children merge into; manage children, the status/dependency map, and close-out. The epic branch is a deployment gate — main auto-deploys to app-dev, so only the finished epic merges to main. Invoke as /epic <one-line summary> (create) or /epic <issue-number> (manage).
---

# /epic — create and manage an epic (parent + children + epic branch)

Epics group multiple feature/bugfix children that ship **as one deployment**. Merging to `main` auto-deploys to the app-dev environment, so children of an open epic never PR to `main` directly — they merge into `epic/<slug>`, and only the completed epic reaches `main`. Reference exemplar for the parent issue: #177.

Each child ticket runs the normal cycle on its own branch (discovery/spec/plan or condensed, implementation, smoke) — this skill owns the **coordination**: the parent issue, the sub-issue links, the epic branch, and the record-keeping.

## Arguments

- `/epic <one-line epic summary>` — create a new epic. Gather the overview and the intended children (ask; never invent scope).
- `/epic <issue-number>` — manage an existing parent: add/remove children, refresh the Status table, drive close-out.

If the argument reads like a single deliverable (no separable children), stop and route to `/ticket` — an epic of one is a feature.

## Steps — creating an epic

### 1. Verify the `Epic` issue type exists

```bash
gh api orgs/EnterpriseBT/issue-types --jq '.[] | select(.name=="Epic") | .node_id'
```

It exists (`IT_kwDODs25Bc4CFje_`, created for #178). If this ever returns nothing, report the one-time creation command (`gh api -X POST orgs/EnterpriseBT/issue-types -f name="Epic" …` — needs `admin:org` scope) and stop rather than mis-typing the parent.

### 2. Create the parent issue

Title: short imperative epic name (no mandatory prefix — the type badge carries the kind). Body:

```markdown
<Overview/arc: 1–2 paragraphs — what ships when the epic completes, and why the children are one deployment. Name the epic branch.>

## Status

| Ticket | Role | State |
|---|---|---|
| #<child> — <name> | <layer/role in the arc> | Todo |

<States: `Todo` → `In progress` → `Merged into epic` → `Closed` (close-out only).>

## Children & dependencies

<Which child blocks which, and why. "Independent" is a valid answer.>

## Out of scope

- <what this epic explicitly doesn't ship>
```

Set the Issue Type to `Epic` via the same GraphQL mutation `/ticket` uses (`updateIssue` with `issueTypeId: IT_kwDODs25Bc4CFje_`).

### 3. Create the children as native sub-issues

Each child is a normal ticket — **use `/ticket`'s body templates and steps** (PRD or repro+impact, Issue Type `Feature`/`Bug`, sizing recorded). Additionally, each child body's `## References` names its dependencies ("blocked by #<sibling>") and its intended child branch (`feat/<child-slug>`, targeting the epic branch).

Link each child to the parent:

```bash
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}' -f p=<parentNodeId> -f c=<childNodeId>
```

Verify with `issue(number:<parent>){subIssues(first:50){totalCount}}`.

### 4. Create and push the epic branch

```bash
git checkout main && git pull --ff-only origin main
git checkout -b epic/<slug> && git push -u origin epic/<slug>
```

Move the parent's board card to `In Progress` (the one-liner in `CLAUDE.md` → "Filing an issue"). Report parent URL, children, branch — then stop; child work proceeds per child via the normal per-phase skills.

## The branch mechanics (what you enforce while managing)

- **Children branch from the epic branch**, not `main`: `git checkout epic/<slug> && git checkout -b feat/<child-slug>`. Child PRs set **base: `epic/<slug>`** and squash-merge into it after review + CI (workflows run on all non-`main` pushes).
- **Keep-pace rule:** before each child PR merges, update the epic branch from main — `git checkout epic/<slug> && git merge main && git push`. Merge commits on the epic branch are fine (they vanish at final rebase/squash); the final integration must never be a big bang.
- **Child issues stay open at child-merge.** GitHub auto-close only fires on default-branch merges. Update the parent's Status row to `Merged into epic` instead — the batch close happens at close-out.
- **The Status table is the record of truth.** Every child state change (branch opened, PR opened, merged into epic) updates the parent body **in the same action** — a stale table is a bug.

## Steps — close-out (`/epic <N>` when all children are merged)

1. Verify every child's Status row is `Merged into epic` and epic CI is green.
2. Run `/smoke` for the epic if integration-level smoke is warranted (children already smoked individually; the epic smoke covers cross-child interactions). The user confirms it — same human gate as any PR.
3. Final PR: `epic/<slug>` → `main`. Body carries `Closes #<parent>` **and** `Closes #<child>` for **every** child — this is the single closing event for the whole epic.
4. Merge: **rebase-merge preferred** (preserves one-commit-per-child on `main`; satisfies linear history), **squash fallback** if rebase conflicts. Pass `--delete-branch`.
5. Confirm: parent + children closed as completed, board cards `Done`, epic branch gone, `git remote prune origin` locally.

**Hard rules:**

- **Children never PR to `main` while their epic is open** — the epic branch is the deployment gate; a child that "just ships early" defeats it. If a child genuinely must ship independently, that's a scope decision for the user: pull it out of the epic explicitly.
- **Ask, never invent** children, scope, or dependency order — the arc is the user's; the structure is yours.
- **No child implementation here.** This skill coordinates; child code follows each child's own cycle.
- **All-or-nothing GitHub writes:** if a step fails mid-creation (e.g. sub-issue link), finish or roll back before reporting — never leave a half-linked epic silently.

## What this skill is not

- It is not `/ticket` — single deliverables go there.
- It is not a release process — deploys stay driven by `main` merges; this only controls *when* the epic reaches `main`.
- It does not run children's discovery/spec/plan/smoke — each child uses the per-phase skills on its own branch.
