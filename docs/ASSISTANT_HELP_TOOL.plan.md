# In-session help tool — Plan

**TDD-sequenced implementation of `platform_help`: the capability across five registry lists, the shared Help-URL builder, the tool that composes its own answer, the registration that makes it always available, and the deletion of the throw that leaves a pack-less station with no tools at all.**

Spec: `docs/ASSISTANT_HELP_TOOL.spec.md`. Discovery: `docs/ASSISTANT_HELP_TOOL.discovery.md`. Issue: #367 (epic #364). Builds on **both siblings, already merged into `epic/portal-guidance`**: #366 supplies the glossary/FAQ material the tool quotes, #365 the URL grammar it emits.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/assistant-help-tool`**, PR base `epic/portal-guidance` — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — declare the tool before building it, build it before wiring it, and put the behavior change last:

- **Slice 1** — the capability and the five lists that must agree. Declares `platform_help` without constructing it, which is legal: the registry guard asserts every *built* tool is named, not that every name is built.
- **Slice 2** — `buildHelpUrl` in core. Independent of everything else; the tool needs it.
- **Slice 3** — the tool itself, unit-tested against stubbed station reads. Nothing constructs it yet.
- **Slice 4** — registration in the always-available block **and** the no-packs throw deletion. The only user-visible slice, and the only behavior change.
- **Slice 5** — the `## Help` prompt section and the routing-input pins.

No migration, no seed, no `apps/web` change.

---

## Slice 1 — Capability, phase label, and the five lists

`platform_help` becomes a declared system tool. Nothing constructs it yet, so no session behavior changes.

**Files**

- Edit: `packages/core/src/registries/tool-capabilities.ts` — the `SYSTEM_TOOL_CAPABILITIES` entry.
- Edit: `packages/core/src/registries/tool-phase-labels.ts` — `platform_help: "Looking up help"`.
- Edit: `apps/api/src/services/tools.service.ts` — `BUILTIN_TOOL_NAMES` gains the slug.
- Edit: `packages/core/src/__tests__/registries/tool-capabilities.test.ts` — `alwaysAvailableToolNames()` expectation + `EXPECTED_COST_HINTS`.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — the `SYSTEM_TOOLS` set literal (`:1043-1094`).

**Steps**

1. **Tests (spec cases 1–5).** The capability parses against `ToolCapabilitySchema` (`pure: false` with `reads` is legal; `pure: true` with reads is not); `alwaysAvailableToolNames()` is exactly `["current_time", "station_context", "platform_help"]`; `EXPECTED_COST_HINTS.platform_help === "free"` and its key set still equals the registry's; `TOOL_PHASE_LABELS`' key set still equals `ALL_TOOL_CAPABILITIES`; the tool is neither `isCostGated` nor `isWriteGated`. Run; fail.
2. **Implement** the capability entry and the phase label, then update the three list literals. Green.
3. Run the **whole** `packages/core` and `apps/api` suites — the five lists are cross-checked by guards in both packages, and this slice is exactly where a missed one surfaces.
4. Lint + type-check + `format:check`.

**Done when:** cases 1–5 and the existing registry-consistency guard (`:1043-1094`) pass, with `platform_help` declared and nothing building it.

**Risk:** the five lists are the whole slice. A name in `BUILTIN_TOOL_NAMES` that isn't yet constructed is fine — the guard asserts every *built* tool is named and that `BUILTIN_TOOL_NAMES === descriptorNames ∪ SYSTEM_TOOLS`, both of which hold. If a guard demands the reverse, reorder this slice after slice 4 rather than building the tool early.

---

## Slice 2 — `buildHelpUrl` in `@portalai/core/content`

The Help URL grammar #365 froze becomes callable from `apps/api`, which cannot import `apps/web`'s `HelpTab`.

**Files**

- Edit/new: `packages/core/src/content/` — `HELP_TAB` + `buildHelpUrl`, exported from the content barrel. The module stays import-free (the purity guard covers it).
- Edit/new: `packages/core/src/__tests__/content/` — cases 6–8.

**Steps**

1. **Tests (spec cases 6–8).** `{tab: "faq", category: "analytics"}` → `/help?tab=faq&category=analytics`; `{}` → `/help`; a `category` with no `tab` is dropped (matching `normalizeHelpSearch`'s rule); `{tab: "glossary", entry: {surface: "glossary", slug: "portal"}}` → `/help?tab=glossary#glossary-entry-portal`. Run; fail.
2. **Implement** `HELP_TAB` and `buildHelpUrl`. Green.
3. Confirm the content-purity guard still passes (no imports added to the module).
4. Lint + type-check.

**Done when:** cases 6–8 pass and the emitted grammar matches what `/help`'s `validateSearch` accepts. Nothing calls it yet.

**Risk:** low. The one thing to get right is the drop-category-without-tab rule, which mirrors the web-side sanitizer — case 7 pins it.

---

## Slice 3 — The tool: findings, situation map, composition

The largest slice. `PlatformHelpTool` composes its own answer; nothing constructs it in a session yet.

**Files**

- New: `apps/api/src/tools/platform-help.tool.ts` — the class, its description (the routing contract, pinned verbatim in the spec), the situation map, content selection, and fail-soft.
- New: `apps/api/src/__tests__/tools/platform-help.tool.test.ts` — cases 9–18.

**Steps**

1. **Tests (spec cases 9–18).** With station reads stubbed: a bare call returns the default orientation answer with at least one link; entities-but-zero-records **names that condition**; zero entities returns the connect-a-source answer; no packs returns the packs answer; `unentitledToolPacks` says the plan excludes them; a `question` matching FAQ content quotes that entry and links to it; selection caps at 3 FAQ + 3 glossary; a throwing station read still **resolves** with the default answer plus the unavailable note; every `links[].url` starts with `/help`; `execute` uses the count aggregate and never a row fetch. Run; fail.
2. **Implement** the tool: gather findings (entities, packs, and `countByConnectorEntityIds` for record presence), match the situation map in the spec's stated order, select content via `filterFAQ`/`filterGlossary`, compose `answer`, build `links` with `buildHelpUrl` (slice 2). Wrap step 1's reads in the fail-soft try/catch.
3. Lint + type-check.

**Done when:** cases 9–18 pass; the tool is exercised only by its own test, and no session builds it.

**Risk:** two. **(a)** The spec pins the description verbatim because under agent routing the description *is* the mechanism — lift it, don't improvise. **(b)** `EntitySchema.id` is assumed to be the connector-entity id `countByConnectorEntityIds` expects; verify against `analytics.service.ts:57-63` while writing the findings step, and if it isn't, the fix is local to this slice.

---

## Slice 4 — Register it, and delete the no-packs throw

The user-visible slice: the tool joins every session, and a pack-less station stops failing.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — the third always-available block (`:462-479`); delete the throw at `:412-414`.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — cases 19–24.

**Steps**

1. **Tests (spec cases 19–24).** `platform_help` is present for an ordinary station alongside `current_time` and `station_context`; **a station with no packs enabled builds and returns exactly the three system tools** instead of throwing; a station whose every configured pack is unentitled still builds (existing behavior, re-pinned beside the new case so the two stay equivalent); `platform_help.execute` is cost-gate wrapped; the registry-consistency guard passes; **a denied cost gate does not deny `platform_help`** — `free` short-circuits. Run; the no-packs case fails with the throw, the presence cases fail on absence.
2. **Implement** — add the registration block, then delete the throw. Nothing replaces it: execution falls through tier resolution, `splitBuiltinPacks` (empty in, empty out), an empty `enabledPacks`, the always-available block, and the cost-gate wrap.
3. Run the whole `apps/api` suite — this is where an unstated assumption about non-empty packs would surface.
4. Lint + type-check.

**Done when:** cases 19–24 pass; a pack-less station opens a working session with three tools.

**Risk:** the behavior change. A station with no packs used to fail the whole session and now won't. The code already treats "system tools only" as legitimate (`tools.service.ts:421-423` says so for the all-unentitled case), and case 21 pins the two paths as equivalent — but step 3's full run is the real check, and the PR body must state the change.

---

## Slice 5 — The prompt section and the routing pins

What teaches the agent when to reach for the tool, plus the assertions on the inputs we control.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — the unconditional `## Help` block, on the `## Current time` pattern (`:545-548`).
- Edit: `apps/api/src/__tests__/prompts/` and `__tests__/services/portal.service.test.ts` — cases 25–28.

**Steps**

1. **Tests (spec cases 25–28).** `buildSystemPrompt` contains the `## Help` section unconditionally, including for a station with no packs; the section names **both** directions (product questions → `platform_help`, data questions → the data tools); `streamText` receives a tool set containing `platform_help` on an ordinary run (extends the existing assertion at `portal.service.test.ts:1460`); the tool `description` contains the "not a data-query tool" clause and names the product-question cases. Run; fail.
2. **Implement** the prompt block. Green.
3. Lint + type-check + `format:check`; full `packages/core` and `apps/api` suites.

**Done when:** cases 25–28 pass and the agent has both signals — the description in its tool list and the prompt's two directions.

**Risk:** these pin *inputs*, not model behavior. Whether the agent actually routes correctly is a smoke item, and the recorded fallback is to rewrite the description — never to add a trigger syntax (the premise this ticket was amended to drop).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests | User-visible |
|---|---|---|---|---|
| 1 | Capability + phase label + the five lists | 1–5 | core + api unit | no |
| 2 | `buildHelpUrl` in core | 6–8 | core unit | no |
| 3 | `PlatformHelpTool` — findings, situations, composition, fail-soft | 9–18 | api unit | no |
| 4 | Registration + **no-packs throw deleted** | 19–24 | api unit | **yes** |
| 5 | `## Help` prompt section + routing pins | 25–28 | api unit | **yes** |

Total ≈ **28 cases**, no migration, no `apps/web` change.

---

## Cross-slice notes

- **The description is pinned copy, not a draft.** Under agent routing it is the routing mechanism, so slice 3 lifts it verbatim from the spec's *Surface*. If it reads wrong while writing, amend the spec in the same commit rather than diverging.
- **Slice 1 declares without constructing, and that is deliberate.** It keeps the registry guards satisfiable in one commit while the tool doesn't exist yet. If any guard turns out to require the reverse direction, reorder rather than pulling slice 3 forward.
- **The behavior change is slice 4 alone.** Everything before it is inert; everything after it is prose. That is the commit to read carefully in review and to name in the PR body.
- **`@portalai/core` needs a rebuild before any `apps/api` run** (`npm run build --workspace=packages/core`) — the API resolves core through `dist/`, so slices 1 and 2 are invisible to slice 3's tests otherwise.
- **Doc-sync (CLAUDE.md → Keeping Documentation in Sync):** two of the three tool surfaces move here — the tool's `description` (slice 3) and the `system.prompt.ts` section (slice 5). The third, `builtin-toolpacks.ts`, is **deliberately untouched** because system tools have no pack mirror; slice 3 carries an in-code note saying so, rather than leaving a reader to wonder whether it was forgotten.
- **No `apps/web` edits at all.** The amended premise dropped the composer placeholder; if a web file needs touching, something has drifted back toward the directive design.
- **Epic hygiene:** PR base is `epic/portal-guidance`; merge `main` into the epic branch before this child merges (keep-pace). This is the **last child** — after it merges, the epic close-out PR to `main` carries `Closes #364` plus all three children.

---

## Next step

Implementation begins on this branch — slice 1 first, tests before code — once discovery, spec, and plan are reviewed and confirmed. Before writing slice 3, re-read the spec's *Surface*: the description text and the situation-map table there are the contract, not suggestions.
