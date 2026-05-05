# Chat Brevity — Discovery

## Goal

Tune the portal-session AI so its turns are short and tool-driven. The model should answer the user's actual question in a sentence or two, lean on rendered tool output (tables, charts, mutation result blocks) to do the talking, and stop appending narrated summaries after every `sql_query` or write tool call.

Concretely, three behaviors we want to remove or reduce in the current portal-session experience:

1. **Pre-amble.** Stating what is about to be done before calling a tool ("I'll run a query to find…"). The tool-call block already shows the user that a query is happening; the prose is redundant.
2. **Post-amble.** Restating tool results in prose after the tool block already rendered them. If a `sql_query` returned a five-row table, the assistant should not then write "I found 5 records: Acme had revenue of …" — the table is already on screen, pinned, and inspectable.
3. **Closing recap.** A trailing "Summary:" or "Key takeaways:" block at the end of a multi-step turn that re-narrates everything the user just watched happen.

These are model defaults from how Claude is trained to behave in chat — they are helpful in unstructured conversations and unhelpful in a portal session, where the user is reading a feed of rendered blocks (data tables, vega-lite charts, mutation results) and a long natural-language wrapper around each tool call dilutes the signal.

Out of scope for this discovery:

- Suppressing all assistant prose. Some prose is load-bearing — answering "what's the trend?" with just a chart and no one-line interpretation is worse, not better. The goal is brevity, not silence.
- Reducing the number of tool calls per turn. Step count (`stopWhen: stepCountIs(10)` in `portal.service.ts`) and tool-pack composition stay as-is.
- Changing the streaming protocol or the rendered block types (`text`, `tool-call`, `tool-result`, `vega-lite`, `data-table`, `mutation-result`). Brevity is a prompt-level concern; the SSE/render pipeline is unchanged.
- Per-organization or per-station configurability of verbosity. v1 is one global posture for every portal session.

---

## Existing State

### Where the system prompt is built

A single prompt builder is responsible for everything Claude knows about the station: `apps/api/src/prompts/system.prompt.ts:buildSystemPrompt`. It composes:

- An opening `You are an analytics assistant for the "<station>" station.` line.
- An `## Available Data` section listing each `EntitySchema` with its columns, types, and (when `entity_management` is in the toolPacks) write-capability flags + ID metadata.
- An optional `## Cross-Entity Relationships` section if any `EntityGroup`s are defined.
- An optional `## Entity Management Notes` section with origin-tagging behavior, `_record_id` / `_connector_entity_id` hidden columns, `normalizedKey` semantics, and the `_*` metadata-table catalogue.

There is **no section on response style, length, or when to write prose vs. defer to tool output**. The model's verbosity is whatever Claude defaults to.

### Where the prompt is consumed

`apps/api/src/services/portal.service.ts:streamResponse` is the only caller. It is invoked from the SSE route in `apps/api/src/routes/portal-events.router.ts` once per user turn. It:

1. Calls `buildSystemPrompt(stationContext)` (line 466).
2. Builds the toolset via `ToolService.buildAnalyticsTools` (line 468).
3. Calls AI SDK `streamText({ model, system, messages, tools, stopWhen: stepCountIs(10), maxRetries: 3 })`.
4. Iterates `result.fullStream` and emits SSE events for `text-delta`, `tool-call`, `tool-result`, `error`, `finish`.

Adding a brevity instruction is a prompt-builder change only — no streaming, tool, or persistence change required.

### Where the prompt is tested

`apps/api/src/__tests__/prompts/system.prompt.test.ts` — covers entity-capability flags, `entity_management` ID rendering, and the "Entity Management Notes" gating. New brevity rules need their own `describe` block: assertions that the response-style section is present, and that it does not balloon when toolPacks shift.

### Tools whose output already self-narrates

These tools emit rendered blocks the user can read directly. Prose recap on top adds nothing:

- `sql_query` — emits a `data-table` block with column headers and rows.
- `visualize` / `visualize_tree` — emits a `vega-lite` block.
- `entity_record_create` / `_update` / `_delete`, `connector_entity_*`, `field_mapping_*` — emit `mutation-result` blocks (see `MutationResultContentBlockSchema`, surfaced by the `MutationResultBlock` component on the web side, with bulk count + items already rendered).
- `correlate`, `detect_outliers`, `cluster`, `regression`, `trend`, `technical_indicator`, `npv`, `irr`, `amortize`, `sharpe_ratio`, `max_drawdown`, `rolling_returns` — emit structured result blocks.

Tools where prose interpretation **does** add value (and should not be suppressed):

- `describe_column` — the model can usefully one-line "this looks like a USD currency stored as `number`" on top of the raw stats.
- `web_search` — the model needs to synthesize across results; raw web hits are not a useful display surface on their own.
- `resolve_identity` — the model often has to reconcile ambiguous matches and pick one with a reason.

The brevity guidance has to distinguish "results that render themselves" from "results the model still needs to interpret." A blanket "never narrate tool output" rule overshoots.

---

## Approach: a `## Response Style` section in `buildSystemPrompt`

Add one new section to the prompt, appended after the existing sections. Treat it as a peer of `## Available Data` and `## Entity Management Notes` — same heading depth, same plain-prose register, same place in the file.

Draft content (subject to wordsmithing during the spec):

```
## Response Style

You are speaking inside a portal session. The user sees a feed of rendered
blocks — data tables, charts, and mutation results — alongside your prose.
Be brief.

- Skip pre-ambles. Do not announce what tool you are about to call; just
  call it. The tool-call block makes the action visible.
- Skip post-ambles. After a tool returns a data table, chart, or mutation
  result, do not restate its contents in prose. The block is already on
  screen. One short sentence of interpretation is fine when it adds
  something the block does not show on its own (a trend direction, a
  caveat about the data, a recommended next step). No "Summary:" or
  "Key takeaways:" recap blocks at the end of a turn.
- Answer the question, not the meta-question. If the user asks "what
  was Q3 revenue?", answer with the number. Do not narrate the steps
  you took to get there.
- When a tool call fails or returns no rows, say so in one sentence and
  stop. Do not propose three alternative queries unless the user asks.

Some tools do need interpretation on top of their output: `describe_column`,
`web_search`, and `resolve_identity` return information the user cannot
read off the block alone. For these, a short interpretive sentence or
two is appropriate.
```

The bullets are deliberately concrete — "skip pre-ambles", "no Summary: blocks", "answer the question, not the meta-question" — because Claude responds better to specific behavioral rules than to generic "be concise" exhortations.

### Why a system-prompt change and not a tool-description change

The verbosity we are pruning is in the assistant's **text** between tool calls, not inside the tool I/O. A change to a tool's `description` field would only affect when and how the model picks that tool, not the prose it wraps around the result. The system prompt is the right surface.

### Why one global section, not per-toolPack

Brevity is a session-wide stance, not a tool-specific one. It applies equally whether the user is read-only querying a station or doing entity management. The exceptions are listed inline in the section ("describe_column, web_search, resolve_identity") rather than gated by toolPack composition — those tools render the same way regardless of which pack they ship in.

### Why not also tighten on the frontend (e.g., truncate text blocks)

Frontend truncation hides information the model intended to convey, which makes pinning and follow-up turns confusing — the saved message and the displayed message diverge. Fix the source. The model should produce shorter prose, not longer prose that gets clipped on render.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Model overshoots and gives one-word answers that strip useful interpretation. | The prompt explicitly preserves "one short sentence of interpretation when it adds something the block does not show." Spec phase tunes wording with a few representative prompts and inspects the output. |
| Brevity rule conflicts with the "Entity Management Notes" instructions about querying `_record_id` first. | Those are mechanical rules about how to use tools, not about prose verbosity. They live in their own section and read fine alongside the new section. No edit needed. |
| Tests pin specific prompt strings and break. | Existing tests in `system.prompt.test.ts` use `toContain` on specific phrases (e.g. `"## Entity Management Notes"`, `"normalizedKey"`) that the new section does not touch. New section gets its own tests; existing tests pass unchanged. |
| Different stations want different verbosity (e.g., an executive-summary station wants more prose). | Out of scope for v1. If this comes up, the natural follow-up is a per-station `responseStylePreset` field on the station, fed through `StationContext`. The prompt builder is already parameterized on `StationContext`, so the extension is small — but we are not building it speculatively. |
| LLM-eval drift: brevity tuned today regresses on a future model. | Add a small set of golden prompts to the test suite that assert no `## Summary` / `Key takeaways:` strings appear in the assistant's output for a representative `sql_query` turn. These guard against re-emergence of the verbose pattern across model upgrades. (Spec decision — may land in a follow-up if cost is high.) |

---

## Decision points for the spec phase

1. **Exact wording of the section.** Draft above is a starting point; the spec lands the final copy.
2. **Whether to include positive examples in-prompt** ("Good: `Q3 revenue was $1.2M.` Bad: `Let me run a query… [tool call] …I found that Q3 revenue was $1.2M, which represents a 15% increase…`"). Examples in system prompts are powerful but bloat token count. Recommend: one good/bad pair, no more.
3. **Whether to also constrain bullet/heading use.** The model defaults to markdown-heavy output (bullets, bold labels) even for one-paragraph answers. A line like "prefer plain sentences over bulleted lists for short answers" is cheap and aligned with the goal — proposing yes, finalize in spec.
4. **Test strategy.** Static `toContain` assertions on the new section + at least one negative assertion that previously-emitted summary patterns are discouraged. A live model-output golden test is heavier and may belong in a follow-up.

---

## Files touched (anticipated)

- `apps/api/src/prompts/system.prompt.ts` — append the `## Response Style` section.
- `apps/api/src/__tests__/prompts/system.prompt.test.ts` — new `describe("buildSystemPrompt — response style")` block.

No other code changes anticipated. No DB migration, no contract change, no frontend change, no SDK surface change.
