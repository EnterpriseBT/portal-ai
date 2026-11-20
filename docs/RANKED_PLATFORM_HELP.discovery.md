# Ranked platform help — Discovery

**Issue:** [EnterpriseBT/portal-ai#1049](https://github.com/EnterpriseBT/portal-ai/issues/1049)

**Why this exists.** `platform_help` answers "how does the product work" from the shipped FAQ and glossary. That's the right design for accuracy: the tool picks the text, the agent relays it, and no model authors a claim about the product. But its retrieval is a whole-string substring match of the question against entry text. "How do I bring in a spreadsheet?" or even "What is a portal?" matches nothing, so most real questions get the fallback paragraph.

Both smoke walks since #1050 saw the same thing: the agent called the tool repeatedly, got the fallback, and paraphrased around it. Separately:
- nothing covers troubleshooting;
- "relay it as written" is a prompt instruction, not enforcement.

**Since the PRD was filed,** #1050 made the tool content-only. It no longer reads the station or composes situation prose, so the PRD's "situational prose plus no entries" now reads "the orientation paragraph plus no entries".

This is the retrieval-and-rendering upgrade that makes the help content findable for real phrasings, adds troubleshooting, and puts the quoted text in front of the user unmodified.

## The current shape

### The tool

| Piece | Location | Note |
|---|---|---|
| Input | `apps/api/src/tools/platform-help.tool.ts:15-23` | `question?: string` (max 500) |
| Retrieval | `selectContent`, `:82-102` | `filterFAQ` / `filterGlossary` substring match; first `MAX_FAQ = 3`, `MAX_GLOSSARY = 3` (`:26-27`) |
| Output | `composeAnswer` `:118-131`, `buildLinks` `:133-161` | `{answer: string, links: {label,url}[]}`. Falls back to `ORIENTATION` (`:105-111`), which itself describes product behaviour. Always appends the "Analytics & Portals help" link |
| Capability | `packages/core/src/registries/builtin-toolpacks.ts:2043-2054` | `pure`, `free`, `resultKind: "scalar"`, `production: {kind: "value"}` |
| Mirror | `builtin-toolpacks.ts:891-895` | `{question}`. The parity test (`builtin-toolpack-schema-parity.test.ts:194-209`) fails if the property or `required` keys drift |

### Content

| Piece | Location | Note |
|---|---|---|
| FAQ | `packages/core/src/content/faq.util.ts` | 42 entries `{question, answer, category, relatedGlossaryTerms?}`; `filterFAQ` `:387-402` |
| Glossary | `glossary.util.ts` | 50 entries `{term, category, definition, example?, relatedTerms?, pageRoute?}`; `filterGlossary` `:554-571`; `contentEntrySlug` `:33-37` |
| URLs | `help-url.util.ts` | `HELP_TAB` (3 keys, pinned by `help-url.util.test.ts:17`), `HelpEntrySurface = "glossary" \| "faq"` (`:28`), `buildHelpUrl` `:47-63` |
| Purity | `__tests__/content/content-purity.test.ts:28-48` | An exact module list, and **every module imports nothing** |
| Marketing site | `apps/site/src/lib/jsonld.ts:73-83` | All FAQ entries become `FAQPage` JSON-LD; the glossary feeds `DefinedTermSet` (`features.astro:88-94`) |

### Help page

- **Search:** `apps/web/src/views/Help.view.tsx` has 3 hardcoded tabs (`:62-64`, `:91-95`). The search box calls the same `filterFAQ` / `filterGlossary` (`:181-197`).
- **Expansion:** accordions are controlled by `expandedSlugs`, with anchor seeding (`:126-140`).
- **Routing:** `apps/web/src/utils/routes.util.ts` holds `HelpTab` (`:87`), `HELP_TAB_INDEX` (`:94-98`), `normalizeHelpSearch` (`:136`), `HelpAnchorSurface` (`:154`) and `parseHelpAnchor` (`:174-188`).
- **Tests:** routes, Help route, Help view, and the FAQ and Glossary lists (the lists run axe).

### Result kinds and blocks

- **Result kinds:** `ResultKindSchema` (`packages/core/src/models/tool-capability.model.ts:80-87`) is `data-table | scalar | d3 | geo | mutation-result | progress`. A refinement (`:231-242`) only lets `production.kind 'value'` render as scalar, mutation-result or progress.
- **Custom tools:** `customToolCapabilityError` (`:276-299`) is reused for custom packs.
- **API:** `resolveDisplayBlock` (`apps/api/src/services/portal.service.ts:316-450`) has one branch per kind and returns `null` for scalar. It's called live (`:213-229`) and on replay (`:1038`).
- **Web, live stream:** `streamingBlockFor` (`apps/web/src/utils/portal-stream.util.ts:64-76`) maps only d3, data-table and mutation-result.
- **Web, rendering:** core's `ContentBlockRenderer` is a registry (`:77-98`). Web registers d3, map and table in `main.tsx:14-16`, and `PortalMessage` renders only registered types (`:99-101`).
- **Pinning:** a new block type is **not pinnable** unless it joins `PortalResultTypeSchema`, the `portal_result_type` pg enum and their mirrors.
- **Swagger:** the block-type enum is at `swagger.config.ts:2185`.

### Prompt

`PACK_PROMPT_SECTIONS.help` (`apps/api/src/prompts/system.prompt.ts:763-789`) has `blocks: []`. Its relay instruction (`:782`) is pinned by `system.prompt.test.ts:1936-1942` (`/relay/`, `/do not rewrite/`).

## The design space

### Decision 1 — The ranking algorithm

- **A. Token overlap.** Count shared words between the query and an entry. It's simple but doesn't separate a rare word ("spreadsheet") from a common one ("data").
- **B. BM25-lite with field weights.** Tokenise (lowercase, strip punctuation, a short stopword list, light suffix stemming: -s, -es, -ing, -ed). Score each entry with BM25 over its fields:
  - weight ×3: title (question, term or symptom) and `aliases`;
  - weight ×1: the body (answer, definition, or cause + fix) and related terms.

  Over 120 entries it computes in well under a millisecond.
- **C. Fuzzy or trigram matching.** It handles typos but adds noise and tuning, with no clear gain over aliases.

| | A | B | C |
|---|---|---|---|
| Rare-word weighting | no | yes | partial |
| Deterministic, pure | yes | yes | yes |
| Tuning surface | none | k1/b + weights | thresholds |

**Lean: B.** It's the standard answer at this size, and aliases cover the vocabulary gaps ("spreadsheet" → File Upload) as a content edit, which is the PRD's adaptation rule.

### Decision 2 — Where the corpus is assembled, given the purity rule

The ranker needs the FAQ, glossary and troubleshooting arrays. `content-purity.test.ts` forbids any import in a content module.

- **A. Keep strict purity.** The ranker is generic, ranking documents passed in, and the API tool and Help view each build the corpus. Corpus assembly is then duplicated, and they can drift: the PRD requires that "the tool and the page agree".
- **B. Allow relative imports inside `content/`.** The purity test changes from "imports nothing" to "imports nothing outside `content/`". A `help-search.util.ts` builds the corpus once and ranks it.

**Lean: B.** The purity rule exists so content stays dependency-free for the site and anything else that imports it. Intra-folder imports keep that, and one corpus is the only way to guarantee "same query, same order".

### Decision 3 — The tool contract

**Input:**
- `question?` (≤500);
- `keywords?: string[]` (≤8 items, each ≤40): the agent's reading, scored alongside the question;
- `entryIds?: string[]` (≤5): the `<surface>:<slug>` ids from a previous result's candidates, fetched directly.

**Output** (a structured result, not prose):

```ts
{ type: "help", query: string,
  entries: { surface: "faq"|"glossary"|"troubleshooting", slug, title, body, url }[], // ≤3, bodies verbatim
  candidates: { surface, slug, title, url }[],                                      // next ≤5, titles only
  noMatch: boolean }
```

`body` is the stored field exactly. For troubleshooting it's symptom, cause and fix, joined by fixed labels. Nothing else in the result is free text.

**Lean: as above.** It's bounded regardless of corpus size, and the agent can follow up by id rather than re-querying.

### Decision 4 — The result kind and rendering path

- **A. Keep `scalar`, and have the agent relay.** No block, no enforcement: the problem stays.
- **B. A new `ResultKind` `help` rendered as a block.**
  - Widen the value-production refinement to allow `help`.
  - Exclude `help` from custom tools in `customToolCapabilityError`: only the built-in tool may claim verbatim help.
  - The `resolveDisplayBlock` branch is server-side, from the tool's own result.
  - A `streamingBlockFor` case for live streaming.
  - The web registers a renderer through `registerHelpBlockRenderer`, since links need the router's `Link`, like the table and map renderers.
  - Add `help` to the Swagger block enum.

**Lean: B.** The block's text comes from the tool result on the server, so the model can't alter it. The prompt then says "the block shows the entries; add at most a framing sentence, don't restate".

### Decision 5 — Pinning the help block

- **A. Not pinnable (the default).** That needs no migration.
- **B. Pinnable.** That needs a pg enum migration plus five mirrors.

**Lean: A.** A help answer has a permanent home on the Help page, so pinning duplicates it.

### Decision 6 — The troubleshooting surface

- **The module:** `packages/core/src/content/troubleshooting.util.ts`, holding `TROUBLESHOOTING_ENTRIES: {symptom, cause, fix, related?: {surface, title}[], aliases?}[]`, slugged by `contentEntrySlug(symptom)`.
- **Help URLs:** `HELP_TAB.troubleshooting`, `HelpEntrySurface` gains `troubleshooting`, and anchors are `#troubleshooting-entry-<slug>`.
- **The web Help tab:** a fourth tab (Troubleshooting), with `HelpTab`, `HELP_TAB_INDEX`, `normalizeHelpSearch`, `parseHelpAnchor`, and a `TroubleshootingList` component, with axe tested.
- **The marketing site:** troubleshooting stays **in-app only**, and the FAQ JSON-LD is unchanged. This is the PRD's "record at discovery" item. It's operational content about a signed-in product, its symptoms quote in-app errors, and putting it in public JSON-LD would publish failure modes as marketing copy.

**Lean: as above.** The initial entries are settled in the spec, for example:
- a sync failed;
- an import produced no rows;
- "You don't have permission to …";
- a tool pack "Not included in your plan";
- "is running on this entity" (a job lock);
- the agent turn limit.

### Decision 7 — Findability guards and the no-match floor

- **Self-retrieval:** every entry, on all three surfaces, ranks **first** for its own title.
- **Paraphrase eval:** a fixture (`help-paraphrases.ts`) of about 30 real phrasings, each mapped to its expected slug, must rank in the **top 3**. It's seeded from the walk transcripts ("What is a portal?", "How do I create a station?", "How do I bring in a spreadsheet?").
- **Output invariant:** every `entries[].body` and `title` equals a corpus field, and `noMatch` uses only fixed constants.
- **No-match floor:** no entry scores above the floor (the top score below a fraction of a "one title-word hit" score). Then `noMatch: true`, no entries, and a fixed "No help entry covers this" with a link to Help's Getting Started.
- **`ORIENTATION` is removed:** it describes product behaviour, which a no-match must not do. A bare call (no question or keywords) returns the Getting Started FAQ entries as ordinary matches.

**Lean: as above.** The floor is tuned against the paraphrase set in the spec.

## Tradeoff comparison

| | D1 BM25-lite | D2 intra-content imports | D3 structured result | D4 `help` block | D5 not pinnable | D6 in-app troubleshooting | D7 guards |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. **The ranker:** `packages/core/src/content/help-search.util.ts` holds one BM25-lite ranker with field weights, a short stopword list and light stemming. It builds one corpus from FAQ, glossary and troubleshooting, and exports `searchHelp(query, {keywords?, surfaces?, limit?})`, returning entries in score order. The content purity test allows imports within `content/` only.
2. **Aliases:** `aliases?: string[]` is added to FAQ, glossary and troubleshooting entries, weighted with the title. The aliases needed by the paraphrase set are added.
3. **The Help page:** its search box uses `searchHelp` within the active tab, ordered by score. Category chips still filter.
4. **The tool:** `platform_help` takes `question`, `keywords` and `entryIds`. It returns the structured help result (≤3 verbatim bodies plus ≤5 candidate titles plus `noMatch`), and its mirror schema matches.
5. **The block:** a `help` `ResultKind` (value production allowed, custom tools refused) renders as a server-built, unpinnable `help` block. The web registers a `HelpBlock` renderer with router links, and the live stream maps it.
6. **The prompt:** the `## Help` section says the block shows the entries verbatim, so the agent adds at most one framing sentence and never restates or extends them. On `noMatch` it says no help entry covers it and links Help.
7. **Troubleshooting:** `troubleshooting.util.ts`, a Troubleshooting Help tab, and anchors. It stays in-app only, not on the marketing site.
8. **Guards:** self-retrieval (top 1), the paraphrase eval (top 3), the output invariant, and a no-match floor. `ORIENTATION` is removed.
9. **Docs:** `CLAUDE.md`'s documentation inventory lists the troubleshooting surface, and the tool description, the mirror and the `## Help` prompt section are kept in sync.

## Open questions

1. **Does the Help search box search all tabs or only the active one?** Lean: the active tab, as today. Cross-tab search is a separate UX change.
2. **Should a `help` block carry the "candidates" list visibly ("Related: …" links)?** Lean: yes, as links below the entries. It's cheap and gives the user the next step without another model turn.
3. **How many troubleshooting entries ship first?** Lean: about 6, chosen in the spec from real error codes (`PERMISSION_DENIED`, `ENTITY_LOCKED_BY_JOB`, `AGENT_TURN_LIMITED`, `STATION_TOOLPACK_NOT_ENTITLED`, a failed sync, an empty import). The user adds more over time.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because it's pure in-process computation over static data.
- **Accuracy & auditability:** the block text is the corpus text, byte-identical and enforced by the invariant test and the server-built block. That's the accuracy guarantee the PRD asks for. Lean: as designed.
- **Failure modes:** no dependency can fail. A no-match fails closed to "no help entry covers this", never a guess.
- **Scale & unbounded growth:** the result is bounded (3 bodies, 5 titles) whatever the corpus size. Ranking is O(corpus) per call, trivial below about 1,000 entries; past that, revisit.
- **Multi-tenancy:** N/A. The content is global and static, with no org data. The tool stays free and always entitled.
- **Contract stability:** a new `ResultKind` is a schema addition, and custom tools are excluded from it. `entryIds` use the stable `contentEntrySlug` contract shared with the Help URLs.
- **Data lifecycle:** N/A, since nothing is stored. Help blocks persist in `portal_messages` like other blocks, and an old block keeps its text even if the content later changes, which is correct for a transcript.

## What this doesn't decide

- **Embeddings, a vector index or fine-tuning:** out of scope by the PRD (egress, and no gain at this size).
- **Model-authored answers from the corpus:** out of scope; the tool composes and the agent frames.
- **Rewriting existing entries beyond `aliases`:** out of scope.
- **Cross-tab Help search:** open question 1.

## Next step

`docs/RANKED_PLATFORM_HELP.spec.md` pins the ranker's API and constants, the tool's input and output schemas, the `help` result kind and block contract, the troubleshooting type and its first entries, the Help tab grammar, and the guard tests. The plan then lands it in about 5 slices:
1. the ranker, aliases and guards (core);
2. troubleshooting content and the Help tab (core and web);
3. the Help search box on the ranker (web);
4. the tool contract and the `help` result kind (core and api);
5. the block renderer, stream mapping and prompt (web and api).
