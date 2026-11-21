# Agent narration discipline — Discovery

**Issue:** [EnterpriseBT/portal-ai#1102](https://github.com/EnterpriseBT/portal-ai/issues/1102)

**Why this exists.** The portal agent narrates around its work despite the prompt's `## Response Style`, which already says to skip preambles and post-ambles and never recap. Walks on #1049 and #847 caught three kinds of narration:
- **Claims no tool backs.** It said an invitation "has been sent". Nothing is emailed.
- **Preambles.** It announced calls before making them ("I'll send all three invitations at the same time!").
- **Recaps.** It restated blocks the user was already reading.

Prompt wording hasn't held. Each fix that did work was server-side: `endsOnHelpBlocks` (#1049), generalised to `endsOnSelfContainedBlocks` (#847), ends the turn before the model can recap a help or invitation block. That fix is per tool.

This is the server-side text discipline that applies to every turn, whatever the station's packs. It drops pre-tool text, caps follow-up text after rendered blocks, and removes claims the session's tools don't back. A regression eval holds it in place.

## The current shape

### The turn loop (`apps/api/src/services/portal.service.ts`)

| Piece | Location | Note |
|---|---|---|
| `streamText` call | `:960-967` | `stopWhen: [stepCountIs(10), endsOnSelfContainedBlocks]`, `maxRetries: 3`; no `prepareStep` / `onStepFinish`. AI SDK `ai` 6.0.280 |
| Chunk loop | `:978-1008` | Handles `text-delta`, `tool-call`, `tool-result`, `tool-error`, `error`, `finish`; ignores `start-step` / `finish-step`, so text isn't tracked per step |
| `handleTextDelta` | `:206-210` | Appends to `ctx.currentText` **and emits an SSE `delta` immediately**. This is how a preamble reaches the browser before the tool call is known |
| `handleToolCall` | `:221-249` | Flushes pending text as a `{type:"text"}` block first, so a preamble is stored as the text block just before the tool-call block |
| `handleToolResult` → `resolveDisplayBlock` | `:257-301`, `:387-549` | Stores the raw result; emits `tool_result` + stores a display block when one resolves |
| Persist | `:1048` | `repo.portalMessages.create` runs **once, after the stream ends**, so filtering can still change what is stored |
| `endsOnSelfContainedBlocks` | `:143-178` | Stops when the last step's calls all succeeded and every result parses as a `SELF_CONTAINED_BLOCK_TOOLS` schema (`platform_help`, `member_invite`, `invitation_show`). Keyed on **tool name** |
| `replayTurn` | `:1112-1158` | Replays stored text blocks as `delta` on reconnect, so anything filtered before persistence stays filtered |

### What renders a block

`resolveDisplayBlock` produces a block for `progress`, `d3`, `geo`, `help`, `invitation`, `data-table` (inline rows or a `queryHandle`, nothing when empty) and `mutation-result` (only on success with items). It produces none for `scalar`. `ResultKindSchema` is `packages/core/src/models/tool-capability.model.ts:80-89`, and built-ins declare theirs in `packages/core/src/registries/builtin-toolpacks.ts`.

**Custom (webhook) tools.** `resolveDisplayBlock` reads `resultKind` only from the static `ALL_TOOL_CAPABILITIES` (`packages/core/src/registries/tool-capabilities.ts:78-87`), so a custom tool's declared kind is never consulted. Its result renders only when the payload itself carries `type: "data-table"` (`:467`) or `"d3"`/`"geo"` (`:418`, `:432`). `customToolCapabilityError` (`tool-capability.model.ts:279-310`) bars custom tools from `help`, `invitation`, `mutation-result` and `progress`.

### The web

`PortalSSEEventSchema` (`packages/core/src/contracts/portal.contract.ts:345-417`) carries `delta`, `tool_call`, `tool_call_end`, `tool_result`, `done` and `stream_error`. The client (`apps/web/src/utils/portal-stream.util.ts:188-268`) appends deltas to the last text block. On `done`, `PortalSession.component.tsx:404-415` refetches and **replaces the streamed copy with the stored message**. Holding or dropping text is therefore server-only, with no contract change. One catch: text already sent as `delta` and filtered afterwards would flash on screen, then vanish at refetch.

### The prompt

`## Response Style` is at `apps/api/src/prompts/system.prompt.ts:1472+`. It says to skip preambles (`:1484-1487`), skip post-ambles (one short interpretive sentence allowed, `:1488-1495`) and report a failure in one sentence (`:1501`). It also lists which packs' tools need interpretation (`:1508-1518`). Elsewhere, `:1463` says "Don't offer work that none of your tools can do", and the Members section (`:722-731`) says no email is sent. These are pinned by `apps/api/src/__tests__/prompts/system.prompt.test.ts` (`:848`, `:2149-2163`).

### Tools, models and tests

- **Tool assembly.** `ToolService.buildAnalyticsTools` (`apps/api/src/services/tools.service.ts:502-1167`) assembles the station's tools. Custom tools join at `:990-1046`, and then the gates wrap them: cost, lock, permission, input-character, handle-access and output-cap (`:1073`–`:1153`). It returns only `Record<string, Tool>`; custom capabilities are dropped on return (`:1166`).
- **Model.** `DEFAULT_MODEL = "claude-sonnet-4-6"` (`apps/api/src/services/ai.service.ts:45`). `ANTHROPIC_BASE_URL` can point elsewhere.
- **Tests.** `portal.service.test.ts:176-210` mocks the whole `ai` module, so `stopWhen` never runs there. `portal-tool-error.contract.test.ts:13-40` runs the real `streamText` over `MockLanguageModelV3` and is the template for multi-step tests.
- **No eval exists.** There is no harness, no recorded transcripts and no workflow that calls a live model. The e2e Anthropic stub (`packages/e2e/src/stubs/anthropic-stub.ts`) answers only CSV-import structured calls.

## The design space

### Decision 1 — Preambles before tool calls

- **A. Buffer per step.** Track `start-step`/`finish-step`. Hold a step's text and emit it at `finish-step` only if the step made no tool calls; otherwise drop it from both the stream and storage.
- **B. Stream, then retract.** Keep streaming live; on a `tool-call` chunk, send a new SSE event telling the web to delete the step's text.
- **C. Prompt only.** Strengthen the wording. This has already failed twice.

| | A | B | C |
|---|---|---|---|
| Preamble ever visible | No | Briefly (flash) | Yes |
| Contract/web change | None | New SSE event + client handling | None |
| Token-by-token streaming | Lost: each step's text arrives whole | Kept | Kept |
| Clarifying question (no tool call) | Shown at step end | Shown live | Shown live |
| Also enables the claim screen without a flash | Yes | No | No |

**Lean: A.** Only A never shows a preamble at all, and the claim screen (Decision 3) needs the same per-step buffer to avoid the flash-then-vanish. The cost is real: a long free-form answer appears all at once instead of streaming. The `tool_call` events and the composer's status pill still show progress during tool steps. This is the biggest UX tradeoff here; see Open question 1.

### Decision 2 — Recaps after rendered blocks

- **A. End the turn after any step whose results all rendered blocks.** This generalises `endsOnSelfContainedBlocks` to every display block.
- **B. Cap the follow-up text.** The turn continues (more tools allowed). After any rendered block, the final step's text is capped server-side to its first sentence, and list or table lines are dropped. `endsOnSelfContainedBlocks` keeps zero-text for help and invitation.
- **C. A per-`resultKind` table.** Each kind declares end-turn, one-sentence or free.

| | A | B | C |
|---|---|---|---|
| Multi-step work (query → chart, table → mutation) | **Broken**: an intermediate table ends the turn | Works | Works with care |
| Interpretive sentence (the prompt's allowance) | None | One | Per kind |
| Custom tools | Covered if keyed on block produced | Covered if keyed on block produced | Needs custom kinds threaded through `resolveDisplayBlock` |
| New surface to maintain | Small | Small | A table every new kind must join |

**Lean: B, keyed on whether `resolveDisplayBlock` produced a block, not on tool name or `resultKind`.** A breaks the agent's normal chaining. Keying on the produced block covers custom tools by construction, since their blocks render from the payload, and needs no capability plumbing. `scalar` results produce no block, so their explanation stays free.

### Decision 3 — Claims no tool backs

- **A. A server-side claim screen.** A small catalogue in core of unsupported-action patterns (send, email, notify, text/SMS, schedule, remind, remember), each naming the built-in tools that would back it. Today none do. Phrasing is constrained to the agent's own action or an object's delivery ("I've sent", "I'll email", "has been sent", "you'll be notified"). A matching sentence in a buffered step is dropped unless a tool that backs that verb ran successfully this turn.
- **B. Eval only.** Catch it before release; nothing changes at runtime.
- **C. A runtime LLM judge.** A second model call grades the final text.

| | A | B | C |
|---|---|---|---|
| Stops the claim reaching the user | Yes | No | Yes |
| Cost/latency per turn | ~0 | 0 | +1 model call |
| False positives | Bounded by narrow patterns; the eval guards them | n/a | Unpredictable |
| Works on any model behind `ANTHROPIC_BASE_URL` | Yes | Yes | Yes, at a cost |

**Lean: A, with the eval (Decision 4) as its regression net.** This matches the PRD's chosen behaviour (sentence removed, rest kept, catch logged).

**Custom tools need care.** An org's webhook may genuinely send email, and its capability is free text. The lean is that a successful custom-tool call this turn exempts the turn from the screen, and the exemption is logged. See Open question 3.

### Decision 4 — The regression eval

- **A. Deterministic pipeline eval in CI.** Recorded model outputs replayed through the real `streamText` over `MockLanguageModelV3`. It asserts the server drops preambles, caps recaps and removes claims. It runs in Unit Tests with no network.
- **B. Live-model eval, scheduled.** Recorded prompts run against the real model with the real prompt and tools over a fixture station. It fails on a preamble, recap or unbacked claim in the **raw** model output (before filters) and in the filtered output. It runs weekly and opens or updates one issue, like `refresh-test-durations.yml`.
- **C. Live-model eval on every PR.** Spend and flakiness on every push, with a key in a PR context.

**Lean: A + B.** Only B can satisfy "fails if Response Style is removed", because that is a property of the prompt's effect on a real model. Only A gates PRs deterministically. B grades the raw output, so it measures how often the filters fire and doesn't hide a regressing prompt behind them.

## Tradeoff comparison

|  | D1: buffer per step | D2: cap after blocks | D3: claim screen | D4: CI replay + weekly live |
|---|---|---|---|---|
| Server-only | Yes | Yes | Yes | n/a |
| Contract change | No | No | No (new core catalogue) | New workflow + secret |
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. Track steps in the chunk loop (`start-step`/`finish-step`). Buffer each step's text and emit `delta` at `finish-step` only when the step made no tool calls; otherwise drop the text from both the stream and the stored blocks.
2. After any step in which `resolveDisplayBlock` produced a block, cap the turn's subsequent final text to its first sentence and drop list/table lines. Keep `endsOnSelfContainedBlocks` unchanged for help and invitation blocks.
3. Add a claim-pattern catalogue to `@portalai/core`. Screen each buffered step before emitting, drop matching sentences unless a backing tool succeeded this turn, and log each catch with its pattern id and session id (not the text).
4. Exempt a turn from the claim screen when a custom tool call succeeded in it, and log the exemption.
5. Add a deterministic replay suite over `MockLanguageModelV3` to the API unit tests, seeded from the #1049 and #847 narrations.
6. Add a weekly live-model eval workflow that runs recorded prompts against a fixture station, grades raw and filtered output, and opens or updates one issue on failure.
7. Keep `## Response Style`. Drop or reword nothing in it, since the live eval measures its effect. Add a line that the server removes pre-tool text and recaps, so the model isn't confused by its own missing text in history.
8. Stored messages from before release are untouched; filtering happens before persistence only.

## Open questions

1. **Is losing token streaming acceptable for free-form answers?** A long answer with no tool calls would arrive whole at step end. One alternative is to stream a no-tool step live once it passes N characters without a tool call, on the grounds that preambles are short. That reopens the preamble leak for long ones. **Lean: accept the loss.** Answers here are short by the prompt's own rule, and tool steps already show progress through `tool_call` events.
2. **Does the model's history include the dropped text?** The next turn's context is rebuilt from stored blocks, so dropped preambles vanish from history too. That is fine and arguably better, but the tool-call block then has no lead-in. **Lean: drop from history too; no placeholder.**
3. **Custom tools and the claim screen.** Exempting the whole turn on any successful custom call is coarse. The alternative is an optional `actions` list on the custom capability contract. That is a contract change for toolpack authors (`docs/CUSTOM_TOOLPACK_INTEGRATION.md`). **Lean: exempt the turn now, and file the `actions` field as a follow-up only if the logged exemptions show real misses.**
4. **Where do the recorded prompts come from?** No transcripts are in the repo. **Lean: reconstruct them from the #1049 and #847 walk notes on those issues/PRs, and the ticket's own examples, into a checked-in fixture file.** Each case is a prompt, the station packs and the expected violation class.
5. **The live eval's key and data.** It needs `ANTHROPIC_API_KEY` as a repo secret in a scheduled-only workflow, and this repo's artifacts are public. **Lean: synthetic fixture data only, no artifact upload of transcripts (the issue carries pass/fail per case), and a per-run budget cap.**

## Enterprise-scale considerations

- **Concurrency & correctness.** N/A, because the buffer is per-turn stream state on the one request already serving the turn; nothing is shared across instances.
- **Accuracy & auditability.** Lean: log every claim catch and custom-turn exemption with pattern id, org id and session id, but never the text (it may quote customer data). The weekly eval's issue is the trend record. No ledger is needed, since nothing is billed.
- **Failure modes.** Lean: **fail-open** if the screen or the cap throws: show the unfiltered text, and log at error. This is a quality guard, not a safety or cost gate, and a broken filter must not blank a reply. Prototype-grade acceptable because overclaiming is a trust defect, not a data or billing one, and the eval catches a silently failing filter.
- **Scale & unbounded growth.** Lean: the buffer is bounded by one step's output (the model's max tokens). The pattern catalogue is a fixed list; regexes are anchored and linear, with no backtracking-prone constructs.
- **Multi-tenancy.** Lean: the only per-org input is the station's custom tools (the exemption). Nothing crosses orgs, and the eval runs on a fixture org only.
- **Contract stability.** Lean: no SSE or block-shape change. The catalogue lives in core, so a future per-tool `actions` field (Open question 3) plugs into the "backed by" check without touching the loop.
- **Data lifecycle.** Lean: filtering happens before persistence, so stored history is the filtered text. Pre-release messages stay as saved. Catch logs follow the API's normal log retention.

## What this doesn't decide

- **Tone and length of free-form answers with no tool calls.** Out of scope in the PRD. Only preambles and claims are touched there.
- **The help and invitation blocks' end-turn behaviour.** Already enforced; reused, not changed.
- **A typed `actions` field on custom tool capabilities.** It changes the toolpack author contract; deferred behind Open question 3's evidence.
- **Running the live eval on residency installs' models.** The eval targets our default model; residency customers' models are their own.

## Next step

`/spec 1102` turns the recommendation into a contract. It covers:
- the step-buffer semantics,
- the cap rule's sentence and list definitions,
- the claim catalogue's shape and backing rule,
- the log fields,
- the eval fixture format and workflow.

`/plan 1102` then slices it test-first:
1. Per-step buffering and preamble drop (MockLanguageModelV3 tests).
2. The recap cap.
3. The claim catalogue and screen.
4. The replay suite from the recorded narrations.
5. The weekly live-eval workflow.
6. The prompt line and docs sync.
