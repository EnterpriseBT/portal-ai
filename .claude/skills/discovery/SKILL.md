---
name: discovery
description: Phase 2 of the four-phase workflow — scaffold a grounded discovery doc for a GitHub issue. Surveys the relevant code, generates docs/<SLUG>.discovery.md on a new branch, leaves it ready for the user to refine. Invoke as /discovery <issue-number>.
---

# /discovery — scaffold a discovery doc for an issue

You are scaffolding **phase 2** of the four-phase workflow defined in `CLAUDE.md` → "Issue → PR Workflow". The output is a draft of `docs/<SLUG>.discovery.md` on a fresh branch. You **do not commit, do not push, do not open a PR** — the user reviews and refines first.

## Arguments

The user invokes this as `/discovery <issue-number>`. If they invoked it with no argument, ask them which issue once and stop.

## Steps

### 1. Fetch the issue

```bash
gh issue view <N> --repo EnterpriseBT/portal-ai --json number,title,body,labels,state,issueType
```

If the issue doesn't exist, or `state` is `CLOSED`, stop and tell the user. If `issueType` is unset, warn but continue — note in the doc that the type should be set before merging the discovery PR.

### 2. Derive the slug

The slug becomes the file name (`docs/<SLUG>.discovery.md`) and the branch suffix (`docs/<slug>-discovery`). Derive it from the issue title:

- `UPPER_SNAKE_CASE` for the file name (e.g. issue "API connector" → `API_CONNECTOR`)
- `lower-kebab-case` for the branch (e.g. `api-connector`)

Ask the user to confirm the slug if the title is ambiguous (more than five words, special characters, etc.). Otherwise pick and tell them in one sentence what you chose.

### 3. Create the branch

```bash
git checkout main
git pull --ff-only origin main
git checkout -b docs/<slug>-discovery
```

If a branch by that name already exists locally or remotely, stop and ask the user how to proceed (extend the existing branch vs. pick a new name).

### 4. Survey the codebase

Use the **Explore agent** with a structured prompt — do NOT do this serially with Read/Grep yourself, you will waste context. The prompt template:

> I'm writing a discovery doc for issue EnterpriseBT/portal-ai#`<N>` — `"<title>"`. Issue body:
>
> > `<paste issue body>`
>
> Find and summarize the parts of /workspace that this work will touch or build on. Specifically:
>
> 1. `<list 3–7 numbered topic areas tailored to the issue>`. For each, cite file paths as `path:line` and describe the architecture in 2–4 sentences. Do NOT paste large code blocks.
>
> Return ~500–800 words organized by the numbered topic areas. The goal is to ground my discovery doc in the real system, not a generic one.

**Tailor the topic areas to the issue.** For a new connector → existing connector adapter/registry, sync job, field mappings, auth services, frontend workflow shape. For a frontend feature → relevant views/workflows/modules, SDK endpoints, query keys, related dialogs. For a backend feature → relevant routes/services/repositories/schemas/queues. **Never** use a generic checklist — read the issue and pick what's actually relevant.

### 5. Read one reference discovery doc

Read **one** existing discovery doc to anchor the style. Default to `docs/SPREADSHEET_PARSER_ROW_ASYNC.discovery.md` — it's compact and shows the full structure. If the issue clearly resembles another existing doc, prefer that one.

### 6. Write `docs/<SLUG>.discovery.md`

Follow the house structure exactly:

```markdown
# <Feature name> — Discovery

**Issue:** [EnterpriseBT/portal-ai#<N>](https://github.com/EnterpriseBT/portal-ai/issues/<N>)

**Why this exists.** <1–2 paragraphs. Restate the problem the issue describes. End with "this is the X that does Y" framing.>

## The current shape

### <subsection per architectural area you surveyed>

<Tables of file/symbol citations work well here. Lift the file paths from the Explore agent's response — never invent paths.>

## The design space

<For each genuine design decision, label it and lay out 2–4 options. Each option gets a short paragraph and a pros/cons table. End each decision with a "Lean: <X>." line and one sentence of reasoning.>

### Decision 1 — <name>

<options A/B/C…>

| | A | B | C |
|---|---|---|---|
| <axis> | … | … | … |

**Lean: <X>.** <reasoning>

### Decision 2 — <name>

…

## Tradeoff comparison

|  | <decision 1 lean> | <decision 2 lean> | … |
|---|---|---|---|
| Spread to spec | Yes/No | Yes/No | … |

## Recommendation

<Numbered list of concrete choices. Each item should be a sentence the spec doc can lift verbatim.>

## Open questions

<Numbered list. Each item is a real ambiguity, not a placeholder. Each ends with "Lean: <answer>." — never leave a question without a lean.>

## What this doesn't decide

<Bulleted list of explicit out-of-scope items. Be specific about *why* it's deferred (size / risk / scope creep).>

## Next step

<One paragraph naming the spec and plan docs that follow, and roughly how the plan will slice the work.>
```

**Hard rules for the draft you produce:**

- **No invented file paths or symbols.** Every `path:line` citation comes from the Explore agent's response. If you can't cite, don't claim.
- **No placeholder questions.** Open questions are real ambiguities surfaced during the survey. If a question has an obvious answer, fold it into the recommendation instead.
- **Leans are mandatory.** Every open question and every decision in the design space gets a `Lean:` line. The point of discovery is to make calls, not list possibilities.
- **Length: 100–250 lines.** Tighter for narrow tickets; longer only when the design space is genuinely broad.

### 7. Hand off to the user

Stop. Report to the user:

- The branch you created
- The doc you wrote and its line count
- 2–3 specific things you'd flag for them to refine (places where the survey was thin, decisions where the lean was a coin-flip, etc.)

Do **not** stage, commit, push, or open the PR. The user reads the draft, refines it, and runs the standard `gh` flow per `CLAUDE.md` → "Issue → PR Workflow". The PR body should use `Refs #<N>`, not `Closes` (issue stays open until phase 4).

## What this skill is not

- It is not for **phase 3** (spec + plan). A sibling `/spec` skill will exist; if it doesn't yet and the user asks for spec scaffolding, point them at `CLAUDE.md` and the existing `docs/*.spec.md` files for now.
- It is not for **trivial PRs**. If the user invokes it on an issue that's a one-line typo fix or a localized bug with a clear fix, tell them discovery isn't proportionate and they should go straight to phase 4.
- It does not run CI, doesn't apply branch protection, doesn't move project-board cards. Those happen elsewhere.
