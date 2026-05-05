# Chat Brevity — Spec

**Trim verbose pre-amble, post-amble, and closing-recap prose from portal-session AI turns by adding a `## Response Style` section to `buildSystemPrompt`.**

Discovery: `docs/CHAT_BREVITY.discovery.md`. Resolved decision points from the discovery's open list, applied below:

- **D1 (exact wording):** locked in §"Prompt addition" below.
- **D2 (positive examples in-prompt):** include exactly one good/bad pair. The token cost (~80 tokens) is acceptable; pairs anchor the rule far better than abstract bullets alone.
- **D3 (constrain bullets/headings):** yes. One sentence: "Prefer plain sentences over bulleted lists for short answers." Cheap, aligned with the goal.
- **D4 (test strategy):** static `toContain` / `not.toContain` assertions on the prompt string in this PR. No live model-output golden tests — those belong to a follow-up if drift is observed.

After this change: every portal-session SSE turn carries a system prompt that explicitly instructs Claude to skip pre-ambles before tool calls, skip recapping rendered tool-result blocks, and avoid trailing "Summary:" sections. No other behavior changes.

---

## Scope

### In scope

1. **Prompt builder change** — append a new `## Response Style` section to the output of `buildSystemPrompt` in `apps/api/src/prompts/system.prompt.ts`. Section content per §"Prompt addition" below.
2. **Section ordering** — `## Response Style` is appended **last**, after `## Available Data`, the optional `## Cross-Entity Relationships`, and the optional `## Entity Management Notes`. Rationale: the model reads the prompt top-to-bottom, and the data-shape sections are the load-bearing context the model needs first; the style guidance lands closest to the user turn so it stays salient.
3. **Always-on** — the section is emitted unconditionally, regardless of `toolPacks` composition or `entityCapabilities` content. Brevity is not gated on which tools are available.
4. **Unit tests** — new `describe` block in `apps/api/src/__tests__/prompts/system.prompt.test.ts` asserting:
   - The section is present in every `buildSystemPrompt` invocation (no toolPacks, `data_query`-only, `entity_management`-only, both, with and without `entityGroups`, with and without `entityCapabilities`).
   - The section appears after all other sections (string-index ordering check).
   - Specific load-bearing phrases are present (so wording drift is caught at review time).
   - Existing tests in the file remain green without modification.

### Out of scope

- Any change to `streamText` parameters, SSE event shapes, tool definitions, tool descriptions, or persisted message blocks.
- Frontend rendering changes (`PortalMessage`, `ContentBlockRenderer`, `MessageList`). The model produces shorter prose; no clipping or post-processing on the client.
- Per-station or per-organization verbosity preferences. v1 is one global posture.
- Live model-output golden tests. The static prompt-string assertions in this PR guard against accidental wording removal; behavioral regressions across model upgrades are a separate, larger workstream.
- Changes to the `describe_column`, `web_search`, `resolve_identity`, or any other tool's `description` field.

---

## Prompt addition

Append the following block to `lines` in `buildSystemPrompt`, after the `entity_management` block and before the final `lines.join("\n")`. Heading depth `##`, matching peers.

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
  caveat about the data, a recommended next step). Do not append a
  "Summary:" or "Key takeaways:" recap at the end of a turn.
- Answer the question, not the meta-question. If the user asks "what was
  Q3 revenue?", answer with the number. Do not narrate the steps you
  took to get there.
- When a tool call fails or returns no rows, say so in one sentence and
  stop. Do not propose three alternative queries unless the user asks.
- Prefer plain sentences over bulleted lists for short answers.

Some tools do need interpretation on top of their output: `describe_column`,
`web_search`, and `resolve_identity` return information the user cannot
read off the block alone. For these, a short interpretive sentence or two
is appropriate.

Example — user asks "what was Q3 revenue?":

  Good (after a sql_query tool call returns one row):
    Q3 revenue was $1.24M.

  Bad:
    Let me run a query to find Q3 revenue. [tool call]
    The query returned successfully. Q3 revenue was $1.24M, which
    represents a 15% increase over Q2's $1.08M. Here is a summary
    of what I did: …
```

The example pair is intentionally concrete: same scenario, two outputs side-by-side, with the failure modes named in the discovery (pre-amble, post-amble, narrating-the-steps, trailing summary) all present in the "Bad" version. This reinforces the bullets without restating them.

### Wording invariants the tests pin

These specific substrings must be present in the produced prompt — they are the load-bearing instructions and the names of the exceptional tools. Test failure on removal is intentional; copy edits go through review.

- `"## Response Style"`
- `"Skip pre-ambles"`
- `"Skip post-ambles"`
- `"Summary:"` (in the "Do not append" sentence)
- `"Key takeaways:"`
- `"describe_column"`, `"web_search"`, `"resolve_identity"`
- `"Q3 revenue was $1.24M"` (anchors the example pair)

### What is *not* pinned

The exact prose of the bullets is not pinned by the tests beyond the substrings above. Editors can tighten wording without test churn as long as the load-bearing phrases survive.

---

## Behavior when sections are absent

The discovery clarifies that `## Response Style` is always emitted. Concretely:

- A `StationContext` with empty `entities` array still emits `## Response Style` (the `## Available Data` heading is emitted but with no entity sub-sections; this matches today's behavior).
- A `StationContext` with no `entityGroups` and no `entity_management` toolPack still emits `## Response Style` directly after `## Available Data`.
- A fully-populated `StationContext` emits `## Response Style` last, after `## Entity Management Notes`.

The unit tests cover all three positions.

---

## Test plan

New `describe("buildSystemPrompt — response style", () => { ... })` block in `apps/api/src/__tests__/prompts/system.prompt.test.ts`. Cases:

1. **Section is always present.** Iterate over four contexts (no toolPacks, `data_query` only, `entity_management` only, both packs) and assert `prompt.includes("## Response Style")` on each.
2. **Section is last.** With a fully-populated context (toolPacks `["data_query","entity_management"]`, two entities, one entity group, capabilities set), assert:
   - `prompt.indexOf("## Response Style") > prompt.indexOf("## Available Data")`
   - `prompt.indexOf("## Response Style") > prompt.indexOf("## Cross-Entity Relationships")`
   - `prompt.indexOf("## Response Style") > prompt.indexOf("## Entity Management Notes")`
3. **Load-bearing phrases present.** Assert each of the substrings listed in §"Wording invariants the tests pin" appears via `toContain`.
4. **Tool exceptions named.** Assert `prompt` contains all three of `describe_column`, `web_search`, `resolve_identity` in a single context (`data_query`-only is fine; the section is gated only on emission, not on which tools are actually registered).
5. **Example pair present.** Assert the prompt contains both `"Good"` and `"Bad"` substrings within ~200 characters of each other (same example block).
6. **No regression on existing assertions.** All existing `describe` blocks (`entityCapabilities`, `entity management IDs`, `entity management notes`) continue to pass with no edits — the new section's content does not collide with their `toContain` / `not.toContain` patterns.

The check in (6) is the silent-but-important one: the existing `not.toContain("connectorEntityId:")` assertion in the "omits IDs when entity_management is not in toolPacks" case must continue to pass. Verify by running the existing test file unchanged after the prompt edit; if it fails, the new section accidentally referenced an ID-flavored substring and needs rewording.

Run with `cd apps/api && npm run test:unit -- system.prompt` per `feedback_use_npm_test_scripts` (never invoke jest directly — missing `NODE_OPTIONS` breaks ESM deps).

---

## Files touched

- **Edit:** `apps/api/src/prompts/system.prompt.ts` — append the new section.
- **Edit:** `apps/api/src/__tests__/prompts/system.prompt.test.ts` — add the new `describe` block; existing blocks unchanged.

That's it. No DB migration. No contract change. No new env var. No SDK surface change. No frontend file touched.

---

## Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Section copy is too aggressive — model strips useful interpretation. | Medium. Claude follows brevity rules sharply. | The bullets explicitly preserve "one short sentence of interpretation is fine when it adds something the block does not show." If qualitative review of the next ~10 portal sessions shows under-interpretation, soften that bullet; revisit wording in a follow-up PR rather than rolling back the whole section. |
| Token budget pressure. | Low. The added section is ~350 tokens, dwarfed by the entity schema sections in any real station. | If token cost ever becomes the bottleneck, the example pair (~80 tokens) is the first thing to drop; bullets stay. |
| Section conflicts with future per-station style preferences. | Low. | The new section reads from no `StationContext` field, so a future `responseStylePreset` field can either replace this block or augment it without conflict. |
| Existing test regression. | Low. | Test plan §(6) explicitly verifies. |

**Rollback** is a one-line revert of `apps/api/src/prompts/system.prompt.ts` plus deletion of the new `describe` block. No state to clean up.

---

## Acceptance criteria

- [ ] `buildSystemPrompt(...)` output contains the `## Response Style` section for every `StationContext` shape exercised in the test file.
- [ ] The section appears after `## Available Data`, `## Cross-Entity Relationships`, and `## Entity Management Notes` whenever those sections are present.
- [ ] All wording-invariant substrings from §"Wording invariants the tests pin" are present.
- [ ] Existing `describe` blocks in `system.prompt.test.ts` pass unchanged.
- [ ] `cd apps/api && npm run test:unit -- system.prompt` is green.
- [ ] Manual smoke test: open a portal session, ask "show me the first 5 records of <entity>", confirm the assistant turn is the tool-call + table + at most one short sentence (no pre-amble before the call, no per-row narration after).
