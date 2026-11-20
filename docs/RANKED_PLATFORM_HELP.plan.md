# Ranked platform help — Plan

**The plan implements the spec in TDD order:**
1. The ranker and its guards.
2. The troubleshooting surface.
3. Help search on the ranker.
4. The tool's structured result as a server-built `help` block.
5. The renderer and prompt that show it.

Spec: `docs/RANKED_PLATFORM_HELP.spec.md`. Discovery: `docs/RANKED_PLATFORM_HELP.discovery.md`. Issue: #1049. Builds on #1050 (the content-only `platform_help`) and #365 (the Help URL grammar).

There are five slices. Each sits behind a green suite and leaves the repo compilable. They land as **commits on `feat/1049-ranked-platform-help`** (PR #1098).

Run tests from each package with the npm scripts and `--testPathPattern`, never jest directly:

```bash
cd packages/core && npm run test:unit -- --testPathPattern '<files>'
cd apps/api && npm run test:unit -- --testPathPattern '<files>'
cd apps/web && npm run test:unit -- --testPathPattern '<files>'
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` for the touched packages, rebuilding core before api and web runs.
5. Push.

A core change gets a full root build before the push (per the memory note on core changes).

**Sequencing rationale:**
- **Slice 1** is pure core logic with no consumers. It also settles the floor and weights, which everything after depends on.
- **Slice 2** adds the third surface to the corpus and the URL grammar before any consumer reads it, so the tool and page later ship with all three.
- **Slice 3** is the first consumer (web Help search), proving "same query, same order" on the page alone.
- **Slice 4** changes the tool's contract. The server builds the block, but there's no renderer yet: an unregistered block type renders nothing, and the agent still has the prompt's framing.
- **Slice 5** renders it and rewords the prompt. The behaviour is complete only here, so the walk happens after it.

---

## Slice 1 — The ranker, corpus, aliases and findability guards (core)

**Files**

- New: `packages/core/src/content/help-search.util.ts`. It holds `HelpSurface`, `HelpDocument`, `HELP_RANKING`, `HELP_MATCH_FLOOR`, `HELP_STOPWORDS`, `tokenizeHelp`, `HELP_CORPUS` (FAQ and glossary for now, since troubleshooting arrives in slice 2), `searchHelp`, `findHelpDocument` and `helpDocumentUrl`.
- Edit: `content/faq.util.ts` and `content/glossary.util.ts` gain `aliases?`, plus aliases on the entries the paraphrase set needs. Edit `content/index.ts` too.
- Edit: `__tests__/content/content-purity.test.ts` lists the new module and allows relative content imports only.
- New tests:
  - `__tests__/content/help-search.util.test.ts`;
  - `__tests__/content/help-findability.test.ts` (self-retrieval, paraphrases, nonsense);
  - `__tests__/content/fixtures/help-paraphrases.ts`.

**Steps**

1. **Tests:** spec core cases for tokenizing (4), ranking (7), corpus (3, for two surfaces) and the three findability tables, plus the purity edit. They fail.
2. **Implement** BM25-lite, then **tune** `HELP_MATCH_FLOOR` and add aliases until:
   - self-retrieval is first for every entry;
   - every paraphrase lands in the top 3;
   - every nonsense query returns nothing.

   Paraphrases whose target is a troubleshooting entry are marked to join in slice 2.
3. Lint and type-check (core), then a full root build, since core content changed and the site reads it.

**Done when:** the guards are green over FAQ and glossary, and the floor and weights are fixed in `HELP_RANKING` / `HELP_MATCH_FLOOR`.

**Risk:** a few titles share most of their tokens (e.g. "Station" and "Default Station"), so self-retrieval could tie. The tie-break (surface order, then title) plus the exact-title boost decides it. If a real collision remains, add a distinguishing alias.

---

## Slice 2 — Troubleshooting content, the Help URL grammar and the Help tab (core and web)

**Files**

- New: `packages/core/src/content/troubleshooting.util.ts`, with the six entries per the spec table. The cause and fix copy is held to the permission-copy guard.
- Edit `content/help-url.util.ts` (`HELP_TAB.troubleshooting`, `HelpEntrySurface`), `content/help-search.util.ts` (the corpus includes troubleshooting) and `content/index.ts`.
- Edit `content-purity.test.ts` (the module list).
- Edit `apps/web/src/utils/routes.util.ts` (`HelpTab.Troubleshooting`, index 3, the anchor prefix, a three-surface `parseHelpAnchor`).
- Edit `apps/web/src/views/Help.view.tsx` (the fourth tab, its list and anchor expansion).
- New: `apps/web/src/components/TroubleshootingList.component.tsx`.
- Tests:
  - core: `troubleshooting.util.test.ts` (new), `help-url.util.test.ts` (edit), the troubleshooting paraphrases joined in the findability test;
  - web: `routes.util.test.ts`, `HelpRoute.test.tsx`, `HelpView.test.tsx` (the troubleshooting anchor), `TroubleshootingList.test.tsx` (new, with axe).

**Steps**

1. **Tests:** spec cases: troubleshooting (3), help-url (2), web routes and route (3), HelpView anchor (1), TroubleshootingList (3). They fail.
2. **Implement.** Green. Run the core findability guards again with all three surfaces, and add aliases if a troubleshooting paraphrase misses.
3. **Rebuild core.** Run the web focused tests, plus `component-axe.guard`, the permission-copy guards (api and web) and `lint:doc-pointers`. Then lint and type-check.

**Done when:** `/help?tab=troubleshooting#troubleshooting-entry-<slug>` resolves in tests, and every troubleshooting entry is findable.

---

## Slice 3 — The Help page search on the ranker (web)

**Files**

- Edit `apps/web/src/views/Help.view.tsx`. A query with tokens goes through `searchHelp(query, {surfaces: [activeSurface], category})`, in score order. An empty query keeps today's order and category filter.
- Edit `apps/web/src/__tests__/HelpView.test.tsx`.

**Steps**

1. **Tests:**
   - "bring in a spreadsheet" lists File Upload first on FAQ;
   - an empty query keeps array order;
   - the existing substring cases still find their entries (adjust any that relied on substring-only matching).

   They fail.
2. **Implement.** Green.
3. Lint and type-check (web).

**Done when:** the page and `searchHelp` give the same order for a query.

---

## Slice 4 — The tool contract, the `help` result kind and the server-built block (core and api)

**Files**

- **core:**
  - `models/tool-capability.model.ts` (`help` kind, the refinement, the custom-tool refusal);
  - `contracts/help-block.contract.ts` (new) and `contracts/index.ts`;
  - `contracts/portal.contract.ts` (`PortalBlockTypeSchema`);
  - `registries/builtin-toolpacks.ts` (capability `resultKind: "help"`, the mirror's `keywords` and `entryIds`, the description);
  - tests: the capability and help-block contract tests.
- **api:**
  - `tools/platform-help.tool.ts` (the new input, `execute` returning `HelpBlockContent`, `ORIENTATION` removed);
  - `services/portal.service.ts` (the `help` arm in `resolveDisplayBlock`);
  - `config/swagger.config.ts` (the block enum);
  - tests: `tools/platform-help.tool.test.ts` (rewritten), `services/portal.service.test.ts` (the help arm).

**Steps**

1. **Tests:**
   - core: capability (3) and contract (2);
   - api: the tool (8, including the byte-identical output invariant run over every paraphrase) and the portal service (2).

   They fail.
2. **Implement.** Green.
3. **Focused runs:** api `tools.service.test.ts` (the help-pack build and free-cost pins), `builtin-toolpack-schema-parity.test.ts`, `tool-capabilities.test.ts` and `system.prompt.test.ts`. The prompt itself is unchanged until slice 5, but its marker guards must stay green.
4. Lint and type-check (core and api), then a full root build.

**Done when:** a `platform_help` call yields a valid `help` block server-side, live and on replay, and custom tools can't claim the kind.

**Risk:** this changes `platform_help`'s output shape, and the prompt's relay paragraph still tells the agent to relay `answer` until slice 5. On the branch that's harmless, but it's why slices 4 and 5 ship in the same PR.

---

## Slice 5 — The renderer, stream mapping, prompt and docs (web, api and docs)

**Files**

- **web:**
  - `components/HelpBlock.component.tsx` (new, `HelpBlockUI`);
  - `utils/help-block-renderer.util.tsx` (new, `registerHelpBlockRenderer`);
  - `main.tsx` (registers it);
  - `utils/portal-stream.util.ts` (the `help` case);
  - tests: `HelpBlock.test.tsx` (new, with axe) and `portal-stream.util.test.ts`.
- **api:** `prompts/system.prompt.ts` (`blocks: ["help entries"]`, the new relay paragraph, the `keywords` hint) and `__tests__/prompts/system.prompt.test.ts` (the pins replaced).
- **docs:** `CLAUDE.md`. The documentation inventory gains `troubleshooting.util.ts` beside the glossary and FAQ, and the tool-surfaces row covers the `help` block. Update the FAQ entry describing Help if it lists the tabs.

**Steps**

1. **Tests:** web HelpBlock (5) and stream (1); api prompt (3). They fail.
2. **Implement.** Green.
3. **Focused runs:** `component-axe.guard`, `PortalMessage` tests, api `system.prompt.test.ts` and the marker guards, plus `lint:doc-pointers` and the permission-copy guards. Lint, type-check and a full root build.

**Done when:** a portal answer shows the help block with verbatim entries, and the agent frames rather than repeats it.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Ranker, corpus, aliases, findability guards | core unit; floor and weights fixed |
| 2 | Troubleshooting content and its Help tab | core and web unit, axe, permission-copy guards |
| 3 | Help search on the ranker | web HelpView |
| 4 | Tool contract, `help` kind, server block | core and api unit; parity and cost pins |
| 5 | Block renderer, stream mapping, prompt, docs | web and api unit, axe, prompt pins |

## Cross-slice notes

- **Core changes need a full root build before pushing** (slices 1, 2 and 4). The site and web read core content.
- **The paraphrase fixture is the living eval.** Every slice that touches content or ranking runs it, and a new phrasing the walk turns up joins it.
- **Smoke and adversarial walks happen after slice 5,** when the end-to-end behaviour exists.
- **Docs sync** is slice 5, plus content copy in slices 1 and 2.

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
