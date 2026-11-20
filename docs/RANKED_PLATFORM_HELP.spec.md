# Ranked platform help — Spec

This spec pins the contract for #1049:
- one ranker over FAQ, glossary and troubleshooting entries, shared by `platform_help` and the Help page search;
- a structured tool result rendered as a server-built `help` block;
- the troubleshooting surface and its Help tab;
- the findability guards.

Discovery: `docs/RANKED_PLATFORM_HELP.discovery.md`. Issue: #1049.

## Amendment — slice 3

- **Help search ranks over `HELP_CORPUS`**, keeping the page's own entries in the ranker's order, so a whole-word query gives the same order as the tool.
- **The fallback:** when the ranker finds nothing (a word still being typed, such as "stat"), the page falls back to substring matching, so typing still narrows the list. That's `filterFAQ` / `filterGlossary`, and the same over symptom, cause and fix for troubleshooting.

## Amendment — slice 1

- **`searchHelp` takes `floor?`** (default `HELP_MATCH_FLOOR`, which slice 1 tuned to 1.5).
  - Scores scale with the corpus, so the small-corpus unit tests set their own.
  - A match must also score above zero.
- **`HELP_RANKING.exactTitleBonus` (10)** is added when the slugged query equals the entry's slug. Stopwords make "Tool Pack" and "What are tool packs?" the same terms, and this tells them apart.
- **"The File Upload FAQ entry"** in the acceptance criteria is "How do I connect my first data source?", the entry that covers File Upload for CSV and Excel. No FAQ is titled File Upload.
  - It gained the aliases spreadsheet, csv, excel, "upload a file", "import a file", "bring in data" and "import data".
  - Other aliases for the paraphrase set went on: the vague-answers FAQ, the invite FAQ, glossary Station, and glossary Custom Toolpack.

## Key decisions (flag for review)

1. **The ranker:** BM25-lite (k1 1.2, b 0.75) over field-weighted tokens: title ×3, `aliases` ×3, body ×1, related ×1. It uses a short stopword list and light suffix stemming. It's pure, in `@portalai/core/content`.
2. **The purity rule:** it changes from "imports nothing" to "imports nothing outside `content/`". One corpus module serves the tool and the page.
3. **The tool result is structured:** at most 3 entries with verbatim `body`, at most 5 candidate titles, and `noMatch`. The model never receives prose to "relay"; the block shows the text.
4. **A new `help` result kind:**
   - value production is allowed for it;
   - **custom tools may not declare it**;
   - the block is built server-side by `resolveDisplayBlock`, so the model can't alter it;
   - it isn't pinnable.
5. **`ORIENTATION` is removed.** A no-match says only that no entry covers it, with a Help link. A bare call returns the Getting Started FAQ entries.
6. **Troubleshooting is in-app only.** It gets a fourth Help tab, and the marketing site's JSON-LD is unchanged.

## Scope

### In scope
- **The content layer:** ranker, corpus, aliases, the troubleshooting module, Help URL grammar for the third surface, and the purity test.
- **The tool:** contract, capability, mirror, block build, prompt.
- **The web:** Help tab and search on the ranker, plus the help block renderer and its stream mapping.
- **Guards and docs.**

### Out of scope
- Embeddings, fine-tuning, model-authored answers.
- Pinning help blocks.
- Cross-tab Help search.
- Rewriting existing entries beyond adding `aliases`.

## Surface

### `packages/core/src/content/help-search.util.ts` (new)

```ts
export type HelpSurface = "faq" | "glossary" | "troubleshooting";

export interface HelpDocument {
  surface: HelpSurface;
  slug: string;              // contentEntrySlug(title)
  title: string;             // FAQ question | glossary term | troubleshooting symptom
  body: string;              // FAQ answer | glossary definition | troubleshooting "Why it happens: <cause>\nWhat to do: <fix>"
  aliases: readonly string[];
  related: readonly string[];// relatedGlossaryTerms | relatedTerms | related titles
  category?: string;         // FAQCategory | GlossaryCategory; none for troubleshooting
}

export interface HelpMatch { doc: HelpDocument; score: number }

export const HELP_RANKING = { k1: 1.2, b: 0.75, weights: { title: 3, aliases: 3, body: 1, related: 1 } } as const;
/** A match must score at least this. Tuned in slice 1 against the paraphrase and nonsense fixtures. */
export const HELP_MATCH_FLOOR: number;

export const HELP_CORPUS: readonly HelpDocument[];       // all three surfaces, built once from the arrays
export function tokenizeHelp(text: string): string[];   // lowercase, split on non-alphanumerics, drop HELP_STOPWORDS, stem -ies→y, -es/-s, -ing, -ed (min stem 3)
export function searchHelp(
  query: string,
  opts?: { keywords?: readonly string[]; surfaces?: readonly HelpSurface[]; category?: string;
           limit?: number; corpus?: readonly HelpDocument[] }
): HelpMatch[];                                          // score-desc, ties by surface order (faq, glossary, troubleshooting) then title; matches below the floor dropped
export function findHelpDocument(surface: HelpSurface, slug: string): HelpDocument | undefined;
export function helpDocumentUrl(doc: Pick<HelpDocument, "surface" | "slug">): string; // buildHelpUrl({tab, entry})
```

- **Query terms:** the query tokens plus each keyword's tokens, deduplicated, form the query term set.
- **An empty query** (no tokens) returns `[]`.

### Content types (`faq.util.ts`, `glossary.util.ts`)

- `FAQEntry` gains `aliases?: string[]`, and `GlossaryEntry` gains `aliases?: string[]`. Aliases are phrasings a user might type that the title doesn't contain, e.g. File Upload's FAQ gets `["spreadsheet", "csv", "excel", "upload a file"]`.
- `filterFAQ` / `filterGlossary` stay, unchanged, for category-only filtering. Help's search no longer calls them with a query.

### `packages/core/src/content/troubleshooting.util.ts` (new)

```ts
export interface TroubleshootingEntry {
  symptom: string;           // the title, phrased as the user sees it
  cause: string;
  fix: string;
  related?: { surface: "faq" | "glossary"; title: string }[];
  aliases?: string[];
}
export const TROUBLESHOOTING_ENTRIES: readonly TroubleshootingEntry[];
```

The first six entries (exact `cause` and `fix` prose is written in slice 2 and held to the permission-copy guard: name the permission, never a role):

| symptom | grounded in |
|---|---|
| A sync or import job failed | failed jobs' `error` on Jobs / `JobDetail` |
| An import finished but no records appeared | layout plan regions that extracted nothing |
| "You don't have permission to …" | `403 PERMISSION_DENIED` (`permissionDenied`) |
| A tool pack shows "Not included in your plan" | `STATION_TOOLPACK_NOT_ENTITLED`, Settings → Billing |
| Actions are paused because a job "is running on this entity" | `409 ENTITY_LOCKED_BY_JOB`, the Jobs page and cancel |
| The assistant says I've reached my turn limit | `AGENT_TURN_LIMITED` |

### `help-url.util.ts`

- `HELP_TAB` gains `troubleshooting: "troubleshooting"`.
- `HelpEntrySurface` becomes `"glossary" | "faq" | "troubleshooting"`.
- `buildHelpUrl` is unchanged (`#troubleshooting-entry-<slug>`).

### `content-purity.test.ts`

- The module list gains `help-search.util.ts` and `troubleshooting.util.ts`.
- The rule becomes "every `import` is a relative `./` import of another content module". Any package or `../` import still fails.

### `packages/core/src/models/tool-capability.model.ts`

- `ResultKindSchema` gains `"help"`.
- The value-production refinement allows `help`.
- `customToolCapabilityError` returns `"custom tools cannot declare resultKind 'help' (only the built-in help tool quotes help content)"`.

### `packages/core/src/contracts/help-block.contract.ts` (new; exported from `contracts`)

```ts
const HelpEntryRefSchema = z.object({ surface: z.enum(["faq","glossary","troubleshooting"]), slug: z.string(), title: z.string(), url: z.string() });
export const HelpBlockContentSchema = z.object({
  type: z.literal("help"),
  query: z.string(),
  entries: z.array(HelpEntryRefSchema.extend({ body: z.string() })).max(3),
  candidates: z.array(HelpEntryRefSchema).max(5),
  noMatch: z.boolean(),
  helpUrl: z.string(),           // where "see all help" points
});
export type HelpBlockContent = z.infer<typeof HelpBlockContentSchema>;
```

`PortalBlockTypeSchema` (`portal.contract.ts:245-252`) gains `"help"`, and the Swagger block enum (`swagger.config.ts:2185`) gains `"help"`. `help` is **not** added to `PortalResultTypeSchema`, so it isn't pinnable.

### `apps/api/src/tools/platform-help.tool.ts`

**Input:**

```ts
z.object({
  question: z.string().max(500).optional(),
  keywords: z.array(z.string().min(1).max(40)).max(8).optional(),
  entryIds: z.array(z.string().regex(/^(faq|glossary|troubleshooting):[a-z0-9-]+$/)).max(5).optional(),
})
```

**`execute` returns a `HelpBlockContent`:**
- **`entryIds` present:** resolve them with `findHelpDocument`, dropping unknown ids. If any resolved, `entries` is those (at most 3), `candidates` is `[]` and `noMatch` is false.
- **Otherwise, a question or keywords given:** `searchHelp(question, {keywords})`. The top 3 become `entries` (with `body`), the next 5 become `candidates` (titles only), and `noMatch` is true when nothing passes the floor.
- **A bare call** (nothing given): `entries` is the first 3 `FAQCategory.GettingStarted` FAQ entries in array order, with `noMatch` false.
- **Always:** `helpUrl` is `buildHelpUrl({tab: HELP_TAB.gettingStarted})`, and `query` is the question, or `""` for a bare call.
- **Removed:** `ORIENTATION`, `composeAnswer`, `buildLinks`, `MAX_FAQ` and `MAX_GLOSSARY`. The new bounds are `MAX_ENTRIES = 3` and `MAX_CANDIDATES = 5`.

**Description:**
- unchanged in purpose;
- it adds "pass `keywords` with your reading of the question, and `entryIds` to fetch a candidate it returned";
- it says the result renders to the user as a help block.

**Capability** (`builtin-toolpacks.ts:2043-2054`): `resultKind: "help"`; everything else is unchanged (pure, free, value).

**Mirror** (`:891-895`): `objectSchema({question: stringField(…), keywords: stringArrayField(…), entryIds: stringArrayField(…)})`, using the existing helpers (`builtin-toolpacks.ts:122-136`). Its description is updated, and the parity test holds the keys.

### `apps/api/src/services/portal.service.ts` → `resolveDisplayBlock`

A new arm before data-table: `resultKind === "help"`. It runs `HelpBlockContentSchema.safeParse(toolResult)`, then returns `{block: {type: "help", content}, sseResult: content}`. A result that fails the parse makes no block. `RESULT_BLOCK_TYPES` is unchanged.

### `apps/api/src/prompts/system.prompt.ts` → `PACK_PROMPT_SECTIONS.help`

- `blocks: ["help entries"]`; the markers are unchanged.
- The routing paragraph is unchanged, apart from "pass your reading of the question as `keywords`".
- The relay paragraph is replaced:
  > "`platform_help`'s result is shown to the user as a help block that quotes the entries exactly, with links into Help. Don't repeat or rephrase the entries, and don't add claims about how the product behaves: at most one sentence pointing at the block, or naming a `candidates` title to ask about next. When `noMatch` is true, say no help entry covers it and point at Help."

### `apps/web`

- **`src/utils/portal-stream.util.ts` → `streamingBlockFor`:** `type === "help"` returns `{type: "help", content: result}`.
- **`src/components/HelpBlock.component.tsx` (new, pure UI, `HelpBlockUI` only):** takes `content: HelpBlockContent` and `linkComponent`.
  - **Each entry:** a surface label (FAQ / Glossary / Troubleshooting), the title, the body as **plain text** (`white-space: pre-line`, no markdown, so it's byte-identical), and "Open in Help" (a router link to `url`).
  - **Candidates:** a "Related:" list of links.
  - **`noMatch`:** "No help entry covers this." plus "Browse Help" linking to `helpUrl`.
  - **Structure:** the block is a `section` named "Help". Titles are `strong` text, not headings, since the portal log owns no heading level.
- **`src/utils/help-block-renderer.util.tsx` (new):** `registerHelpBlockRenderer()` registers `"help"`, passing `RouterLink`. Invalid content (`safeParse` fails) renders nothing. It's called from `main.tsx` beside the other three.
- **`src/views/Help.view.tsx`:**
  - The tab index map gains Troubleshooting (index 3).
  - Search uses `searchHelp(query, {surfaces: [activeSurface], category})` when the query has tokens, in score order. An empty query keeps today's array order and category filter.
  - A new `TroubleshootingList.component.tsx` (`TroubleshootingListUI`) renders accordions with `id troubleshooting-entry-<slug>`.
- **`src/utils/routes.util.ts`:**
  - `HelpTab.Troubleshooting`;
  - `HELP_TAB_INDEX` 3;
  - `HelpAnchorSurface` includes it;
  - the prefix `"troubleshooting-entry-"`, with `parseHelpAnchor` looping over three surfaces;
  - no categories.

## Migration
## Seed

There's no database change: help blocks live in `portal_messages.blocks` (jsonb), and nothing is pinnable.

## TDD test plan

Run each package's tests with its npm scripts: `cd packages/core && npm run test:unit`, `cd apps/api && npm run test:unit`, and `cd apps/web && npm run test:unit`.

### packages/core

**`__tests__/content/help-search.util.test.ts` (new):**
- **Tokenizing:** lowercase; stopwords dropped; `"stations"`→`"station"`, `"importing"`→`"import"`, `"queries"`→`"query"`. Count: 4.
- **Ranking:** a title hit outranks a body-only hit; an alias hit counts like a title; keywords add to the score; `surfaces` and `category` filter; ties order deterministically; an empty query returns `[]`; the floor drops noise. Count: 7.
- **Corpus:** `HELP_CORPUS` has exactly every FAQ, glossary and troubleshooting entry, with slugs unique per surface. `findHelpDocument` round-trips, and `helpDocumentUrl` matches `buildHelpUrl`. Count: 3.

**`__tests__/content/help-findability.test.ts` (new): the guards.**
- **Self-retrieval:** for every corpus document, `searchHelp(doc.title)[0].doc` is that document. It's table-driven, so a new entry is covered automatically.
- **Paraphrase eval:** the fixture `__tests__/content/fixtures/help-paraphrases.ts` holds about 30 `{query, expect: "<surface>:<slug>"}` pairs, each in the **top 3**. It's seeded with:
  - "How do I bring in a spreadsheet?"
  - "What is a portal?"
  - "How do I create a station?"
  - "why can't I see any data"
  - "my sync failed"
  - "it says I don't have permission"
- **Nonsense fixture:** about 6 queries ("zzzz qqqq", "weather in paris", …), each returning `[]` (the floor).
- Count: 3 table-driven tests.

**Other core tests:**
- `troubleshooting.util.test.ts`: every entry has a non-empty symptom, cause and fix; slugs are unique; `related` titles exist in their surface. Count: 3.
- `help-url.util.test.ts`: `HELP_TAB` now has four keys, and a troubleshooting entry URL. Count: 2, edited.
- `content-purity.test.ts`: the new modules are listed, and relative-only imports are allowed. Count: 1, edited.
- `models/tool-capability.test` (or `registries/tool-capabilities.test.ts`): `help` value production parses; a custom tool declaring `help` is refused; `platform_help`'s kind is `help`. Count: 3.
- `contracts/help-block.contract.test.ts`: the schema bounds (entries ≤3, candidates ≤5). Count: 2.

### apps/api

**`__tests__/tools/platform-help.tool.test.ts`:** rewritten.
- "How do I bring in a spreadsheet?" returns the File Upload FAQ first.
- `entries[].body` is byte-identical to the corpus field (the output invariant, over every paraphrase).
- `candidates` carries titles only.
- `entryIds` fetch, and an unknown id is ignored.
- A no-match has `noMatch`, no entries and a `helpUrl`.
- A bare call returns the Getting Started entries.
- The result passes `HelpBlockContentSchema`.
- It never reads the database (kept).
- Count: 8.

**Other api tests:**
- `services/portal.service.test.ts`: a `help` result becomes a `help` block (live and replay), and an invalid one makes no block. Count: 2.
- `prompts/system.prompt.test.ts`: `## Help` says "help block" and "don't repeat or rephrase", the old relay pins are replaced, and the Response Style line includes "help entries". Count: 3, edited.
- `builtin-toolpack-schema-parity.test.ts`: passes with the new mirror (no edit).

### apps/web

- **`__tests__/HelpBlock.test.tsx` (new):**
  - entries render their body verbatim (`textContent` equality);
  - links go to `url`, candidates render as links;
  - a no-match shows its message and "Browse Help";
  - axe passes on a block with entries and on a no-match block.
  - Count: 5.
- **`__tests__/portal-stream.util.test.ts`:** maps a `help` result. Count: 1.
- **`__tests__/routes.util.test.ts`, `HelpRoute.test.tsx`:** the troubleshooting tab and anchor round-trip. Count: 3.
- **`__tests__/HelpView.test.tsx`:** "bring in a spreadsheet" lists File Upload first on FAQ; an empty query keeps array order; a troubleshooting anchor expands its entry. Count: 3.
- **`__tests__/TroubleshootingList.test.tsx` (new):** renders entries, expansion is controlled, axe passes. Count: 3.

**Totals ≈ 70 cases:** core ~33, api ~13, web ~15, plus the table-driven guards over every entry.

## Acceptance criteria

- [ ] In a portal session, "How do I bring in a spreadsheet?" shows a help block whose first entry is the File Upload FAQ, with its Help link.
- [ ] The Help page's FAQ search for the same words lists the same entry first.
- [ ] `/help?tab=troubleshooting#troubleshooting-entry-<slug>` opens the Troubleshooting tab with that entry expanded, and a portal answer can link to it.
- [ ] The block's entry text is byte-identical to the content entry. The assistant's own text sits outside the block.
- [ ] A product question nothing covers shows "No help entry covers this." with a link to Help, and describes no behaviour.
- [ ] A result never carries more than 3 bodies and 5 candidate titles.
- [ ] Adding an entry (with optional aliases) to any of the three arrays, and nothing else, makes it findable in a session and on the Help page, and the self-retrieval test covers it.
- [ ] CI fails when an entry isn't found by its own title, a paraphrase misses its slug, or a tool body isn't corpus text.
- [ ] A custom toolpack can't declare `resultKind: "help"`.
- [ ] The tool stays free, and is entitled on every tier through the Help pack.
- [ ] The marketing site's FAQ JSON-LD and glossary are unchanged.

## Risks & rollback

- **Ranking quality:** the floor or weights could under- or over-match. The paraphrase and nonsense fixtures pin the behaviour, and tuning is a constant change.
- **A new result kind, end to end:** an old web client meeting a `help` block renders nothing (`hasBlockRenderer` is false), and the model's framing sentence still points at Help. That degrades gracefully.
- **Rollback:** revert the PR. Stored `help` blocks in transcripts then render nothing, which is acceptable for a revert.

## Files touched

- **core:**
  - `content/help-search.util.ts` (new), `content/troubleshooting.util.ts` (new)
  - `content/faq.util.ts`, `content/glossary.util.ts` (aliases), `content/help-url.util.ts`, `content/index.ts`
  - `models/tool-capability.model.ts`, `contracts/help-block.contract.ts` (new), `contracts/portal.contract.ts`, `contracts/index.ts`
  - `registries/builtin-toolpacks.ts`
  - tests as listed
- **api:**
  - `tools/platform-help.tool.ts`, `services/portal.service.ts`, `prompts/system.prompt.ts`, `config/swagger.config.ts`
  - tests as listed
- **web:**
  - `components/HelpBlock.component.tsx` (new), `components/TroubleshootingList.component.tsx` (new)
  - `utils/help-block-renderer.util.tsx` (new), `utils/portal-stream.util.ts`, `utils/routes.util.ts`
  - `views/Help.view.tsx`, `main.tsx`
  - tests as listed
- **docs:** `CLAUDE.md` (the documentation inventory gains troubleshooting, and the tool surfaces line).

## Next step

`docs/RANKED_PLATFORM_HELP.plan.md` lands this in five slices:
1. the ranker, corpus, aliases and findability guards (core);
2. the troubleshooting content and Help URL grammar (core) plus its Help tab (web);
3. Help search on the ranker (web);
4. the tool contract, the `help` result kind and the server block (core and api);
5. the block renderer, stream mapping, prompt and docs (web, api and docs).
