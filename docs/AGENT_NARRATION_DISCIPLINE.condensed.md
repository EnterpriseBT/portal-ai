# Agent narration discipline — Condensed design (#1102)

**Issue:** [EnterpriseBT/portal-ai#1102](https://github.com/EnterpriseBT/portal-ai/issues/1102) · Feature · **condensed** (re-sized from `full`: the work is now prompt and agent configuration in `apps/api` only, with deterministic tests and no live-model eval).

**Why.** The portal agent narrates around its work despite `## Response Style`:
- **Claims no tool backs:** an invitation "has been sent", though nothing is emailed.
- **Preambles:** "I'll send all three invitations…" before calling a tool.
- **Recaps:** restating a block already on screen.

There are two levers:
- **The prompt.** Every claim about what happened rests on a tool call's input and result. Sharpen the preamble and recap rules.
- **Agent configuration.** A `prepareStep` reminder at the exact step where recaps happen: the one after a block renders.

Runtime text filtering and a live eval were considered and dropped, being heavier than the problem and costing tokens.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `streamText` | `apps/api/src/services/portal.service.ts:960-967` | `stopWhen: [stepCountIs(10), endsOnSelfContainedBlocks]`; no `prepareStep`; no prompt caching on this call |
| `endsOnSelfContainedBlocks` | `portal.service.ts:143-178` | Ends the turn after help / invitation blocks; unchanged |
| `resolveDisplayBlock(toolName, result)` | `portal.service.ts:387` | Non-null when a result renders a block (table, chart, map, mutation, progress, help, invitation, or a custom tool's `type:"data-table"/"d3"/"geo"` payload) |
| `## Response Style` | `apps/api/src/prompts/system.prompt.ts:1472-1550` | Last section; preamble/post-amble bullets and a Good/Bad example |
| "Don't offer work none of your tools can do" | `system.prompt.ts:1463` | Scoped to missing packs |
| Members: "No email is sent…" | `system.prompt.ts:722-731` | Hand-written, Members-only boundary |

## Decision 1 — claims rest on the tool calls

One new Response Style bullet: the agent describes what it did only from its tool calls, meaning what it passed in and what the result says happened, and doesn't say or imply that anything happened, or will happen, beyond what a result reports. (Offering work its tools can do stays governed by the existing "Don't offer work none of your tools can do".)

This applies equally to built-in and custom tools. It needs no per-station list of changing tools, which could drift from what the write gate or geocoding key actually built. It also makes no blanket "nothing leaves the session" claim, which a custom tool could make false.

The Members paragraph keeps its "no email is sent" and invite-link instructions, and its "never say you send, email or deliver an invitation" sentence. `member_invite`'s result says an invitation was created, which reads easily as "sent", so that tool-specific line stays beside the general rule.

## Decision 2 — sharper Response Style

- **Preamble bullet:** in a turn that needs a tool, the tool call is the first thing the agent outputs. No "Let me…", "I'll…", "First, …", and no plan before acting.
- **Post-amble bullet:** after a block, either nothing or one sentence the block doesn't show. Never a list or a restatement.

The Good/Bad example stays.

## Decision 3 — a `prepareStep` reminder after a rendered block

`narrationStepPrep(system)` (exported from `portal.service.ts`) returns the `prepareStep` passed to `streamText`.

**When it fires:** the previous step had results for which `resolveDisplayBlock` is non-null. That includes a bare row array, which renders as a table.

**What it returns:** `{ system: system + "\n\n" + renderedBlockReminder(tools, stepHadOtherCalls) }`. The reminder:
- names the tools whose results rendered, since "the result above" would point nowhere from the system prompt;
- says not to list or restate the block's rows or contents;
- says to answer the user's question in one sentence when the block holds the answer ("Q3 revenue was $1.24M."), and otherwise to write nothing or one sentence the block doesn't show;
- when the step also ran other tools, scopes itself to the rendered results, so the others (a scalar result, a failed call) are still explained or relayed.

**After every step that called tools**, whether or not anything rendered, it also appends `NEXT_TOOL_REMINDER`: call any further tool with no text before it ("Let me…", "Now…" or a note of what was found), and keep explanation for the reply after the last call. The smoke walk showed preambles between calls after scalar results and blocks alike, so the block reminder alone wasn't enough.

**The first step, and a step after a text-only step,** get nothing.

Keying on the produced block covers custom tools. The turn continues, so chaining (query → chart) still works. Nothing is cached on this call, so the per-step system change costs nothing extra.

## Plan — 2 slices

**Slice 1: prompt.**
- **Files:** `system.prompt.ts` (Response Style wording).
- **Tests:** `apps/api/src/__tests__/prompts/system.prompt.test.ts`:
  - the tool-call rule is present under Response Style for every pack combination;
  - the new preamble/post-amble wording is present;
  - Members keeps its never-claim sentence beside the general rule.

**Slice 2: `prepareStep`.**
- **Files:** `portal.service.ts`.
- **Tests:**
  - `apps/api/src/__tests__/services/portal.service.test.ts` drives `narrationStepPrep` directly. The reminder fires after a data-table, bare row array, d3, geo, mutation or custom `type:"data-table"` result, naming that tool. In a step that also ran a scalar tool or had a failed call, it names only the rendered tools and scopes itself. After only a scalar result, a failed-only step or a non-object output, only `NEXT_TOOL_REMINDER` is added. Nothing is added on step 0 or after a text-only step. `renderedBlockReminder` and `NEXT_TOOL_REMINDER` wording are pinned separately.
  - A `MockLanguageModelV3` test, in the style of `portal-tool-error.contract.test.ts`, asserts the second call's system prompt carries the reminder and the first's doesn't. It's deterministic and uses no tokens.

`npm run test:unit` (api), `type-check`, `lint`.

## Smoke (manual, against your dev stack; a handful of real turns)

1. Members station: "Invite a1@example.com, a2@example.com and a3@example.com as members" → three invitation blocks, no text before or after.
2. "Email pat the invitation" → says invitations aren't emailed and the user shares the link; no claim of sending.
3. A data question answered by a table → the table plus at most one sentence, no list.
4. An ambiguous request ("show me the big ones") → a clarifying question is asked.
5. "Show sales by region, then chart it" → the table and the chart both render (chaining still works after the reminder).

## Out of scope

- Runtime filtering of the agent's text, and any live-model or token-spending eval.
- Changing `endsOnSelfContainedBlocks`, or the help and invitation blocks' behaviour.
- A capability field for custom toolpacks (their effects stay "what the result reports").
- Tone and length of tool-free answers.
