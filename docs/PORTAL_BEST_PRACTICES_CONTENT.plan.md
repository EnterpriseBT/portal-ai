# Portal best-practices content — Plan

**TDD-sequenced implementation of the portal guidance: the three glossary entries that carry the practices, the three FAQ questions that answer them in a confused user's words, and the source-hygiene fix to the misfiled billing block.**

Spec: `docs/PORTAL_BEST_PRACTICES_CONTENT.spec.md`. Discovery: `docs/PORTAL_BEST_PRACTICES_CONTENT.discovery.md`. Issue: #366 (epic #364). Builds on **merged #365** (`contentEntrySlug` and the slug pins now live in `@portalai/core/content`), which is on `epic/portal-guidance`.

Three slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/portal-best-practices-content`**, PR base `epic/portal-guidance` — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit      # boundary check only — no apps/web edits in this ticket
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the surface #367 reads lands first, and the pre-existing defect is fixed last so it can't be confused with the feature:

- **Slice 1** — the glossary entries. This is the content the `assistant` tool answers from, so it freezes first; nothing else in the ticket depends on it.
- **Slice 2** — the FAQ questions, plus the correction to a pinning test that was under-asserting before this ticket existed. Independent of slice 1 (different module, different test file), sequenced second only because the glossary is the higher-value surface.
- **Slice 3** — the billing-block reorder. A pre-existing filing bug, no behavior change; last so a reviewer reads it as hygiene rather than as part of the feature.

No migration, no seed, no consumer-code change (spec → *Migration / Seed*: none).

---

## Slice 1 — Glossary practices on `Portal`, `Portal Message`, `Portal Result`

The three portal-cluster definitions gain the confirmed practices and the cross-links that keep them single-sourced. This is the slice #367 consumes.

**Files**

- Edit: `packages/core/src/content/glossary.util.ts` — `definition` + `relatedTerms` on `Portal` (`:297-305`), `Portal Message` (`:306-314`), `Portal Result` (`:315-323`). Copy is pinned verbatim in the spec's *Surface*; lift it, don't re-word it.
- Edit: `packages/core/src/__tests__/content/glossary.util.test.ts` — cases 1–9, 16, 20.

**Steps**

1. **Tests (spec cases 1–9, 16, 20).** `Portal`'s definition states the entity-data prerequisite and the one-thing-at-a-time practice; `Portal Message`'s carries the station-vocabulary practice; `Portal Result`'s carries the pinning practice. Each edited definition is longer than its pre-#366 length and is still a single string. The new `relatedTerms` edges exist (`Portal` → `Entity Record`, `Connector Instance`, `Tool Pack`; `Portal Message` → `Station`, `Entity Record`; `Portal Result` → `Portal Message`). **The tool-pack practice appears only on `Tool Pack`** — the portal entries cross-link, they don't repeat it. No markdown lists or fenced code in any edited entry. `filterGlossary(GLOSSARY_ENTRIES, { query: "imported" })` returns `Portal`. Run; fail.
2. **Implement** — replace the three `definition` strings and extend the three `relatedTerms` arrays with the spec's exact text. Nothing else in the file changes. Green.
3. Run the full `packages/core` suite: the existing `relatedTerms`-resolution case (`glossary.util.test.ts:120-126`), `expectedTerms` (`:58-97`), the Analytics term list (`:186-211`), and the `contentEntrySlug` pins (`:268-295`) must all pass **unmodified** — no term string moved, so none of them should need touching.
4. Lint + type-check + `format:check`.

**Done when:** cases 1–9, 16 and 20 pass; no existing glossary assertion was edited; the three entries read as guidance a non-technical reader can act on.

**Risk:** the copy is the deliverable, so a paraphrase during implementation is a silent contract change — lift the strings from the spec verbatim. Watch that `relatedTerms` additions all resolve; a dangling edge is a broken cross-link in the UI and case `:120-126` catches it.

---

## Slice 2 — FAQ questions + the corrected pin

Three new Analytics questions, and the repair of a pinning test that has been a floor rather than a fence since before this ticket.

**Files**

- Edit: `packages/core/src/content/faq.util.ts` — three new entries appended to the `// Analytics & Portals` block (`:155`), before the billing questions slice 3 moves.
- Edit: `packages/core/src/__tests__/content/faq.util.test.ts` — `expectedQuestions` (`:51-79`) to 29 entries, the new Analytics count assertion, cases 10–13, 15, 17–19.

**Steps**

1. **Tests (spec cases 10–13, 15, 17–19).** `expectedQuestions` grows to 29 — the existing 22, the **4 Analytics questions that were never pinned**, and the 3 new ones — with its section comment corrected to `(11)` and the assertion renamed to "(29 total)". A new count assertion mirroring the Jobs one (`:153-161`) requires exactly 11 `FAQCategory.Analytics` entries. Each new question exists, is tagged `Analytics`, and has a non-empty answer containing **no markdown** (no backticks, no `**`, no leading `-`). `filterFAQ` finds them by "vague", "word my questions", and "import". Run; fail — the count assertion and the three new questions all fail before the module changes.
2. **Implement** — add the three entries with the spec's exact question/answer/`relatedGlossaryTerms`. Green.
3. Confirm the global `relatedGlossaryTerms` resolution case (`:104-113`) and the question-uniqueness case (`:115-122`) pass unmodified — the new entries are inside those sweeps.
4. Lint + type-check + `format:check`.

**Done when:** cases 10–13, 15 and 17–19 pass; `expectedQuestions` is a fence rather than a floor for the Analytics category; searching the FAQ for the phrases in the issue's acceptance criteria surfaces the new answers.

**Risk:** the running-job answer asserts product behavior (imports pause syncing, editing, and deleting; the station page says so while a job runs). It is traced to `CLAUDE.md` → Async Job State & Data Locking, **not** to the running UI — if the in-app copy differs, this answer is wrong and the smoke walkthrough is where that surfaces. Correct the answer, not the app, if they disagree.

---

## Slice 3 — Move the misfiled billing questions

Four billing questions sit inside the "Analytics & Portals" comment block while tagged `GettingStarted`. Pure source hygiene — nothing a user sees changes.

**Files**

- Edit: `packages/core/src/content/faq.util.ts` — move the four entries at `:224-250` above the `// Analytics & Portals` comment (`:155`), into the Getting Started block they are tagged for. No field changes.
- Edit: `packages/core/src/__tests__/content/faq.util.test.ts` — case 14 plus the contiguity guard below.

**Steps**

1. **Tests (spec case 14 + a grouping invariant).** Case 14: all four billing questions are still tagged `FAQCategory.GettingStarted` after the move — the guard that this stayed a reorder and not a retag. Added here so the slice is genuinely red-first: **every category's entries form one contiguous block in `FAQ_ENTRIES`** — currently false, because the four billing entries split `GettingStarted` into two blocks separated by the Analytics ones. Run; the contiguity case fails, case 14 passes.
2. **Implement** — move the four entries. Same questions, same answers, same categories, same `relatedGlossaryTerms`. Green.
3. Confirm nothing user-visible moved: array order is not semantic — `filterFAQ` (`:276`) and `groupEntries` (`FAQList.component.tsx:24-37`) both bucket by `category`.
4. Lint + type-check + `format:check`; full `packages/core` **and** `apps/web` suites (spec case 21).

**Done when:** case 14 and the contiguity guard pass; the four questions still render under Getting Started; `apps/web` is green with **zero edits**.

**Risk:** low, and the contiguity guard is the thing that makes it stay fixed — without it the block drifts again the next time someone appends an entry to the wrong place.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests | User-visible |
|---|---|---|---|---|
| 1 | Glossary practices + cross-links on the portal cluster | 1–9, 16, 20 | core unit | **yes** — Help, marketing JSON-LD, #367 |
| 2 | Three FAQ questions + `expectedQuestions` 22 → 29 + Analytics count | 10–13, 15, 17–19 | core unit | **yes** — Help FAQ tab, public FAQPage JSON-LD |
| 3 | Billing-block reorder + contiguity guard | 14 (+ grouping invariant) | core unit, `apps/web` boundary | no |

Total ≈ **21 cases** (plus the one added grouping invariant), no migration, no consumer-code change.

---

## Cross-slice notes

- **The copy is the contract.** Slices 1 and 2 lift their strings verbatim from the spec's *Surface*. Re-wording during implementation is a contract change, not a style choice — if a sentence reads wrong while writing it, amend the spec in the same commit rather than diverging quietly.
- **Term strings are frozen across every slice.** No rename, no category move, no new category. They key `GLOSSARY_PAGE_ROUTES` (`glossary-routes.util.ts:18-54`) and derive the `#glossary-entry-<slug>` anchors #365 shipped; `glossary-routes.util.test.ts:17-26` fails on an orphan, and the slug pins fail on a changed slug.
- **`apps/web` must need no edits.** If any `apps/web` test requires touching, a term or category moved when it shouldn't have — treat it as a signal, not a chore. `HelpView.test.tsx:499-507` and `glossary-routes.util.test.ts` are the two real-content assertions to watch.
- **Accuracy over polish** (discovery → Enterprise-scale → Accuracy & auditability): every practice must describe shipped behavior. Two claims are load-bearing and traced — pinned charts reloading live data (`Pinned Result:337`) and the job lock (`CLAUDE.md` → Async Job State). The smoke walkthrough re-checks both against the running app.
- **No org-specific claims** (discovery → Multi-tenancy). Help content renders identically for every tenant; no practice may reference a tier, a quota, or a connector the reader may not have.
- **Markdown discipline differs by surface.** Glossary `definition` renders through `ReactMarkdown` *and* ships verbatim into the marketing site's JSON-LD (`features.astro:66-72`); FAQ answers render as plain text. Neither gets lists or fences; the new copy avoids inline backticks too.
- **Doc-sync:** none beyond the content. This ticket *is* the documentation change — no README, no `CLAUDE.md`, no tool description, and no `getting-started.util.ts` edit falls out of it.
- **`@portalai/core` needs a rebuild before any `apps/web` run** (`npm run build --workspace=packages/core`) — web resolves core through `dist/`, so a stale build tests the old content.

---

## Next step

Implementation begins on this branch — slice 1 first, tests before code — once discovery, spec, and plan are reviewed and confirmed. Before writing, re-read the spec's *Surface*: the three definitions and three FAQ entries there are final text to be lifted, not drafts to be improved.
