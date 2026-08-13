# In-session help tool — Spec

**Issue:** [EnterpriseBT/portal-ai#367](https://github.com/EnterpriseBT/portal-ai/issues/367) · **Epic:** [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · **Discovery:** `docs/ASSISTANT_HELP_TOOL.discovery.md` · branch `feat/assistant-help-tool` → base `epic/portal-guidance`

This spec pins the `platform_help` system tool — its capability, its composed-answer contract, the situation map it answers from — plus the registration that makes it always available and the deletion of the no-packs throw that currently leaves a pack-less station with no tools at all.

> Written against the **amended premise**: there is no `/help` directive, no parser, no restricted run, and no `toolChoice`. The agent routes to this tool the way it routes to any other, so the slug, the description, and the prompt section are the mechanism.

## Key decisions (flag for review)

Discovery decisions D1–D6 and open questions Q1–Q6 are ratified as their leans:

- **D1 — agent routing, no trigger syntax.** The tool is constructed for every session; the agent calls it when the question is about the product.
- **D2 — `platform_help`.** With routing, the name is part of the mechanism: it names the subject, not the caller.
- **D3 — delete the no-packs throw** (`tools.service.ts:412-414`). **The codebase already treats "system tools only" as a legitimate session**: the comment at `:421-423` states that a station whose every configured pack is unentitled "legitimately builds a session with system tools only". The throw only catches the *zero-configured* case, which is the same session with a different cause. Deleting it extends an existing supported state rather than inventing one — and it answers discovery Q5 (nothing downstream assumes a non-empty pack list; the unentitled path already exercises the empty case).
- **D4 — `execute` returns `{answer, links}`**; the tool composes, the agent relays (confirmed on the ticket).
- **D5 — situation map first, `filterGlossary`/`filterFAQ` as fallback.**
- **D6 — description *and* an unconditional `## Help` prompt section.**
- **Q1 — routing is proven by test**, on representative prompt pairs, not assumed. **Q2 — optional `question` input.** **Q3 — a wrongly-called free read-only tool is accepted** rather than gated. **Q4 — fail soft.** **Q6 — the composer placeholder does not change.**
- **New surface, as in the prior draft: `buildHelpUrl` in `@portalai/core/content`.** #365's URL grammar lives in `apps/web/src/utils/routes.util.ts`, which `apps/api` cannot import. The tab slugs and builder move into the same import-free core module that already owns `contentEntrySlug`, rather than hardcoding a second copy of a frozen grammar in the API.
- **Enterprise leans carried forward:** fail-soft (never throw into the stream), org-scoped introspection, bounded selection, and permanent immunity from tier entitlements by being a system tool rather than a pack.

## Scope

### In scope

1. `platform_help` capability + phase label in `@portalai/core/registries`.
2. `buildHelpUrl` + `HELP_TAB` in `@portalai/core/content`.
3. `apps/api/src/tools/platform-help.tool.ts` — the tool, its situation map, and answer composition.
4. Registration in the always-available block; `BUILTIN_TOOL_NAMES`; the three test-side lists.
5. Deletion of the no-packs throw.
6. A `## Help` section in `system.prompt.ts`.

### Out of scope

- Any directive/slash syntax, parser, restricted tool set, or `toolChoice`. Client-side anything, including the composer placeholder. Session-run diagnostics. Any write path. A `builtin-toolpacks.ts` descriptor (system tools have none; the registry guard asserts it).

## Surface

### `packages/core/src/registries/tool-capabilities.ts`

Added to `SYSTEM_TOOL_CAPABILITIES` (`:30-56`), mirroring `station_context` — it reads station data, so `pure: false` (the `superRefine` at `tool-capability.model.ts:154+` forbids `pure` with reads):

```ts
platform_help: {
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "none" },
  computeShape: "scan",
  costHint: "free",
  locks: [],
  resultKind: "scalar",
  production: { kind: "value" },
  alwaysAvailable: true,
},
```

`costHint: "free"` is load-bearing — free is immune to the cost gate (never charged, never denied, never rate-limited, even under an exhausted quota). Being a system tool rather than a pack slug is what keeps it outside every tier's `builtinToolpacks` allowlist.

### `packages/core/src/registries/tool-phase-labels.ts`

```ts
platform_help: "Looking up help",
```

### `packages/core/src/content/` — the Help URL builder (new)

Beside `contentEntrySlug`; the module stays import-free.

```ts
export const HELP_TAB = {
  gettingStarted: "getting-started",
  glossary: "glossary",
  faq: "faq",
} as const;
export type HelpTabSlug = (typeof HELP_TAB)[keyof typeof HELP_TAB];

/** Build an addressable Help URL (#365 grammar). */
export function buildHelpUrl(opts: {
  tab?: HelpTabSlug;
  category?: string;
  entry?: { surface: "glossary" | "faq"; slug: string };
}): string;
```

Output: `/help`, `/help?tab=faq&category=analytics`, `/help?tab=glossary#glossary-entry-portal`. A `category` with no `tab` is dropped (matching `normalizeHelpSearch`'s rule); `entry` appends `#<surface>-entry-<slug>`.

### `apps/api/src/tools/platform-help.tool.ts` (new)

Follows `current-time.tool.ts:18-59`: `slug`/`name`/`description`, `get schema()`, `build(...)` returning the AI SDK `tool({...})`.

```ts
const InputSchema = z.object({
  question: z.string().max(500).optional()
    .describe("The user's question about the product, verbatim. Omit for a general orientation answer."),
});

export class PlatformHelpTool extends Tool<typeof InputSchema> {
  slug = "platform_help";
  name = "Platform Help";
  description = /* see below — this is the routing mechanism */;
  get schema() { return InputSchema; }
  build(stationId: string, organizationId: string): /* ai.tool */;
}
```

**The description is the routing contract** (D2/D6). It must state what the tool knows and, explicitly, what it is not:

> Answer a question about **Portals AI itself** — what portals, stations, connectors, entities, tool packs, or pinned results are; how to get better answers; and why this station may be returning thin or empty results. Also reports this station's own setup (connected sources, whether records have been imported, which packs are enabled or excluded by the plan). Use this whenever the user asks how the product works, what they can do here, or why something isn't working. **This is not a data-query tool** — it never reads the user's records to answer a question about their data; for that, use the data tools.

`execute` returns:

```ts
{
  answer: string;                            // final prose, relayed verbatim
  links: { label: string; url: string }[];   // built via buildHelpUrl
}
```

**Composition order** — the tool decides all of it:

1. **Station findings** (org-scoped): entities and packs via the existing station load; record presence via `EntityRecordsRepository.countByConnectorEntityIds(entityIds)` (`entity-records.repository.ts:76-86`), one soft-delete-aware aggregate.
2. **Situation match**, first hit wins:

   | Situation | Condition | The answer leads with |
   |---|---|---|
   | `no_packs` | no builtin and no custom packs enabled | what tool packs are, and that this station has none attached |
   | `no_entities` | zero entities on the station | connect a source first; there is nothing to query yet |
   | `no_records` | entities exist, `count === 0` | **names the condition** — the entities exist but no records have been imported; run a sync |
   | `unentitled_packs` | `unentitledToolPacks` non-empty | those packs are excluded by the plan, not missing from the product |
   | `default` | none of the above | orientation: what a portal can do, how to phrase questions |

3. **Content selection** — `filterFAQ` / `filterGlossary` over `question` when present, capped at **3 FAQ + 3 glossary** entries; their text is quoted, never summarized.
4. **Links** — `buildHelpUrl` per selected entry, always including `/help?tab=faq&category=analytics` for portal questions.

**Fail-soft (Q4):** any failure in step 1 is caught and logged; the tool returns the `default` answer plus a sentence noting station details were unavailable. `execute` never throws.

### `apps/api/src/services/tools.service.ts`

**Registration** — a third block alongside the existing two (`:462-479`), same shape:

```ts
if (SYSTEM_TOOL_CAPABILITIES.platform_help?.alwaysAvailable) {
  tools.platform_help = new PlatformHelpTool().build(stationId, organizationId);
}
```

`BUILTIN_TOOL_NAMES` (`:155-193`) gains `"platform_help"`. The signature of `buildAnalyticsTools` is **unchanged** — no directive parameter, which is the main simplification the amended premise buys.

**The no-packs fix** — delete the throw at `:412-414`:

```ts
if (builtinSlugs.length === 0 && customPackIds.length === 0) {
  throw new Error("Station must have at least one tool pack enabled");
}
```

Nothing replaces it. Execution continues into tier resolution, `splitBuiltinPacks` (which returns an empty `effective` for an empty input), an empty `enabledPacks`, the always-available block, and the cost-gate wrap. The result is a session with exactly the three system tools — **the same session shape the code already produces when every configured pack is unentitled** (`:421-423`).

Behavior change, stated: a station with no packs configured used to fail the whole session with `"Station must have at least one tool pack enabled"`; it now opens with system tools only.

### `apps/api/src/prompts/system.prompt.ts`

An unconditional `## Help` block on the `## Current time` pattern (`:545-548`), in the same array:

> Questions about **the product** — what a portal, station, connector, or tool pack is, how to ask better questions, or why this station is returning thin or empty answers — go to the `platform_help` tool. Questions about **the data in this station** go to the data tools.
>
> When `platform_help` returns, relay its `answer` essentially as written and include its `links`. Do not rewrite it, summarize it, or add claims about how the product behaves — the tool's text is authoritative and yours is not.

No `PACK_PROMPT_SECTIONS` entry: that record is exhaustive over the 8 **pack** slugs, and system tools are not packs.

### The five lists that must agree

| List | Location |
|---|---|
| `SYSTEM_TOOL_CAPABILITIES` | `packages/core/src/registries/tool-capabilities.ts:30-56` |
| `TOOL_PHASE_LABELS` | `packages/core/src/registries/tool-phase-labels.ts:33-90` |
| `BUILTIN_TOOL_NAMES` | `apps/api/src/services/tools.service.ts:155-193` |
| `SYSTEM_TOOLS` set literal | `apps/api/src/__tests__/services/tools.service.test.ts:1043-1094` |
| `alwaysAvailableToolNames()` + `EXPECTED_COST_HINTS` | `packages/core/src/__tests__/registries/tool-capabilities.test.ts` |

## Migration / Seed

None — no DB schema change, no seed, no migration. The tool reads through an existing repository method.

## TDD test plan

`cd packages/core && npm run test:unit`; `cd apps/api && npm run test:unit`. Never raw jest.

### Layer 1 — core registries (`packages/core/src/__tests__/registries/`)

1. `SYSTEM_TOOL_CAPABILITIES.platform_help` parses against `ToolCapabilitySchema`.
2. `alwaysAvailableToolNames()` is exactly `["current_time", "station_context", "platform_help"]`.
3. `EXPECTED_COST_HINTS.platform_help === "free"`, key set still equals the registry's.
4. `TOOL_PHASE_LABELS` key set still equals `ALL_TOOL_CAPABILITIES`.
5. `platform_help` is neither `isCostGated` nor `isWriteGated`.

### Layer 2 — `buildHelpUrl` (`packages/core/src/__tests__/content/`)

6. `{tab: "faq", category: "analytics"}` → `/help?tab=faq&category=analytics`.
7. `{}` → `/help`; a `category` with no `tab` drops the category.
8. `{tab: "glossary", entry: {surface: "glossary", slug: "portal"}}` → `/help?tab=glossary#glossary-entry-portal`.

### Layer 3 — the tool (`apps/api/src/__tests__/tools/platform-help.tool.test.ts`)

9. A bare call on a healthy station returns the `default` orientation answer, non-empty, with at least one link.
10. **Entities but zero records → the answer names that condition** (`/no records|nothing imported|hasn't been imported/i`) — the flagship case.
11. Zero entities → the connect-a-source answer.
12. No packs enabled → the packs answer.
13. `unentitledToolPacks` non-empty → says the plan excludes them, not that they're missing.
14. A `question` matching FAQ content quotes that entry's text and links to it.
15. Selection is capped at 3 FAQ + 3 glossary entries for a broad query.
16. **Fail-soft:** when the station read throws, `execute` resolves with the default answer plus the unavailable note — it does not reject.
17. Every `links[].url` starts with `/help` and matches the #365 grammar.
18. `execute` never reads entity *rows* — only the count aggregate (spy asserts no row-fetch path).

### Layer 4 — construction + the no-packs fix (`apps/api/src/__tests__/services/tools.service.test.ts`)

19. `platform_help` is present in the tool set for an ordinary station, alongside `current_time` and `station_context`.
20. **A station with no packs enabled builds successfully** and returns exactly the three system tools — no throw.
21. A station whose every configured pack is unentitled still builds (existing behavior, re-pinned beside the new case so the two stay equivalent).
22. `platform_help.execute` is cost-gate wrapped (the existing guard at `:724` now covers it).
23. Registry consistency (`:1043-1094`) passes with `SYSTEM_TOOLS` extended and no `builtin-toolpacks.ts` descriptor.
24. A **denied** cost gate does not deny `platform_help` — `free` short-circuits (asserts the free-immunity rule end to end).

### Layer 5 — the prompt and routing (`apps/api/src/__tests__/prompts/`, `__tests__/services/portal.service.test.ts`)

25. `buildSystemPrompt` contains the `## Help` section unconditionally, including for a station with no packs.
26. The section names both directions — product questions to `platform_help`, data questions to the data tools.
27. `streamText` receives a tool set containing `platform_help` on an ordinary run (extends the existing assertion at `portal.service.test.ts:1460`).
28. **Routing pins (Q1):** the tool `description` contains the disambiguating "not a data-query tool" clause and names the product-question cases. This is a description-content assertion, not a model-behavior assertion — see the note below.

> **On testing routing.** Whether the model *actually* routes correctly is not unit-testable — it depends on the model. Case 28 pins the input we control (the description and prompt text). Real routing behavior is a **smoke-walkthrough** item, and the recorded fallback if it misroutes is to rewrite the description, not to add a trigger syntax.

**Totals:** ~5 core registry, ~3 core content, ~10 tool, ~6 construction, ~4 prompt/routing ≈ **28 cases**.

## Acceptance criteria

- [ ] All cases pass; `packages/core` and `apps/api` suites green; `lint`, `type-check`, `format:check` clean.
- [ ] Asking "what can I do here?" or "why are my answers empty?" in a portal session returns platform guidance sourced from the tool.
- [ ] Asking "why are my answers empty" on a station with no imported records returns an answer naming that condition.
- [ ] A follow-up question in the same session is answered the same way — no trigger to repeat.
- [ ] A data question still routes to a data tool.
- [ ] The tool is never charged and never denied; it answers under an exhausted quota and an active rate limit.
- [ ] No tier's `builtinToolpacks` allowlist can remove it.
- [ ] **A portal session on a station with no tool packs enabled works**, with the three system tools available, instead of failing.
- [ ] Help links land on the right tab and category, not the Getting Started default.
- [ ] The cost-gate wrap guard, registry-consistency guard, and `no-open-coded-sink` guard all pass with the new tool present.
- [ ] `buildAnalyticsTools`'s signature is unchanged, and no file parses message text.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| **The agent doesn't route to it** — asks the user to go read Help, or answers from training. | The design's central risk, and the reason the ticket dropped determinism. Mitigated by an explicit description (case 28) and the two-directional prompt section (case 26); detected in the smoke walkthrough. Fallback is a description rewrite. |
| The agent over-routes — calls it for data questions. | The "not a data-query tool" clause plus the prompt's second direction. Cost of a false positive is one free step out of `stepCountIs(10)`; smoke checks a data prompt still hits a data tool. |
| Deleting the throw exposes a downstream assumption of non-empty packs. | The unentitled path already produces the same empty-pack session (`:421-423`), and case 21 pins the two as equivalent. Case 20 proves the new path end to end. |
| The tool leaks another org's data. | Every read is org-scoped exactly as `station_context` is; the count is scoped by the station's own entity ids. |
| A station read failure turns help into an error. | **Fail soft** (case 16). Failing closed would break the one surface a stuck user reaches for. |
| The five hardcoded lists drift. | They move in one commit; cases 1–5 and 23 assert each independently. |
| `buildHelpUrl` and `apps/web`'s `HelpTab` drift. | Cases 6–8 pin the emitted grammar; the web route's `normalizeHelpSearch` reads it and fails open regardless. |
| A pack-less station now opens a session that previously errored — someone was relying on the error. | Unlikely (it presents as a broken session, not a feature), and the epic is the deployment gate. Stated as a behavior change in the PR body. |

**Rollback:** `git revert`. No migration, no persisted state. Reverting restores the throw and removes the tool; nothing else consumes either.

## Files touched

**`packages/core`** — edit `src/registries/tool-capabilities.ts`, `src/registries/tool-phase-labels.ts`, `src/content/` (the URL builder + barrel); tests under `src/__tests__/registries/` and `src/__tests__/content/`.

**`apps/api`** — new `src/tools/platform-help.tool.ts` + its test; edit `src/services/tools.service.ts` (registration, `BUILTIN_TOOL_NAMES`, throw deletion), `src/prompts/system.prompt.ts`, and the tests `__tests__/services/tools.service.test.ts`, `__tests__/services/portal.service.test.ts`, `__tests__/prompts/`.

**`apps/web`** — none.

**Doc-sync (CLAUDE.md → Keeping Documentation in Sync):** the tool's `description` and the `## Help` prompt section are two of the three tool surfaces; the third — `builtin-toolpacks.ts` — is **deliberately untouched** because system tools have no pack mirror, and that gets an explicit in-code note rather than silence.

## Next step

`docs/ASSISTANT_HELP_TOOL.plan.md` — five TDD slices: (1) capability + phase label + the five lists, red until every guard agrees; (2) `buildHelpUrl` in core; (3) the tool itself — situation map, selection, composition, fail-soft; (4) registration in the always-available block **and** the no-packs throw deletion, where a pack-less session starts working; (5) the `## Help` prompt section plus the routing-input pins. Slices 1–3 land nothing user-visible; slice 4 is the behavior change.
