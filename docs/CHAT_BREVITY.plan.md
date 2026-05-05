# Chat Brevity — Plan

**TDD-sequenced implementation of the `## Response Style` section in `buildSystemPrompt`.**

Spec: `docs/CHAT_BREVITY.spec.md`. Discovery: `docs/CHAT_BREVITY.discovery.md`.

The change is small enough to land as a single slice — one PR, two files, ~50 lines of production code and ~80 lines of tests. There is no phasing, no migration, no rollout coordination. The plan below is sequenced TDD-first per repo convention: failing tests, then the prompt edit, then verify.

Run tests with `cd apps/api && npm run test:unit` per `feedback_use_npm_test_scripts` — never invoke jest directly.

---

## Slice 1 — Add `## Response Style` section + tests

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — append the new section block before `return lines.join("\n")`.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — append a new `describe("buildSystemPrompt — response style", ...)` block at the bottom of the file.

No new files. No file deletions.

**Steps**

1. **Write the new test block first** in `system.prompt.test.ts`, after the existing `describe("buildSystemPrompt — entity management notes", ...)`. Cases per spec §"Test plan":
   - `it("includes ## Response Style for every toolPack composition", ...)` — loops over four `makeContext` invocations (no toolPacks, `["data_query"]`, `["entity_management"]`, `["data_query","entity_management"]`) and asserts `toContain("## Response Style")` on each.
   - `it("places ## Response Style after all other sections", ...)` — uses a fully-populated context (both toolPacks, an `entityGroups` entry, an `entityCapabilities` map) and asserts the three `indexOf` ordering checks from spec §"Test plan" (2).
   - `it("contains all wording invariants", ...)` — single context, single `it` body, runs `expect(prompt).toContain(s)` for each of: `"## Response Style"`, `"Skip pre-ambles"`, `"Skip post-ambles"`, `"Summary:"`, `"Key takeaways:"`, `"describe_column"`, `"web_search"`, `"resolve_identity"`, `"Q3 revenue was $1.24M"`.
   - `it("contains the good/bad example pair", ...)` — asserts both `"Good"` and `"Bad"` substrings present, with `prompt.indexOf("Bad") - prompt.indexOf("Good") < 250` to confirm same example block.
   - The `makeContext` helper at the top of the file already returns a usable shape — no edits needed; pass overrides per case.
   - Run `cd apps/api && npm run test:unit -- system.prompt`. All five new tests must fail (section doesn't exist yet). The existing tests must still pass — if any existing test fails at this point, stop and investigate (the test file's helper or imports broke).

2. **Append the section in `system.prompt.ts`**. After the `entity_management` block ends (around line 125, after the closing `lines.push("");` of the metadata-tables paragraph) and before the `return lines.join("\n")`, push the new section. The cleanest implementation is one `lines.push(...)` per logical paragraph rather than one giant template literal — matches the surrounding style and keeps blame tidy.

   ```ts
   lines.push("## Response Style");
   lines.push("");
   lines.push(
     "You are speaking inside a portal session. The user sees a feed of " +
       "rendered blocks — data tables, charts, and mutation results — alongside " +
       "your prose. Be brief."
   );
   lines.push("");
   lines.push(
     "- Skip pre-ambles. Do not announce what tool you are about to call; " +
       "just call it. The tool-call block makes the action visible."
   );
   lines.push(
     "- Skip post-ambles. After a tool returns a data table, chart, or " +
       "mutation result, do not restate its contents in prose. The block is " +
       "already on screen. One short sentence of interpretation is fine when " +
       "it adds something the block does not show on its own (a trend " +
       "direction, a caveat about the data, a recommended next step). Do " +
       'not append a "Summary:" or "Key takeaways:" recap at the end of a turn.'
   );
   lines.push(
     '- Answer the question, not the meta-question. If the user asks "what ' +
       'was Q3 revenue?", answer with the number. Do not narrate the steps ' +
       "you took to get there."
   );
   lines.push(
     "- When a tool call fails or returns no rows, say so in one sentence " +
       "and stop. Do not propose three alternative queries unless the user asks."
   );
   lines.push(
     "- Prefer plain sentences over bulleted lists for short answers."
   );
   lines.push("");
   lines.push(
     "Some tools do need interpretation on top of their output: " +
       "`describe_column`, `web_search`, and `resolve_identity` return " +
       "information the user cannot read off the block alone. For these, a " +
       "short interpretive sentence or two is appropriate."
   );
   lines.push("");
   lines.push('Example — user asks "what was Q3 revenue?":');
   lines.push("");
   lines.push("  Good (after a sql_query tool call returns one row):");
   lines.push("    Q3 revenue was $1.24M.");
   lines.push("");
   lines.push("  Bad:");
   lines.push("    Let me run a query to find Q3 revenue. [tool call]");
   lines.push(
     "    The query returned successfully. Q3 revenue was $1.24M, which"
   );
   lines.push(
     "    represents a 15% increase over Q2's $1.08M. Here is a summary"
   );
   lines.push("    of what I did: …");
   lines.push("");
   ```

   Use the same `lines.push("")` pattern between paragraphs that the rest of the function uses — do not introduce a different formatting convention. Quoting: keep the `"Summary:"` and `"Key takeaways:"` substrings verbatim; the tests pin them.

3. **Re-run the unit tests.** All five new cases must pass. Existing cases must still pass — in particular:
   - `it("omits capability flags when entityCapabilities is undefined")` — passes because the new section contains no `[read` or `[write` substrings.
   - `it("omits IDs when entity_management is not in toolPacks")` — passes because the new section contains none of `connectorEntityId:`, `columnDefinitionId:`, `fieldMappingId:`, `sourceField:`.
   - `it("does not reference currency type")` — passes because the new section makes no mention of currency.

   If any existing `not.toContain` assertion regresses, the new section accidentally introduced a colliding substring; reword the offending bullet, do not loosen the existing assertion.

4. **Run the broader unit suite** — `cd apps/api && npm run test:unit` (no filter). Anything else that exercises `buildSystemPrompt` indirectly (e.g. `portal.service.test.ts`) should remain green. The system prompt is consumed as an opaque string by `streamResponse`, so nothing downstream pins its content.

5. **Manual smoke test against a running portal session** — per spec acceptance criteria:
   - Start the API + web (`npm run dev` from repo root).
   - Open a portal session for any station with a connector instance and the `data_query` tool pack enabled.
   - Send: `show me the first 5 records of <entity>`.
   - Observe the rendered turn:
     - No "I'll run a query…" pre-amble before the `tool-call` block.
     - The `data-table` block renders with five rows.
     - At most one short sentence after the table (or none). No row-by-row narration. No trailing "Summary:" / "Here is what I did:" block.
   - Send a follow-up: `what was Q3 revenue?`. Expect a one-line answer with the number, no recap of the prior table.
   - If the model still produces verbose post-ambles in 2 of 3 attempts, the wording needs strengthening — note the actual output in the PR description and tighten the relevant bullet (most likely the "Skip post-ambles" one) before merging.

**Done when:**

- All new tests pass; all existing tests in the file pass unchanged.
- `cd apps/api && npm run test:unit` is green end-to-end.
- The manual smoke test produces a brief, non-recapping turn for both representative prompts.

**Risk:** none unique to this slice beyond the spec-level risks. The change is purely additive to a single function, behind no flag, and tested in isolation.

---

## Out-of-band considerations

- **No follow-up slice planned in this PR.** The discovery and spec both flag a possible later workstream around live model-output golden tests (to guard wording against model upgrades) and a possible per-station `responseStylePreset` field. Neither is required for this change to ship and neither is started here.
- **No deployment coordination.** The system prompt is rebuilt per portal turn from the request-time `StationContext` — there is no cache, no warmup, no migration. The change takes effect on the first portal turn served by the new build.
- **No telemetry change.** Existing portal-event logging captures portal turns end-to-end; if we want to measure brevity uplift quantitatively (e.g., average characters of assistant text per turn before/after), that's a separate analytics workstream and is out of scope per the spec.

---

## PR shape

- Branch: `feat/introduce-more-brevity-in-chat` (current branch — already pointed at this work).
- Commit: one commit, conventional-commits style: `feat(portal-prompt): add Response Style section for chat brevity`.
- PR description: link the discovery + spec docs; paste before/after example outputs from the manual smoke test (one verbose, one brief) so reviewers can see the qualitative delta the wording is trying to produce.
