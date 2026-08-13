# Portal best-practices content — Spec

**Issue:** [EnterpriseBT/portal-ai#366](https://github.com/EnterpriseBT/portal-ai/issues/366) · **Epic:** [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · **Discovery:** `docs/PORTAL_BEST_PRACTICES_CONTENT.discovery.md` · branch `feat/portal-best-practices-content` → base `epic/portal-guidance`

This spec pins the **exact copy**. On a content ticket the words are the contract — three surfaces render this module verbatim (Help view, marketing-site JSON-LD, and #367's assistant), so reviewing the wording here is cheaper than reviewing it in a diff. Every string below is final text, not a paraphrase.

## Key decisions (flag for review)

Discovery decisions D1–D5 and open questions Q1–Q5 are ratified as their leans:

- **D1 — no new category.** The portal cluster stays in `GlossaryCategory.Analytics`. #365 froze the `?category=` grammar on `analytics` being a member of both enums; a glossary-only `portals` category breaks that symmetry.
- **D2 — practices live in `definition` prose** on the terms they belong to, plus matching FAQ questions.
- **D3 — prose and `**bold**` only.** No bullet lists (no `ul`/`li` styling in `GlossaryProse`, `GlossaryList.component.tsx:24-67`), no fenced code. **Refinement:** inline backticks are precedented (`Tool:256`) and render fine, but the new copy avoids them anyway — `definition` ships verbatim into the marketing site's JSON-LD (`features.astro:66-72`), and plain wording reads correctly in both places.
- **D4 — one practice per term**, not all on `Portal`. The tool-pack practice is **cross-linked, never repeated** — `Tool Pack:265` already states it.
- **D5 — the four misfiled billing questions are physically moved** out of the `// Analytics & Portals` comment block. Their `FAQCategory.GettingStarted` tags are **not** changed; nothing user-visible moves.
- **Q1 — the job-lock practice ships as an FAQ question**, not glossary prose: it's situational troubleshooting, not vocabulary.
- **Q2 — `Query Handle` is left alone.** **Q3 — the anchor practice leads with plain language**, naming `Entity Record` via `relatedTerms` rather than inline jargon. **Q4 — the drifted FAQ pin is corrected here.** **Q5 — `getting-started.util.ts` is untouched.**
- **Audience (confirmed on the ticket): both.** A signed-out marketing-site reader must understand the concept; a logged-in user must be able to act on it. No "click the X button" phrasing in glossary copy, no assumed account.
- **Accuracy is the enterprise dimension with teeth** (discovery → Enterprise-scale): every practice must describe behavior that actually ships. The job-lock claim is verified against `CLAUDE.md` → Async Job State & Data Locking.
- **Term strings are frozen.** No renames: they key `GLOSSARY_PAGE_ROUTES` (`glossary-routes.util.ts:18-54`) and derive the `#glossary-entry-<slug>` anchors #365 shipped.

## Scope

### In scope

1. Extended `definition` prose on `Portal`, `Portal Message`, `Portal Result` in `packages/core/src/content/glossary.util.ts`.
2. New `relatedTerms` edges on those three entries.
3. Three new FAQ entries under `FAQCategory.Analytics` in `packages/core/src/content/faq.util.ts`.
4. Physical reorder of the four misfiled billing questions.
5. Pinning-test updates in `packages/core/src/__tests__/content/` — the corrected `expectedQuestions` array plus a new Analytics count assertion.

### Out of scope

- A `GlossaryCategory.Portals` category; any term rename; any term moved between categories.
- Glossary entries outside the portal cluster; `Query Handle`; `getting-started.util.ts`.
- Retagging the billing questions (a user-visible regrouping deserves its own decision).
- `apps/web` and `apps/site` code — no consumer changes; `ul`/`li` styling for `GlossaryProse` is deliberately not added.
- The `assistant` tool (#367) that reads this content.

## Surface

### `packages/core/src/content/glossary.util.ts` — `Portal` (`:297-305`)

`term`, `category`, `example` unchanged. `definition` and `relatedTerms` become:

```ts
definition:
  "A chat session where you ask questions about the data in a station; the assistant answers using the station's tool packs. A portal is only as good as the data behind it: the assistant answers from the records a station has actually imported, not from general knowledge, so a station with no connected source — or one whose records haven't been imported yet — can only answer in generalities. Ask about one thing at a time, too. A narrow question routes cleanly to the right tool; a compound one gives the assistant several jobs at once and no clear place to start.",
relatedTerms: [
  "Station",
  "Portal Message",
  "Portal Result",
  "Entity Record",
  "Connector Instance",
  "Tool Pack",
],
```

`Entity Record` and `Connector Instance` carry the prerequisite without spending jargon inline (Q3); `Tool Pack` is the cross-link that keeps "attach only what the station needs" single-sourced at `:265` (D4).

### `Portal Message` (`:306-314`)

```ts
definition:
  "A single user prompt or assistant reply within a portal session. Word your prompts in the station's own vocabulary: name entities, columns, and values the way they appear in your data, because the assistant matches what you ask against the station's actual schema. Asking for \"churn by plan tier\" works when those are the real names; when the column is called subscription level, say that instead.",
relatedTerms: ["Portal", "Portal Result", "Station", "Entity Record"],
```

### `Portal Result` (`:315-323`)

```ts
definition:
  "A piece of structured output — a chart, table, or text block — produced by the assistant in a portal message. Treat the ones worth keeping as durable output rather than chat history: pin a result and it stays one click away from the dashboard, and pinned charts and tables reload live data when you open them instead of freezing the numbers from the day you asked.",
relatedTerms: ["Portal", "Portal Message", "Pinned Result"],
```

The pinning claim is verified against `Pinned Result:337` ("remember the query behind them, so opening one shows live data").

### `packages/core/src/content/faq.util.ts` — three new entries

Appended to the `// Analytics & Portals` block (`:155`), **before** the moved billing questions. Answers are plain text — `FAQList` renders with `whiteSpace: "pre-line"`, so no markdown.

```ts
{
  question: "Why are the assistant's answers vague or missing my data?",
  answer:
    "Almost always because the station has nothing to answer from. A portal answers from records that have actually been imported into the station's entities — not from general knowledge — so a station with no connected source, or one whose sync hasn't run yet, can only answer in generalities. Open the station and check that it has a connector instance and that its entities have records. If a source is connected but empty, run a sync and wait for the job to finish, then ask again.",
  category: FAQCategory.Analytics,
  relatedGlossaryTerms: ["Portal", "Entity Record", "Connector Instance", "Station"],
},
{
  question: "How should I word my questions to get better answers?",
  answer:
    "Two things help more than anything else. Ask about one thing at a time — a narrow question routes cleanly to the right tool, while a compound one gives the assistant several jobs at once and no clear place to start. And use the station's own vocabulary: name entities, columns, and values the way they appear in your data, because that's what the assistant matches against. If your column is called subscription level, ask about subscription level rather than plan tier.",
  category: FAQCategory.Analytics,
  relatedGlossaryTerms: ["Portal", "Portal Message", "Station"],
},
{
  question: "Why does the assistant say my data is incomplete while an import is running?",
  answer:
    "Because it is, for now. While a background job is importing or syncing a connector instance, that data is still arriving and the records it owns are read-only — syncing, editing fields, and deleting are paused until the job finishes, and the station's detail page says so while it runs. Ask again once the job reaches a terminal state and the answer will reflect the full data. Checking for a running job is worth doing before you trust a number that looks off.",
  category: FAQCategory.Analytics,
  relatedGlossaryTerms: ["Job Status", "Portal", "Connector Instance"],
},
```

Every `relatedGlossaryTerms` value above resolves to an existing term — enforced by `faq.util.test.ts:104-113`.

### Billing-question reorder (D5)

The four entries at `faq.util.ts:224-250` — "How do I upgrade my plan?", "Who can manage billing?", "My plan says it's managed — what does that mean?", "Why is a toolpack marked "Inactive on your plan"?" — move **above** the `// Analytics & Portals` comment (`:155`), into the Getting Started block they are tagged for. **No field changes**: same questions, same answers, same `FAQCategory.GettingStarted`, same `relatedGlossaryTerms`. Array order is not semantic — `filterFAQ` (`:276`) and `groupEntries` (`FAQList.component.tsx:24-37`) both bucket by `category` — so this is source hygiene with zero rendered difference.

### `packages/core/src/__tests__/content/faq.util.test.ts` — the corrected pin

`expectedQuestions` (`:51-79`) today asserts its own literal length is 22 while listing only 4 of the 8 Analytics questions — a floor, not a fence, and drifted. It becomes **29** entries: the existing 22, plus the 4 Analytics questions that were never pinned, plus the 3 new ones. The `// Analytics & Portals (4)` comment becomes `(11)`, and the assertion name changes from "(22 total)" to "(29 total)".

Newly pinned (previously missing): "Why do some results appear inline and others as a separate streamed table?", "How do I refresh a chart, map, or table with the latest data?", "Can I show my data on a map?", "Do failed tool calls use up my usage allocation?".

A category count assertion is added, mirroring the Jobs one at `:153-161`:

```ts
it("has 11 Analytics & Portals questions", () => {
  expect(FAQ_ENTRIES.filter((e) => e.category === FAQCategory.Analytics)).toHaveLength(11);
});
```

### `packages/core/src/__tests__/content/glossary.util.test.ts`

No structural change is required — no term is added, renamed, or moved, so the Analytics term list (`:186-211`), `expectedTerms` (`:58-97`), and the slug pins (`:268-295`) all still hold. New assertions are added for the guidance itself (below).

## Migration / Seed

None — this ticket changes two data modules and their tests. No DB schema, no seed, no API route, no migration. Stated explicitly because the house template asks.

## TDD test plan

Run via npm scripts only (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`. Never raw jest.

### Layer 1 — glossary content (`packages/core/src/__tests__/content/glossary.util.test.ts`)

1. `Portal`'s definition states the entity-data prerequisite — matches `/only as good as the data behind it/i` and mentions imported records.
2. `Portal`'s definition carries the one-thing-at-a-time practice (`/one thing at a time/i`).
3. `Portal Message`'s definition carries the station-vocabulary practice (`/vocabulary/i` + `/columns/i`).
4. `Portal Result`'s definition carries the pinning practice (`/pin/i` + `/live data/i`).
5. Each of the three edited entries is **longer than its pre-#366 length** and still a single string (guards against an entry being replaced rather than extended).
6. The new `relatedTerms` edges exist and resolve: `Portal` → `Entity Record`, `Connector Instance`, `Tool Pack`; `Portal Message` → `Station`, `Entity Record`; `Portal Result` → `Portal Message`. (Global resolution is already covered at `:120-126`.)
7. **The tool-pack practice is not duplicated** — only `Tool Pack`'s definition contains "only attach the packs"; the portal-cluster entries cross-link instead.
8. **No markdown lists or fenced code** in any edited entry (`definition` matches neither `/^\s*[-*] /m` nor /```/) — the constraint D3 names, asserted rather than trusted.
9. No term was renamed: the three terms still exist with their exact strings (already covered by `expectedTerms`, restated for intent).

### Layer 2 — FAQ content (`packages/core/src/__tests__/content/faq.util.test.ts`)

10. `expectedQuestions` has 29 entries and every one resolves (the amended existing case).
11. Exactly 11 entries carry `FAQCategory.Analytics` (new count assertion).
12. Each of the three new questions exists, is tagged `Analytics`, and has a non-empty answer.
13. The three new answers contain **no markdown** (no backticks, no `**`, no leading `-`) — FAQ renders plain text.
14. The four billing questions are still tagged `FAQCategory.GettingStarted` after the reorder — the guard that D5 stayed a move and not a retag.
15. Every new `relatedGlossaryTerms` value resolves against `GLOSSARY_ENTRIES` (covered globally at `:104-113`; the new entries are inside that sweep).

### Layer 3 — searchability (`glossary.util.test.ts` / `faq.util.test.ts`)

The issue's acceptance criteria name the phrases a confused user would actually type; `filterGlossary` (`:411`) and `filterFAQ` (`:276`) both match on term/definition and question/answer substrings.

16. `filterGlossary(GLOSSARY_ENTRIES, { query: "imported" })` returns the `Portal` entry.
17. `filterFAQ(FAQ_ENTRIES, { query: "vague" })` returns the new vagueness question.
18. `filterFAQ(FAQ_ENTRIES, { query: "word my questions" })` returns the wording question.
19. `filterFAQ(FAQ_ENTRIES, { query: "import" })` returns the running-job question.

### Layer 4 — no consumer regressions

20. `contentEntrySlug` pins still pass unchanged — no term string moved, so no `#glossary-entry-<slug>` anchor or `data-testid` changes (existing cases at `:268-295`).
21. `apps/web` suite green with no edits: `glossary-routes.util.test.ts` (term↔route map) and `HelpView.test.tsx:499-507` (real-content assertion) both depend on categorization and term strings, neither of which moves.

**Totals:** ~9 glossary, ~6 FAQ, ~4 search, ~2 consumer ≈ **21 cases**.

## Acceptance criteria

- [ ] All cases above pass; `packages/core` and `apps/web` suites green; `npm run lint && npm run type-check && npm run format:check` clean at the repo root.
- [ ] The Glossary tab's `Portal` entry states the entity-data prerequisite in language a non-technical reader can act on.
- [ ] Every added practice names something the reader can go do or check — not a restatement of the definition.
- [ ] Searching Help for "imported", "vague", "word my questions", and "import" surfaces the new guidance.
- [ ] The new copy renders correctly in the Glossary tab through `ReactMarkdown` — no literal `*`, backticks, or list markers visible.
- [ ] The same entries render correctly on the marketing site, whose JSON-LD carries `definition` verbatim.
- [ ] Every added `relatedTerms` / `relatedGlossaryTerms` value resolves to a real term.
- [ ] **No term is renamed**, no term changes category, and no new category is added — `#glossary-entry-<slug>` anchors and `GLOSSARY_PAGE_ROUTES` keys are unchanged.
- [ ] The four billing questions still render under Getting Started, exactly as before.
- [ ] `apps/web` and `apps/site` need no code change to display any of this.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| A practice describes behavior that doesn't ship — documentation that lies is worse than none. | Each claim is traced to a source in this spec: the pinning claim to `Pinned Result:337`, the lock claim to `CLAUDE.md` → Async Job State. The smoke walkthrough re-checks them against the running app. |
| Markdown syntax leaks into the marketing site's JSON-LD as literal `**`/backticks. | D3 forbids it and case 8 asserts it; the smoke doc inspects the rendered site output. |
| Copy edits accidentally rename a term, silently breaking a Help link or a `#glossary-entry-<slug>` anchor. | `glossary-routes.util.test.ts:17-26` fails on an orphaned key; `expectedTerms` fails on a missing term; case 9 restates it. |
| The billing reorder is mistaken for a retag and changes what renders where. | Case 14 asserts the tags survive; array order is not semantic since both consumers bucket by `category`. |
| #367 is written against wording that later changes. | The assistant reads the module at runtime, not a copy of it — wording changes propagate. Only *term strings* are frozen, and this ticket freezes them. |
| Entry length pushes the Glossary accordion into a wall of text. | The three edited definitions stay at 3–4 sentences, well inside the precedent set by `Tool`, `Tool Pack`, and `Custom Toolpack` (3–7 sentences). |

**Rollback:** `git revert`. No migration, no persisted state, no consumer code — reverting restores the prior copy on all three surfaces at the next build.

## Files touched

**`packages/core`** — edit `src/content/glossary.util.ts` (three `definition` + `relatedTerms` edits), `src/content/faq.util.ts` (three new entries + the billing reorder), `src/__tests__/content/glossary.util.test.ts`, `src/__tests__/content/faq.util.test.ts`.

No `apps/web` change, no `apps/site` change, no new dependency, no env var, no API change. Doc surfaces: none beyond the content itself — this ticket *is* the documentation change (`CLAUDE.md` → "Keeping Documentation in Sync with Capabilities" is satisfied by the work, not by an extra edit).

## Next step

`docs/PORTAL_BEST_PRACTICES_CONTENT.plan.md` — three TDD slices on this branch: (1) the glossary edits + their assertions, which is what #367 reads; (2) the FAQ additions plus the corrected `expectedQuestions` pin and the new Analytics count assertion; (3) the billing-block reorder with its retag guard. Each is independently green, and none touches a consumer package.
