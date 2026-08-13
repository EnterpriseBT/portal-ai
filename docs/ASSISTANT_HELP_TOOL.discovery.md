# In-session help tool — Discovery

**Issue:** [EnterpriseBT/portal-ai#367](https://github.com/EnterpriseBT/portal-ai/issues/367) · child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · branch `feat/assistant-help-tool` off `epic/portal-guidance`

> **Premise amended during this discovery.** The ticket originally specified a `/help` directive typed in the composer, with the run's tool set restricted server-side on those turns. That is dropped, and the ticket has been rewritten. The reasoning is in Decision 1 below; the short version is that a slash command is a second interaction model in a surface whose premise is that you type a question and the agent routes it, and everything the directive bought either evaporates without it or was orthogonal to it.

**Why this exists.** A user stuck in a portal session has nowhere to turn without leaving the conversation. `buildSystemPrompt` (`system.prompt.ts:486`) teaches the agent the station's entities, packs, and columns — never the platform — so the two questions people actually get stuck on ("what can I ask here?", "why are my answers empty?") are precisely the two the session cannot answer. The agent has no tool for them, so it either declines or answers from training.

This is the in-session layer of epic #364, and the last of its three children. #366 wrote the material it answers from and #365 made the destinations it cites addressable; this ticket is the tool that puts both inside the conversation.

## The current shape

### Tools, and what a system tool actually is

| Piece | Location | Shape |
|---|---|---|
| `Tool` base | `types/tools.ts:3-18` | abstract `slug`/`name`/`description`, `get schema()`, `validate(input)`, `build(...args): unknown`. No constructor, no `execute` member — `build` returns the AI SDK `tool({...})`. |
| `CurrentTimeTool` | `tools/current-time.tool.ts:18-59` | `build(organizationId)`; `execute` returns an **object** `{now, timezone, localTime}` |
| `StationContextTool` | `tools/station-context.tool.ts:140-338` | `build(stationId, organizationId)`; `execute` validates then returns a typed `StationContextResponse` object |

Neither is a pack: "system tool" is `alwaysAvailable: true` in `SYSTEM_TOOL_CAPABILITIES` (`tool-capabilities.ts:30-56`) plus direct instantiation in the always-available block (`tools.service.ts:462-479`). `station_context`'s capability is the template for a read-only one: `{pure: false, reads: ["entity_records"], writes: [], consumption: {mode:"none"}, computeShape: "scan", costHint: "free", locks: [], resultKind: "scalar", production: {kind:"value"}, alwaysAvailable: true}`. The `superRefine` rules (`tool-capability.model.ts:154-235`) matter: `pure` forbids any `reads`, and `writes` would demand `computeShape ∈ {map, mutate}` plus non-empty `locks`.

**Five independent hardcoded lists** must agree for a new always-available tool — `SYSTEM_TOOL_CAPABILITIES`, `BUILTIN_TOOL_NAMES` (`tools.service.ts:155-193`), `TOOL_PHASE_LABELS` (`tool-phase-labels.ts:33-90`), the `SYSTEM_TOOLS` set literal in `tools.service.test.ts:1043-1094`, and both `alwaysAvailableToolNames()` and `EXPECTED_COST_HINTS` in `tool-capabilities.test.ts`. Each is separately guarded.

### `buildAnalyticsTools`, in order

`tools.service.ts:384-793` — `(organizationId, stationId, userId, portalId?) => Promise<Record<string, Tool>>`:

1. load station (`:401-402`); load `stationToolpacks`, split builtin/custom (`:404-411`)
2. **throw `"Station must have at least one tool pack enabled"`** (`:412-414`)
3. tier policy + entitled custom packs (`:425-429`), `splitBuiltinPacks` → effective (`:434-437`), `AnalyticsService.loadStation` (`:444-447`)
4. **always-available system tools** (`:462-479`) — dynamically imports the registries and gates each on `alwaysAvailable`
5. the 8 pack blocks, then custom webhook packs (`:675-726`)
6. write gate (`:733-743`), then `wrapWithCostGate` (`:748-780`) over **every** tool, no exemption

Step 2 runs *before* step 4, which is a pre-existing bug this ticket has to fix: a station with no packs gets **no tools at all** today — not even `current_time` or `station_context` — because the throw fires first.

### Station facts already available, and the one that isn't

`buildStationContext` (`portal.service.ts:1091-1137`) returns `stationId`, `stationName`, `organizationTimezone`, `entities` (with columns), `entityGroups`, `effectiveToolPacks`, `unentitledToolPacks`, `customToolPacks`, optional `entityCapabilities`/`connectorInstances`. `loadConnectorInstanceContexts` (`:1139-1177`) returns `{id, name, display, slug}[]`. None returns record counts — but `EntityRecordsRepository.countByConnectorEntityIds` (`entity-records.repository.ts:76-86`) already does, as a single soft-delete-aware aggregate.

### Prompt and run path

`## Current time` (`system.prompt.ts:545-548`) is appended unconditionally — the precedent for a system-tool prompt block. `PACK_PROMPT_SECTIONS` (`:144`) is exhaustive over the 8 pack slugs only; system tools get bespoke unconditional prose. `streamResponse` (`portal.service.ts:671-711`) builds the prompt (`:686`), builds tools (`:688-693`), and calls `streamText` (`:697-704`). Nothing on any path parses message text, client or server.

## The design space

### Decision 1 — How the user reaches help

**A. A `/help` directive** typed in the composer, detected server-side, restricting the run's tool set to the help tool.
**B. Agent routing** — the tool is always available and the agent calls it when the question is about the platform.
**C. Both** — routed by default, `/help` as an override.

| | A — directive | B — routing | C — both |
|---|---|---|---|
| New input grammar for the user to learn | yes | **no** | yes (optional) |
| Follow-up questions work without repeating the trigger | **no** — per-turn detection means every turn needs `/help` | yes | partly |
| Consistent with "type a question, the agent routes it" | no — a second interaction model | yes | no |
| Guarantees the tool is called | yes (`toolChoice`) | no — same as every other tool | on directive turns |
| Fixes the no-packs station | as a side effect of the early return | needs the throw fixed directly | same |
| Pressure toward a command framework (epic: out of scope) | high — `/` implies `/`-anything | none | high |

The directive's apparent wins mostly dissolve on inspection. "`/help delete all my records` can't mutate" is circular — without the directive that's an ordinary request handled normally. The no-packs bypass is **orthogonal**: the throw is a bug for `current_time` and `station_context` too, and fixing it directly is strictly better than routing around it. What remains is determinism, which costs a grammar, a parser, a restricted-run path, placeholder copy to teach it, and a one-shot conversation model where the *second* question silently falls back to training — reintroducing the fabrication risk the fidelity decision exists to prevent.

**Lean: B.** The codebase already has a mechanism for "pick the right tool for this question," and nothing forces the model to call `correlate` either. A help tool is not special enough to justify a second way of talking to the session.

### Decision 2 — The tool's slug

**A. `assistant`** — the ticket's original name. **B. `assistant_help`.** **C. `platform_help`.**

**Lean: C.** With routing, the slug and description *are* the routing mechanism — they are what the agent reads to decide. `assistant` names the caller; `platform_help` names the subject, which is the distinction that keeps it from being reached for on a data question.

### Decision 3 — Fixing the no-packs throw

**A. Delete the throw**; a pack-less station builds the system-tool set and continues.
**B. Keep the throw, catch it upstream.**
**C. Keep the throw, exempt only help** (the directive-era design).

**Lean: A.** A session with `current_time`, `station_context`, and `platform_help` is more useful than an error, and it is exactly the session where a user needs orientation. B moves the bug rather than fixing it; C only exists to serve a directive that no longer exists. Worth stating as a behavior change: a pack-less station used to fail the whole session and now won't.

### Decision 4 — What the tool returns

Confirmed on the ticket: **the tool composes the answer, the agent relays it.**

**A. `{answer: string, links: {label,url}[]}`.** **B. A bare string.** **C. Structured findings for the model to assemble** — rejected by the ticket.

**Lean: A.** Matches how both existing system tools return objects, keeps the links machine-checkable in tests, and gives the prompt section something specific to instruct.

### Decision 5 — How the tool selects material

**A. Substring filtering** via the shipped `filterGlossary` / `filterFAQ`.
**B. A curated situation map** keyed on station findings.
**C. Both — situation map first, filtering as the general fallback.**

**Lean: C.** A alone can't satisfy "names that specific condition" — substring matching over static content knows nothing about *this* station. B alone answers only anticipated questions.

### Decision 6 — How the agent learns when to call it

With routing, the description carries the whole load.

**A. Description only.** **B. Description + an unconditional `## Help` prompt section.** **C. Prompt only.**

**Lean: B.** The description is what the model sees in the tool list; the prompt section is where the relay-verbatim instruction lives, and where the boundary against data questions can be stated once in prose. C is not an option — a tool with a vague description gets called wrongly regardless of prose elsewhere.

## Tradeoff comparison

|  | D1 routing | D2 `platform_help` | D3 delete throw | D4 `{answer, links}` | D5 map + filter | D6 both |
|---|---|---|---|---|---|---|
| Touches `packages/core` | yes (registry) | yes | no | no | reads content | no |
| Changes existing behavior | no | no | **yes** — pack-less stations | no | no | no |
| Spread to spec | yes | yes | yes | yes | yes | yes |
| Reversible | yes | yes | yes | yes | yes | yes |

## Recommendation

1. **No trigger syntax.** `platform_help` is a third always-available system tool, constructed in the same block as `current_time` and `station_context`; the agent routes to it. No parser, no restricted run, no `toolChoice`, no composer copy.
2. Name it **`platform_help`** — with routing, the name is part of the mechanism.
3. **Delete the no-packs throw**; a pack-less station builds the system-tool set. Fixes a pre-existing bug that also hides `current_time` and `station_context`.
4. Capability mirrors `station_context`: `pure: false`, `reads: ["entity_records"]`, `writes: []`, `computeShape: "scan"`, `costHint: "free"`, `resultKind: "scalar"`, `production: {kind: "value"}`, `alwaysAvailable: true` — registered in all five hardcoded lists in one commit.
5. `execute` returns `{answer, links}`; the tool composes `answer` from a situation map with `filterGlossary`/`filterFAQ` as fallback, and builds Help URLs from the #365 grammar.
6. Record presence comes from the existing `countByConnectorEntityIds` — one bounded aggregate, org-scoped.
7. A `## Help` section in `system.prompt.ts` on the `## Current time` pattern: when to reach for the tool, and to relay its `answer` as written.
8. The description explicitly says this is not a data-query tool, so a question about *data* keeps routing to a data tool.

## Open questions

1. **Will the agent actually route correctly?** This is the risk routing takes on that the directive didn't. **Lean: make it a test, not a hope** — assert routing behavior on representative prompts ("why are my answers empty?" → help; "how many orders are empty?" → data query). If routing proves unreliable in the smoke walkthrough, the fallback is a description rewrite, not a new grammar.
2. **Does the tool need the user's question as input at all**, given the model chooses what to pass? **Lean: yes, an optional `question` string** — it drives content selection, and the model passing it verbatim is the normal contract for tool inputs.
3. **Should the tool also be reachable when the agent is mid-analysis** and shouldn't be distracted? It can be called any turn by construction. **Lean: accept it.** A wrongly-called free read-only tool costs one step out of `stepCountIs(10)`; the alternative is a gate that recreates the directive.
4. **What happens if content import or the station read fails?** **Lean: fail soft.** The tool returns its orientation answer with a note that station details were unavailable; `execute` never throws into the stream.
5. **Does deleting the no-packs throw break anything downstream** that assumes a non-empty pack list? **Lean: verify, don't assume** — the prompt's `effectiveSections` already filters on `effectiveToolPacks` and tolerates empty, but the spec should name the check.
6. **Does the composer placeholder change at all?** **Lean: no.** With no syntax to teach, the current placeholder is already correct, and adding "ask me how this works" is copy for a capability the agent should demonstrate by working.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because the tool is read-only and holds no locks (`locks: []`); nothing it does is a check-then-act.
- **Accuracy & auditability** — the dimension that shaped the design. **Lean: the tool composes, the agent relays.** A confidently wrong statement about the product is worse than no answer. Every claim in the composed prose must trace to shipped content or to a fact just read from this station.
- **Failure modes** — **Lean: fail soft, never fail closed.** A degraded answer beats an error in the one surface a stuck user reaches for. The no-packs fix is the same principle applied to the session as a whole.
- **Scale & unbounded growth** — **Lean: bound both inputs.** Selection sends a handful of entries, never the corpus; record presence is an aggregate, never a row scan.
- **Multi-tenancy** — **Lean: org-scope every station read**, exactly as `station_context` does. Help content is identical for every tenant, so the introspection half is the only cross-tenant risk.
- **Contract stability** — **Lean: the tool is a system tool, permanently outside pack entitlements.** That is the whole reason the epic rejected the pack route: a tier's `builtinToolpacks` allowlist can never remove platform help. Dropping the directive also removes a would-be contract (a directive parameter on `buildAnalyticsTools`) that would have needed maintaining for one caller.
- **Data lifecycle** — N/A because nothing is persisted; the question and answer ride the ordinary message path.

## What this doesn't decide

- Whether a directive syntax should ever exist. Dropped here on its merits; a future feature that genuinely needs determinism (not help) can revisit it, and would be the second caller that justifies a registry.
- Client-side autocomplete or a command palette — moot without a syntax.
- Session-run diagnostics — reading this conversation's prior failed tool calls. Deliberately excluded on the ticket; station introspection is the chosen depth.
- Any write path. The tool is read-only and its capability declares it, so the write gate never applies.
- Whether the portal chat lock should behave differently for help questions — an adjacent feature, unchanged here.
- The two stale-doc items the epic recorded (`CLAUDE.md:242`'s nonexistent `CostGateService.resolveCostGate`; `ALL_TOOL_PACKS` at `tools.service.ts:151-161`) — fold in only if this branch's edits touch them.

## Next step

`docs/ASSISTANT_HELP_TOOL.spec.md` pins the contract: the capability entry, the `platform_help` class with its input/output schemas and description text, the situation map's recognized conditions and their composed answers, the record-presence call, the no-packs fix and what a pack-less station returns, the `## Help` prompt block, and the Help-URL builder shared with #365's grammar. Then `.plan.md` slices it — roughly: (1) capability + the five registry lists; (2) the Help-URL builder in core; (3) the tool with selection, composition, and fail-soft; (4) registration in the always-available block plus the no-packs fix; (5) the prompt section and the routing assertions. Slice 4 is where a pack-less station starts working, and slice 5 is where routing becomes checkable.
