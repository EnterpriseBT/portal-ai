# Platform help as a tool pack — Plan

**This plan turns `platform_help` into the built-in `help` pack, makes every tier entitled to it, and moves the station diagnostics and organization context into `station_context`. Each slice is test-first.**

Spec: `docs/PLATFORM_HELP_PACK.spec.md`. Discovery: `docs/PLATFORM_HELP_PACK.discovery.md`. Issue: #1050. #1044 (the Help station) and #1049 (help retrieval) build on it.

The work is five slices. Each one has a green test suite and leaves the repo compilable. They land as **commits on `feat/1050-platform-help-pack` / PR #1090**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, focused with `--testPathPattern` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit -- --testPathPattern 'registries|content'
cd apps/api && npm run test:unit -- --testPathPattern '<pattern>'
cd apps/api && npm run test:integration -- --testPathPattern station-context
```

Each slice goes through five steps:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` at the boundary. Slice 1 also runs the root `npm run build`, because a core registry change ripples into web types.
5. Move to the next slice.

Sequencing rationale: the registry and entitlement land before anything relies on them, and **sessions keep `platform_help` until slice 4**, so behaviour only changes in one commit.

- **Slice 1:** the core `help` pack and its guards. The new slug forces `Record<BuiltinToolpackSlug, …>` entries in the API's prompt maps, so placeholder entries land here. The `## Help` text stays where it is.
- **Slice 2:** the `tierPolicyFromRow` union, so the pack is entitled on custom tiers before any session can depend on it.
- **Slice 3:** extract `StationDiagnosticsService` (no behaviour change), then grow `station_context`. Being additive, it's safe while `platform_help` is still a system tool.
- **Slice 4:** the switch. `platform_help` is built only with the pack, `## Help` becomes the pack's section, and Station Scope gains its lines. This is the only behaviour-changing slice, and it unblocks #1044.
- **Slice 5:** web icon, content, docs and the #1044 amendment.

---

## Slice 1 — The `help` pack in core

The registry knows the pack and every catalog tier lists it, but sessions are unchanged.

**Files**

- Edit:
  - `packages/core/src/registries/builtin-toolpacks.ts`: slug, `HELP_PACK`, the `platform_help` capability in the matrix (no `alwaysAvailable`).
  - `packages/core/src/registries/tool-capabilities.ts`:
    - drop `platform_help` from `SYSTEM_TOOL_CAPABILITIES`;
    - add `ALWAYS_ENTITLED_PACKS`;
    - export it, fixing the comment at `registries/index.ts:16`.
  - `packages/core/src/registries/tier-catalog.ts`: `help` in `standard` and `plus`.
  - `packages/core/src/registries/station-data-packs.ts`: `help: false`, fixing the comments at :11 and :43.
  - `apps/api/src/prompts/system.prompt.ts`:
    - `PACK_ELSEWHERE.help` with its final phrase;
    - `PACK_PROMPT_SECTIONS.help` as a **placeholder**: the capability phrase, `markers: [capability]`, `render: () => []`.

    The base `## Help` lines stay until slice 4.
  - `apps/api/src/services/tools.service.ts`: the system block keeps building `platform_help` **by name** (no longer driven by `alwaysAvailable`), so sessions don't change.
- Tests:
  - `packages/core/src/__tests__/registries/{builtin-toolpacks,tool-capabilities,tier-catalog}.test.ts`
  - `apps/api/src/__tests__/tools/builtin-toolpack-schema-parity.test.ts`
  - `apps/api/src/__tests__/services/tools.service.test.ts`: only the guard that asserts system tools have no pack mirror, and the "descriptor set plus system tools" test. Session contents stay pinned as today.

**Steps**

1. **Tests (spec: the core cases, plus schema parity).**
   - eleven packs, and `help` holds only `platform_help`, which is `free`;
   - `alwaysAvailableToolNames()` returns `current_time` and `station_context`;
   - `ALWAYS_ENTITLED_PACKS` is `["help"]`, and every catalog tier includes it;
   - the `help` mirror matches `{ question?: string }`.

   Run them and confirm they fail.
2. **Implement.** Turn the tests green. Add placeholder entries wherever the new slug breaks compilation.
3. Run lint, type-check and the root `npm run build`.

**Done when:**
- the core and parity cases pass;
- `system.prompt.test.ts` passes unchanged, including the #284 marker guard, with `help`'s capability marker appearing only when the pack is effective;
- sessions still contain `platform_help` everywhere.

**Risk:** the capability phrase gets folded into the routing sentence (`system.prompt.ts:787`). Check it doesn't duplicate the base `## Help` wording.

---

## Slice 2 — Every tier is entitled to `help`

`TierService.tierPolicyFromRow` adds `ALWAYS_ENTITLED_PACKS` to the tier's pack list.

**Files**

- Edit: `apps/api/src/services/tier.service.ts` (:60-61).
- Tests:
  - `apps/api/src/__tests__/services/tier.service.test.ts`
  - `apps/api/src/__tests__/services/entitlement.service.test.ts`
  - the station pack-attach route suite (integration).

**Steps**

1. **Tests (spec: tier and entitlement unit, plus attach integration).**
   - A row without `help` resolves with it; a row with it isn't duplicated.
   - On a `["data_query"]` custom tier:
     - `help` is `effective` when attached and in `otherPlanPacks` when not, never `unentitled`;
     - attaching `help` succeeds, and is refused on a station the caller can't edit.

   Run them and confirm they fail.
2. **Implement** the one-line union. Turn the tests green.
3. Run lint and type-check.

**Done when:** the entitlement cases pass, and no existing tier or entitlement test changes.

**Risk:** `resolveTier` caches the policy for `CACHE_TTL_MS`, so tests that build the policy should go through `tierPolicyFromRow` or clear the cache.

---

## Slice 3 — `StationDiagnosticsService` and the bigger `station_context`

The diagnostics move out of the help tool, and `station_context` gains `organization`, `status` and the opt-in `stations`.

**Files**

- New: `apps/api/src/services/station-diagnostics.service.ts`: `forStation` / `situation`, moved from `platform-help.tool.ts`, plus `unknown`.
- Edit:
  - `apps/api/src/tools/platform-help.tool.ts`: uses the service, and its class comment no longer calls it a system tool.
  - `apps/api/src/tools/station-context.tool.ts`: the new output, the `include` `stations` rule, and the :23 comment.
- Tests:
  - New: `apps/api/src/__tests__/services/station-diagnostics.service.test.ts`, moving the situation cases from `platform-help.tool.test.ts`.
  - `apps/api/src/__tests__/tools/platform-help.tool.test.ts`: answers unchanged.
  - `apps/api/src/__tests__/tools/station-context.tool.test.ts`.
  - New: `apps/api/src/__tests__/__integration__/tools/station-context.integration.test.ts`.

**Steps**

1. **Tests (spec: diagnostics, platform-help, station-context unit and integration).**
   - Each situation, in precedence order; `unknown` on a failed read; the service never throws.
   - `organization` and `status` are present for every `include`.
   - `stations` is absent unless named, capped at 25 by name, and reports `totalCount`.
   - Integration: visibility hides another member's private station, and `status.hasRecords` flips after an import.

   Run them and confirm they fail.
2. **Implement** the extraction first. The help tests stay green, which proves no behaviour changed. Then add the `station_context` output.
3. Run lint and type-check. Add the new integration file to `durations.json` with its local time, then run `npm run lint:integration-durations`.

**Done when:** every case passes, and `platform_help`'s answers are unchanged.

**Risk:** the station list joins pack attachments per station. Batch them (`findByStationIds`-style) rather than one query per station, per CLAUDE.md #440.

---

## Slice 4 — The switch: sessions carry help only with the pack

This is the behaviour change.

**Files**

- Edit:
  - `apps/api/src/services/tools.service.ts`: drop `platform_help` from the system block, and add `if (enabledPacks.has("help"))`.
  - `apps/api/src/prompts/system.prompt.ts`:
    - remove the base `## Help` lines;
    - fill in `PACK_PROMPT_SECTIONS.help` (markers `## Help` and `platform_help`; `render` returns today's lines);
    - add the two Station Scope lines.
- Tests:
  - `apps/api/src/__tests__/services/tools.service.test.ts`: pack-less station → `[current_time, station_context]`; a station with `help` → adds `platform_help`; a custom tier lacking it in the row still builds it; update the `SYSTEM_TOOLS` set and the :2137/:2152-2182 cases.
  - `apps/api/src/__tests__/prompts/system.prompt.test.ts`: invert :1883-1890, and cover `## Help` when effective, the #284 guard over the full markers, the Station Scope `- Help: …` line and the two new lines.
  - `cost-gate.service.test.ts`: `free` stays immune for `platform_help` under an exhausted quota.

**Steps**

1. **Tests (spec: the tools.service, system.prompt and cost-gate cases).** Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Run lint and type-check. Also run the whole `apps/api` unit run for `tools.service`, `system.prompt` and the guard tests (`--testPathPattern 'tools.service|system.prompt|guard'`).
4. **Manual check on the local stack:**
   - On Playground (no Help pack), ask *"What is a tool pack?"*. The answer should name the Help pack, with no `platform_help` call.
   - Attach Help to a station and ask again. The answer should come from help content, with links.

**Done when:** every case passes and the manual check holds.

**Risk:** existing pins elsewhere (e.g. `CLAUDE.md`-driven guards, `system-principal`) may list the session's tools. Run the guard suites.

---

## Slice 5 — Web icon, content and docs

This brings every surface that names `platform_help` up to date (`CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit:
  - `apps/web/src/utils/tool-pack-icons.util.ts`: `help` → `HelpOutlineIcon`, with a test.
  - `packages/core/src/content/faq.util.ts`: "What are tool packs?" names Help.
  - `packages/core/src/content/glossary.util.ts`: the "Tool Pack" entry names Help.
  - `CLAUDE.md`:
    - the documentation inventory's system tools are `current_time` and `station_context`;
    - the tool-surfaces row says `platform_help` is in the `help` pack and is mirrored like any pack tool.
  - `packages/e2e/README.md`: `--all-toolpacks` stations carry Help.
  - `apps/web/src/utils/station-attachments.util.ts:4`: stale comment.
- Issue: amend #1044's Deliverables to "attach the help pack", per `/ticket`'s amendment procedure.

**Steps**

1. **Tests.**
   - The icon test: Help renders `HelpOutlineIcon`, and `withEntitlements` doesn't disable it when the entitlements include it.
   - Run `faq.util.test.ts`, `glossary.util.test.ts`, `builtin-toolpacks.test.ts` and `system.prompt.test.ts`.
   - Run `lint:doc-pointers` and the permission-copy guards.
2. **Implement.** Make the edits and amend #1044.
3. Run lint, type-check and the root `npm run build`.

**Done when:**
- `grep -rn "platform_help" CLAUDE.md docs/*.md packages/*/README.md` shows no stale "system tool" wording;
- the icon test passes;
- #1044 is amended.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `help` pack, `ALWAYS_ENTITLED_PACKS`, catalog, prompt placeholders | core and parity guards; sessions unchanged |
| 2 | `tierPolicyFromRow` union | tier, entitlement and attach tests |
| 3 | `StationDiagnosticsService`, `station_context` `organization` / `status` / `stations` | diagnostics and station-context unit and integration tests |
| 4 | Session build and prompt switch | tools.service, system.prompt and cost-gate tests; manual portal check |
| 5 | Web icon, FAQ/glossary, `CLAUDE.md`, e2e README, #1044 | content tests, doc-pointers, build |

## Cross-slice notes

- **Behaviour changes only in slice 4.** Slices 1–3 keep `platform_help` in every session, so a revert of slice 4 alone restores today's behaviour.
- **Prompt placeholder.** `PACK_PROMPT_SECTIONS.help` is a placeholder in slice 1 (capability marker only). Slice 4 makes it real. Both states satisfy the #284 guard.
- **Stale builds.** After slice 1, rebuild core before running the api tests (`project_stale_core_dist_after_branch_switch`) and restart the API dev server for the manual check (`project_api_dev_server_stale_core`).
- **Demo orgs.** A fresh `demo create` gets Help on its Demo station automatically (`DemoSeedService` enables every built-in pack). Note it in the smoke doc.
- **Review chain.** After slice 5: `/code-review` and `/security-review` (the change touches entitlement and a cross-station read). Then `/smoke`, where most steps are portal prompts and walkable, and `/adversarial-review`.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
