---
name: smoke-walk
description: Walk a ticket's manual smoke checklist in a real browser and produce a reviewable evidence report. Drives the running dev stack via the Playwright MCP server (reusing the e2e auth fixture + seeded org), captures a screenshot and observed value per step, and classifies each step verified / mismatch / could-not-automate. It NEVER edits the .smoke.md or checks a box — the human reviews the evidence and confirms. Invoke as /smoke-walk <issue-number | path-to-smoke-doc>.
---

# /smoke-walk — walk a smoke checklist in the browser and report evidence

You are the **execution** counterpart to `/smoke`. `/smoke` scaffolds the manual checklist (`docs/<SLUG>.smoke.md`); `/smoke-walk` drives a real browser through it against the running dev stack and produces a **per-step evidence report** a human then reviews. This is the agent-driven half of the smoke gate (`CLAUDE.md` → "The smoke gate"): automatable steps get an evidence walk, the human accepts or denies that evidence and checks the boxes.

**You never check a box in the `.smoke.md`, never edit it, and never merge.** The report is evidence for a human decision, not the decision. A pre-checked box — or a step reported `verified` you did not actually observe — forges the gate.

## Prerequisites

This skill drives the browser through the **Playwright MCP** server (`mcp__playwright__*` tools, wired in repo-root `.mcp.json`). It depends on the `@portalai/e2e` harness (#304):

- the dev stack is running (`npm run dev` — web on `:3000`, API on `:3001`);
- a reusable session exists (`packages/e2e/.auth/storageState.json`, from `npm run --workspace @portalai/e2e e2e:auth`);
- the fixture org is seeded (`npm run --workspace @portalai/e2e e2e:seed`).

If the `mcp__playwright__*` tools are not available in this session, stop and tell the user to ensure `.mcp.json` is loaded (the Playwright MCP server is a session-start dependency) — do not fall back to reasoning about the UI from source, which is exactly what this skill exists to replace.

## Arguments

Invoked as `/smoke-walk <issue-number | path-to-smoke-doc>`.

- A number → resolve `docs/<SLUG>.smoke.md` for that issue's branch (derive `<SLUG>` the same way `/smoke` does). A path → use it directly.
- If you can't resolve exactly one `.smoke.md`, ask once and stop.

## Steps

### 1. Locate and parse the smoke doc

Read the target `docs/<SLUG>.smoke.md`. Extract its `## Preflight` items and each `§` section's checkbox steps in order. Note any step tagged `— manual` (added by `/smoke`'s split): those are declared non-automatable up front — you will report them `could-not-automate` without attempting them.

### 2. Preflight — fail loudly, never silently pass

Before walking any step, confirm the environment. Each check has an exact remediation and, if it fails, you **stop the walk** and report the preflight failure (a walk against a broken environment produces fiction, not evidence):

- **Stack reachable** — `mcp__playwright__browser_navigate` to `http://localhost:3000`. If it errors or the page is unreachable: report `app not reachable at :3000 — run npm run dev` and stop.
- **Authenticated** — the navigation lands on an authed view, not the login screen. If it lands on login (storageState missing/expired): report `not authenticated — run npm run --workspace @portalai/e2e e2e:auth` and stop.
- **Fixture present** — the seeded `e2e-fixture` org is reachable (switch into it if the walk needs it). If absent: report `fixture org missing — run npm run --workspace @portalai/e2e e2e:seed` and stop.

Record the preflight outcome (`stack ✓ · auth ✓ · fixture ✓`) at the top of the report.

### 3. Walk each step — drive, observe, classify

For each checkbox step, in document order:

1. **Drive** the action described using the `mcp__playwright__*` tools — navigate, click, type, select, etc. Use the exact prompts/inputs/values the step names.
2. **Observe** the externally-observable result the step asserts. Read the real value from the page (text, a rendered count, a URL, a disabled state) via a snapshot / DOM read — never assume.
3. **Capture** a screenshot (`mcp__playwright__browser_take_screenshot`) into `packages/e2e/test-results/`. For steps that assert console/network behavior, also capture `mcp__playwright__browser_console_messages` / `mcp__playwright__browser_network_requests`.
4. **Classify** the step (see rules below).

Do not stop the walk on a single step's `mismatch` — record it and continue, so the report covers the whole checklist. Only a **preflight** failure or a genuinely blocked navigation (can't proceed further) halts the walk; say so in the report.

### 4. Write the evidence report

Write to `packages/e2e/test-results/smoke-walk-<SLUG>.md` (git-ignored) **and** summarize in your reply. Never touch the `.smoke.md`. Format:

```markdown
# Smoke walk — <SLUG> (#<N>)  ·  agent evidence, NOT a merge confirmation

Preflight: stack ✓ · auth ✓ · fixture ✓
Branch: <branch> · walked: <count> steps

## §1 — <section name>
- <step text> → **verified** · observed: <the real value read> · shot: test-results/…/s1.png
- <step text> → **mismatch** · expected: <X> · observed: <Y> · shot: …/s2.png
- <step text> → **could-not-automate: <reason>** · (human must walk)

## §2 — <…>
…

## Summary
N verified · M could-not-automate · K mismatch
<one line naming any mismatch a human should look at first>
```

### 5. Hand off — the human decides

Stop. Tell the user: the report path, the summary counts, and that **they** review the evidence and check the `.smoke.md` boxes — the walk informs the gate, it is not the gate. If there were mismatches, name them first; a mismatch goes through the smoke doc's bug-filing template, not an ad-hoc fix here.

## Classification rules

- **verified** — you drove the step and read a real observed value that matches the expected result. A `verified` step **must** carry an observed value in the report; "looks right" is not an observation.
- **mismatch** — you drove the step and the observed value contradicts the expected result. Record both values. Never silently pass it.
- **could-not-automate: `<reason>`** — the step is inherently outside a browser-only walk. Report it, never guess at it, and **never** upgrade it to `verified`. Typical reasons: a third-party redirect (Auth0/Google/Stripe hosted pages beyond the app), a payment flow, a real vendor account/webhook, visual/aesthetic judgment, an email/SMS round-trip, or anything the step tagged `— manual`.

When in doubt between `verified` and `could-not-automate`, choose `could-not-automate` — a false `verified` is the one outcome that corrupts the gate.

## Hard rules

- **You never check a box, never edit the `.smoke.md`, never merge.** The human confirms.
- **Never report `verified` for a step you did not actually observe** — down stack, blocked navigation, or an unread value all mean `could-not-automate`/`mismatch`, not `verified`.
- **Evidence is concrete** — every step row carries a screenshot path and (for `verified`/`mismatch`) the observed value.
- **The report lives under `packages/e2e/test-results/`** (git-ignored) — it is a working artifact, not a committed doc.

## What this skill is not

- It is not `/smoke` — that scaffolds the checklist; this executes it. Run `/smoke <N>` first if there is no `.smoke.md`.
- It is not a merge step — it produces evidence; green CI **and** the human's confirmation (informed by this evidence) remain the gate.
- It is not a test runner — it drives the real app through the browser, it does not run jest/Playwright specs (those are a deferred, separate tier).
