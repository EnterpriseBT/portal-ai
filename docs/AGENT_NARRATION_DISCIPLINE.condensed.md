# Agent narration discipline — Condensed design (#1102)

**Issue:** [EnterpriseBT/portal-ai#1102](https://github.com/EnterpriseBT/portal-ai/issues/1102) · Feature · **condensed** (re-sized from `full`: the work is now prompt and agent configuration in `apps/api` only, with deterministic tests and no live-model eval).

**Why.** The portal agent narrates around its work despite `## Response Style`:
- **Claims no tool backs:** an invitation "has been sent", though nothing is emailed.
- **Preambles:** "I'll send all three invitations…" before calling a tool.
- **Recaps:** restating a block already on screen.

There are two levers:
- **The prompt.** Tell the agent what its tools can change, generated from each toolpack's declared capabilities, so the boundary can't drift from the tools. Sharpen the preamble and recap rules.
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
| Tool capabilities | `packages/core/src/registries/tool-capabilities.ts:78` `ALL_TOOL_CAPABILITIES` | Each tool declares `computeShape` (`mutate` = changes something) and `writes` |
| Custom packs in the prompt | `system.prompt.ts:1252` (`customToolPacks`: name, description, `toolNames`) | Capabilities are not in the prompt context |

## Decision 1 — a generated "What Your Actions Do" section

A new section placed just before `## Response Style`, built from `stationContext.effectiveToolPacks`.
- **Changing tools:** the session's built-in tools with `computeShape === "mutate"` or a non-empty `writes`, listed by name. Each change happened only if its tool returned success, and the agent says what the result says, nothing more. If there are none, the section instead says nothing the agent does here changes data.
- **A fixed boundary line**, the same for every station: nothing leaves this session. The agent can't send, email, message or notify anyone, schedule anything, set a reminder, or remember anything after the session. It never says it did, will or can, nor implies it ("once it arrives", "check your inbox").
- **When custom packs exist:** an organization-provided tool may do more. The agent describes only what its result reports.

The Members paragraph keeps its invite-link instructions, but its "never say you send, email or deliver" sentence moves into the boundary line, so the rule has one source.

## Decision 2 — sharper Response Style

- **Preamble bullet:** in a turn that needs a tool, the tool call is the first thing the agent outputs. No "Let me…", "I'll…", "First, …", and no plan before acting.
- **Post-amble bullet:** after a block, either nothing or one sentence the block doesn't show. Never a list or a restatement.

The Good/Bad example stays.

## Decision 3 — a `prepareStep` reminder after a rendered block

`narrationStepPrep(system)` (exported from `portal.service.ts`) returns the `prepareStep` passed to `streamText`:
- **When it fires:** the previous step had a tool result for which `resolveDisplayBlock` is non-null.
- **What it returns:** `{ system: system + "\n\n" + RENDERED_BLOCK_REMINDER }`, where the reminder reads: "The result above is already on screen as a block. Don't restate or list it. Reply with nothing, or one sentence it doesn't show, or call the next tool with no text before it."
- **Otherwise:** it returns `{}`.

Keying on the produced block covers custom tools. The turn continues, so chaining (query → chart) still works. Nothing is cached on this call, so the per-step system change costs nothing extra.

## Plan — 2 slices

**Slice 1: prompt.**
- **Files:** `system.prompt.ts` (new section builder, Response Style wording, Members sentence moved).
- **Tests:** `apps/api/src/__tests__/prompts/system.prompt.test.ts`:
  - the section lists exactly the station's changing tools (`member_invite`, `entity_record_update` …), excluding read-only and pure ones;
  - the "nothing changes data" variant appears for a station without changing tools;
  - the boundary line appears for every pack combination;
  - the custom-pack sentence appears only with custom packs;
  - the section sits before Response Style;
  - the new preamble/post-amble wording is present;
  - Members no longer duplicates the boundary sentence.

**Slice 2: `prepareStep`.**
- **Files:** `portal.service.ts`.
- **Tests:**
  - `apps/api/src/__tests__/services/portal.service.test.ts` drives `narrationStepPrep` directly. The reminder fires after a data-table, d3, geo, mutation or custom `type:"data-table"` result. It doesn't fire after a scalar result, a tool error, on step 0, or when the step had no tools.
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
