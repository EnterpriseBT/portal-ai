# Portal best-practices content — Discovery

**Issue:** [EnterpriseBT/portal-ai#366](https://github.com/EnterpriseBT/portal-ai/issues/366) · child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · branch `feat/portal-best-practices-content` off `epic/portal-guidance`

**Why this exists.** The glossary tells a reader *what* a portal is and stops there. `Portal` (`glossary.util.ts:298-305`) is one sentence — "A chat session where you ask questions about the data in a station; the assistant answers using the station's tool packs" — plus a one-line example. Someone who has connected nothing, or whose station has no materialized entity records, opens a session, gets thin answers, and is told nothing about why. The vocabulary is accurate and useless.

Adjacent entries already show the house fix. `Tool Pack` (`:264-267`) closes with "keep packs small and focused on a single domain, and only attach the packs a station absolutely needs". `Tool` (`:256`) closes with "Use connectors for data storage and lookup; reach for tools when the answer requires computation, not retrieval". These are definitions that carry a practice. This ticket extends the portal cluster the same way — and it is the content layer of epic #364: the same module feeds the Help view, the public marketing site (#311), and the `assistant` tool (#367), so one edit lands on three surfaces.

## The current shape

### The portal cluster

| Term | Location | Today | `relatedTerms` |
|---|---|---|---|
| `Station` | `glossary.util.ts:239-251` | Groups connector instances + tool packs for analysis | Connector Instance, Tool Pack, Portal, Default Station |
| `Portal` | `:298-305` | One sentence + one example | Station, Portal Message, Portal Result |
| `Portal Message` | `:307-314` | "A single user prompt or assistant reply within a portal session." | Portal, Portal Result |
| `Portal Result` | `:316-323` | "A piece of structured output — a chart, table, or text block…" | Portal, Pinned Result |
| `Pinned Result` | `:334-341` | Saved for quick access from the dashboard | Portal Result, Default Station |
| `Query Handle` | `:325-332` | Reference to a result set too large to show inline | Portal Result |
| `Entity Record` | `:100-107` (DataSources) | "A single row of data inside a connector entity" | Connector Entity, Normalized Data, Sync |

Entry shape is `{term, category, definition, example?, relatedTerms?, pageRoute?}` (`:59-66`). A typical entry is 1–2 sentences of definition plus one example; the Analytics outliers (`Tool`, `Tool Pack`, `Plan Entitlement`, `Custom Toolpack`, `Signing Secret`) run 3–7 sentences, so the length this ticket needs is precedented.

**There is no `Portals` category.** Portal vocabulary sits under `GlossaryCategory.Analytics` (`:49-55`). Only the FAQ side carries the combined label — `Analytics: "Analytics & Portals"` (`faq.util.ts:19-25`).

### Formatting, and what actually renders

`GlossaryProse` (`GlossaryList.component.tsx:24-67`) runs `definition` and `example` through `ReactMarkdown` with styles for `p`, `code`, `pre`, `pre code`, and `strong`. **There is no `ul`/`li` styling**, so a markdown bullet list renders as browser-default inside the accordion. Precedent in the dataset: fenced code (`Signing Secret`, `:289-295`), inline backticks (several), and `*emphasis*` / `**bold**` (`Plan Entitlement`, `:274`). No entry uses a list.

FAQ answers render as **plain text** with `whiteSpace: "pre-line"` — markdown there would show as literal characters.

### The three consumer surfaces

| Surface | What it reads | Note |
|---|---|---|
| Help view | full entries | `GlossaryList` / `FAQList` (via `FAQEntryAccordion.component`) |
| Marketing site | `term` + `definition` **only** | `features.astro:66-72` feeds `GLOSSARY_ENTRIES.map(e => ({term, definition}))` into `definedTermSetLd` (`jsonld.ts:101-118`); `faqPageLd()` (`:73-83`) from `FAQ_ENTRIES`. **No page renders this as visible HTML** — `features.astro:9` says outright "this page sells the product, it is not a glossary" |
| Assistant (#367) | not yet built | consumes the same module as its knowledge source |

The marketing consumption matters more than it looks: `definition` goes into **JSON-LD structured data verbatim**, so any markdown syntax in it ships as literal `**` and backticks to search engines.

### FAQ, and a filing bug next door

`FAQCategory.Analytics` holds 8 questions today (comment block at `faq.util.ts:155`): "What are tool packs?" (`:157`), the greyed-out-pack one (`:164`), "How do I save results from a portal session?" (`:172`), "What's the difference between a portal and a portal result?" (`:179`), the inline-vs-streamed one (`:191`), "How do I refresh a chart, map, or table…" (`:199`), "Can I show my data on a map?" (`:206`), "Do failed tool calls use up my usage allocation?" (`:218`).

Four billing questions physically sit **inside** that comment block but are tagged `FAQCategory.GettingStarted`, so they render under a different tab than they appear to belong to in source: "How do I upgrade my plan?" (`:224-229`), "Who can manage billing?" (`:231-236`), "My plan says it's managed…" (`:238-243`), "Why is a toolpack marked 'Inactive on your plan'?" (`:245-250`).

### The tests that will move

`glossary.util.test.ts` pins the category enum (`:13-31`), labels (`:34-50`), an `expectedTerms` list that tolerates extras (`:58-97`), non-empty fields (`:105-111`), **`relatedTerms` resolvability** (`:120-126`), zero `pageRoute` (`:132-137`), term uniqueness (`:139-146`), the slug equivalence added in #365 (`:268-295`), and — critically — **a hard-coded sorted list of every Analytics-category term** (`:186-211`).

`faq.util.test.ts` pins a hard-coded `expectedQuestions` array asserting **exactly 22 total** (`:51-87`), `relatedGlossaryTerms` resolution (`:104-113`), question uniqueness (`:115-122`), and an exact count of 2 for `FAQCategory.Jobs` (`:153-161`). The survey found the pinned Analytics questions in that array have drifted from the dataset — the test lists 4 where the module has 8.

`glossary-routes.util.test.ts:17-26` asserts `GLOSSARY_PAGE_ROUTES` (`glossary-routes.util.ts:18-54`, keyed on the **exact term string**) has no orphaned keys — so a rename fails CI rather than silently dropping an in-app link. `HelpView.test.tsx:499-507` contains a real-content assertion ("`Job Status` is a System term…"), so a category move can break a view test too.

## The design space

### Decision 1 — A `Portals` category, or extend the Analytics entries

**A. Extend the existing Analytics entries.** No schema change, no term moves.
**B. Add `GlossaryCategory.Portals`** and move the portal cluster into it.

| | A — extend Analytics | B — new `Portals` category |
|---|---|---|
| Code cost | none | one `GLOSSARY_CATEGORY_LABELS` entry; chips auto-render from `Object.values` (`Help.view.tsx:270`), `?category=` auto-accepts (`routes.util.ts:92-116`) |
| Discoverability | portal terms stay mixed with tooling/billing terms | a real "Portals" chip |
| Test churn | none from categorization | rewrites the hard-coded Analytics list (`:186-211`), risks `HelpView.test.tsx:499-507` |
| Cross-enum symmetry | preserved — `analytics` is a member of **both** enums, which is what `/help?tab=faq&category=analytics` relies on | breaks it: a glossary-only `portals` category means `?tab=faq&category=portals` silently drops the category |
| Parity with FAQ | matches the existing "Analytics & Portals" label | FAQ would need a matching category to stay in step |

**Lean: A.** #365 froze the `?category=` grammar three days ago on the fact that `analytics` exists in both enums; introducing a glossary-only category immediately puts an asymmetry into a contract that #367 is about to build links against. B is a reasonable future move — but it should be its own ticket, taken with the FAQ side, not smuggled into a copy change.

### Decision 2 — Where the practices live

**A. Extend `definition` prose** on `Portal` / `Portal Message` / `Portal Result` (the issue's deliverable).
**B. A dedicated hub entry** (e.g. "Portal Best Practices").
**C. FAQ only**, with the glossary merely cross-linking.

**Lean: A, plus matching FAQ questions.** B is a document wearing a term's clothing — the glossary defines vocabulary, and a reader scanning for "Portal" should find the guidance *there*, not one hop away. C loses the marketing surface entirely, since the site consumes glossary `definition` and only the FAQ's question/answer.

### Decision 3 — How much markdown

**Lean: prose and `**bold**` only — no bullet lists, no fenced code.** Two independent reasons: the in-app renderer has no `ul`/`li` styling (`GlossaryList.component.tsx:24-67`), and `definition` ships verbatim into the marketing site's JSON-LD (`features.astro:66-72`), where markdown syntax becomes literal noise in structured data. Bold is already precedented (`Plan Entitlement`, `:274`) and survives both.

### Decision 4 — Distribution of the four confirmed practices

The confirmed set is: **(i)** ask one thing at a time, **(ii)** use the station's own vocabulary, **(iii)** attach only the tool packs the station needs, **(iv)** pin what's worth keeping — plus the anchor practice, that a session is only as good as the entity data behind it.

**Lean: attach each practice to the term it belongs to** rather than piling them onto `Portal`: the anchor practice and (i) on `Portal`; (ii) on `Portal Message` (vocabulary is a property of how you phrase a message); (iv) on `Portal Result`, cross-linked to `Pinned Result`; (iii) **cross-linked, not repeated** — `Tool Pack:264-267` already says it, and duplicating guidance means two copies to keep true.

### Decision 5 — The misfiled billing questions

**A. Leave them.** **B. Physically move them** out of the "Analytics & Portals" comment block into the Getting Started section — source hygiene, zero behavior change. **C. Retag them `Analytics`** — changes which tab they render under.

**Lean: B.** C would put "How do I upgrade my plan?" under Analytics & Portals, which is wrong for the reader; A leaves a trap for the next person editing this block (this ticket is exactly that person). B is a comment-block reorder with no user-visible effect and no test change.

## Tradeoff comparison

|  | D1 extend Analytics | D2 prose in entries | D3 no lists | D4 distribute | D5 reorder |
|---|---|---|---|---|---|
| Touches `apps/web` | No | No | No | No | No |
| Test churn | none | `expectedTerms` unaffected; `relatedTerms` resolution matters | none | none | none |
| Reversible | Yes | Yes | Yes | Yes | Yes |
| Blocks #367 if wrong | Yes — it's the link target | No | No | No | No |

## Recommendation

1. Extend the existing `GlossaryCategory.Analytics` entries. **No new category, no term renames, no term moves** — a rename breaks `GLOSSARY_PAGE_ROUTES` and every `#glossary-entry-<slug>` anchor #365 just shipped.
2. Write the practices into `definition` prose on `Portal`, `Portal Message`, and `Portal Result`, with the entity-data prerequisite as the anchor on `Portal`.
3. Cross-link rather than repeat: add `relatedTerms` reaching `Entity Record`, `Connector Instance`, `Tool Pack`, and `Pinned Result`, so the "attach only what you need" practice stays single-sourced on `Tool Pack`.
4. Prose and bold only. No bullet lists, no fenced code — the accordion has no list styling and `definition` ships verbatim into the marketing site's JSON-LD.
5. Address **both audiences** (confirmed on the ticket): a signed-out visitor must understand the concept, a logged-in user must be able to act on it. No "click the X button" phrasing, no assumed account.
6. Add matching FAQ questions under `FAQCategory.Analytics`, phrased the way a confused user would type them, in plain text with no markdown.
7. Physically move the four misfiled billing questions out of the "Analytics & Portals" comment block; leave their `GettingStarted` tags alone.
8. Update the pinning tests: add the new questions to `expectedQuestions`, correct its drifted Analytics entries, and add an Analytics count assertion mirroring the Jobs one (`faq.util.test.ts:153-161`).

## Open questions

1. **The fifth proposed practice — "check for a running job before expecting fresh answers".** It was in the PRD's proposed list but wasn't among the four confirmed. It is *true* (CLAUDE.md → Async Job State: a locked entity is read-only mid-import) and it is genuinely actionable. **Lean: include it, but as an FAQ question rather than glossary prose** — it's situational troubleshooting ("why is my data incomplete?"), not vocabulary, and the FAQ is where a confused user goes.
2. **Does `Query Handle` need guidance too?** It's in the portal cluster and currently definition-only. **Lean: no.** It describes a mechanism the user doesn't choose; there's no practice to recommend. Leave it.
3. **How specific may the anchor practice get about materialization?** "Materialized into entity records" is precise but jargon-heavy for a marketing-site reader. **Lean: lead with the plain-language version** ("the station needs a connected source whose records have actually been imported") and name `Entity Record` via `relatedTerms` rather than leaning on the term inline.
4. **Should the drifted `faq.util.test.ts` count comment be fixed here?** The test asserts 22 total while its inline commentary implies a different Analytics count. **Lean: yes, fix it in this ticket** — this branch is already editing that array, and leaving a knowingly-wrong pin for the next contributor is the same class of bug this epic exists to fix.
5. **Do the new practices need to be reflected in `getting-started.util.ts`?** The onboarding steps are a different surface with their own CTA model. **Lean: no** — explicitly out of scope on both this ticket and the epic.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because this is static module data compiled into the bundle; there is no write path, no shared state, no ordering.
- **Accuracy & auditability** — the one dimension with teeth. **Lean: every practice must describe behavior that actually ships.** A recommendation is a documentation claim (CLAUDE.md → "Keeping Documentation in Sync with Capabilities"), and content asserting something the agent doesn't do is a bug in this PR, not a copy nit. The job-lock practice in Q1 is the one to verify against `TERMINAL_JOB_STATUSES` semantics before writing it.
- **Failure modes** — N/A because content cannot fail at runtime; the module has no imports by design (the purity guard covers it).
- **Scale & unbounded growth** — N/A at this size, with one note: the glossary is shipped in full to the marketing site's JSON-LD, so entries are page weight on a public page. A few paragraphs is nothing; a glossary that grows tenfold would want pagination on that surface. Not now.
- **Multi-tenancy** — Help content is identical for every org, and must stay that way. **Lean: no practice may reference org-specific state** (a tier, a quota, a specific connector the reader may not have). Guidance is written to be true for every tenant.
- **Contract stability** — **Lean: term strings are frozen.** Since #365 they are a three-way contract — `GLOSSARY_PAGE_ROUTES` keys on them, `contentEntrySlug` derives `#glossary-entry-<slug>` anchors from them, and #367 will build links from those anchors. Editing a `definition` is free; renaming a `term` breaks live URLs. Adding entries is safe (slug pins catch a collision).
- **Data lifecycle** — N/A because nothing is persisted or versioned; content ships with the build.

## What this doesn't decide

- Whether a `Portals` glossary category should ever exist. D1 defers it, and doing it properly means moving the FAQ side too so `?category=` stays symmetric — that's a contract ticket, not a copy ticket.
- Rewriting glossary entries outside the portal cluster. The tone precedents (`Tool`, `Tool Pack`, `Custom Toolpack`) are already right; the rest of the dataset isn't this ticket's problem.
- The `assistant` tool that consumes this content — #367.
- Retagging the misfiled billing questions (D5 option C). A user-visible regrouping deserves its own decision, not a drive-by in a portals ticket.
- Restructuring `getting-started.util.ts`, and any marketing-site layout or copy beyond what falls out of the shared module.
- Adding `ul`/`li` styling to `GlossaryProse` so future entries can use lists. Real, but it's an `apps/web` change and D3 removes the need here.

## Next step

`docs/PORTAL_BEST_PRACTICES_CONTENT.spec.md` pins the exact copy — the final wording of each edited `definition`, the new `relatedTerms` edges, the new FAQ question/answer pairs and their category, and the test-pin updates — since on a content ticket the copy *is* the contract and reviewing it in the spec is cheaper than reviewing it in a diff. Then `.plan.md` slices it, likely into three commits: (1) glossary entries + `relatedTerms` + their pins; (2) FAQ questions + the corrected `expectedQuestions` array and the new Analytics count assertion; (3) the billing-block reorder. Each is independently green, and slice 1 is the one #367 reads.
