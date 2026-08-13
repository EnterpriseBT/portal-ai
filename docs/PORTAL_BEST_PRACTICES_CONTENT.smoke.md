# portal_best_practices_content — Smoke Suite

Manual smoke test for [#366](https://github.com/EnterpriseBT/portal-ai/issues/366) — portal best-practices guidance in the glossary and FAQ. Covers the three rewritten glossary definitions and their cross-links, three new FAQ questions under Analytics & Portals, the markdown-rendering constraint on both surfaces, the public marketing site that consumes the same module, and the reordered billing questions.

**Branch under test:** `feat/portal-best-practices-content` (PR [#374](https://github.com/EnterpriseBT/portal-ai/pull/374)) — child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364), **PR base `epic/portal-guidance`, not `main`**.

This is a **reading** walkthrough — the point is whether the copy is true, actionable, and renders cleanly on all three surfaces. Read the new text as a user would, not as its author. Run **§Preflight** once; sections are independent after that.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout feat/portal-best-practices-content && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` — the content lives in `@portalai/core`, and `apps/web` resolves it through `dist/`. **A stale build means you are reading the old copy and this whole walkthrough is meaningless.**
- [x] **No migration.** This branch changes two data modules and their tests — no DB schema, no seed, no API route. Do not run `db:migrate`.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Fixtures

Nothing to seed for §1–§4 — Help content is static and identical for every org.

| Needed | For | How |
|---|---|---|
| Any logged-in user | §1–§4 | your usual dev login |
| A station **mid-import** (a running sync or file-upload job) | §5 | start a sync on a connector instance, or upload a file, and work while the job is `active` |

### Reset between runs

- [x] No reset needed — nothing is persisted; re-navigate to `/help` to start over.

---

## §1 — The glossary practices (slice 1)

Open `http://localhost:3000/help?tab=glossary&category=analytics` (the deep link #365 shipped) and expand each entry.

- [x] **Portal** — the definition now continues past "…using the station's tool packs" with two practices: that a portal answers from **records the station has actually imported**, not general knowledge; and to **ask about one thing at a time**.
- [x] Read the entity-data sentence as someone who has connected nothing. It should tell you *what to go check*, not merely that something is wrong.
- [x] **Portal Message** — carries the vocabulary practice: name entities, columns, and values the way they appear in your data. The "subscription level" example reads sensibly.
- [x] **Portal Result** — frames results as durable output: pinning, and that pinned charts and tables **reload live data** rather than freezing the numbers.
- [x] **Portal's Related row** now lists `Entity Record`, `Connector Instance`, and `Tool Pack` alongside the originals. Click each — it jumps to a real entry, none dead-ends.
- [x] **Portal Message's Related** row includes `Station` and `Entity Record`; **Portal Result's** includes `Portal Message`.
- [x] **Tool Pack** still owns the "only attach the packs a station absolutely needs" sentence — and none of the three portal entries repeats it. (Guidance stated twice is guidance that drifts.)
- [x] Nothing renders as literal markup: no visible `*`, `**`, backticks, or `-` bullets anywhere in the three edited entries.
- [x] The entries still read as *definitions* first. If any now reads as a tips list with a definition bolted on, say so — that's a copy bug worth filing.

## §2 — The FAQ answers (slice 2)

Open `http://localhost:3000/help?tab=faq&category=analytics`.

- [x] Three new questions are present under **Analytics & Portals**: "Why are the assistant's answers vague or missing my data?", "How should I word my questions to get better answers?", and "Why does the assistant say my data is incomplete while an import is running?"
- [x] Expand each. Answers render as plain paragraphs — **no literal backticks, asterisks, or dash-bullets**.
- [x] The vagueness answer names something concrete to check (does the station have a connector instance; do its entities have records; has a sync run).
- [x] The wording answer gives both practices — one thing at a time, and the station's own vocabulary.
- [x] Each of the three shows a **Related terms** row whose links open real glossary entries.
- [x] The Analytics & Portals category now holds **11** questions.

## §3 — Search finds the guidance (spec AC)

The issue's acceptance criteria name the words a confused user would actually type. On `/help`, use the search box.

- [x] Glossary tab, search **"imported"** → the **Portal** entry appears.
- [x] FAQ tab, search **"vague"** → the vagueness question appears.
- [x] FAQ tab, search **"word my questions"** → the wording question appears.
- [x] FAQ tab, search **"import"** → the running-job question appears.
- [x] Search **"best practice"** → be honest about what comes back. The issue's AC names this phrase; if nothing sensible matches, the copy may need the words a user would actually search for. File it rather than waving it through.

## §4 — The marketing site (shared module)

`packages/core/src/content` is consumed at build time by `apps/site`, and glossary `definition` strings ship **verbatim** into JSON-LD.

- [x] `npm run build --workspace=apps/site` completes without error.
- [x] Serve/preview the site (`:3002`) and view source on the Features page. In the `DefinedTermSet` JSON-LD block, find the `Portal` entry: its `description` contains the new prose and **no markdown characters** (`**`, backticks, `-` bullets).
- [x] On the Pricing page, the `FAQPage` JSON-LD includes the three new questions with clean plain-text answers.
- [x] Paste one JSON-LD block into [validator.schema.org](https://validator.schema.org/) (or Google's Rich Results test) — it parses without errors. This content is public and indexed; malformed structured data is a real-world defect, not a lint nit.

## §5 — Is the running-job answer actually true? (the one factual risk)

**This is the step most likely to find a bug.** The answer asserts product behavior that was traced to `CLAUDE.md` → Async Job State & Data Locking, **not** verified against the running app.

- [x] Start a long-running import or sync on a connector instance and let it reach `active`.
- [x] Open that connector instance's detail view while the job runs. Confirm the app **does** surface the lock state inline (an alert or chip naming the running job).
- [x] Confirm the blocked actions match the answer's claim: **syncing, editing fields, and deleting are paused** while the job runs.
- [x] Read the FAQ answer beside what you just saw. Every clause should be true of the app in front of you — especially "the station's detail page says so while it runs".
- [x] If the app's behavior or wording differs in any respect, **the FAQ answer is wrong** — file it and correct the answer, not the app. (An FAQ that describes behavior we don't have is worse than no FAQ.)

## §6 — The billing reorder changed nothing visible (slice 3)

- [x] Open `/help?tab=faq&category=getting-started`. All four billing questions are there: "How do I upgrade my plan?", "Who can manage billing?", "My plan says it's managed — what does that mean?", "Why is a toolpack marked "Inactive on your plan"?"
- [x] They are **not** under Analytics & Portals.
- [x] With no category filter (the **All** chip), the FAQ renders grouped by category and each question sits under the header it belongs to.

## §7 — Nothing else moved

- [x] No glossary term was renamed: `/help#glossary-entry-portal`, `#glossary-entry-portal-message`, and `#glossary-entry-portal-result` all still open and expand their entries (the anchors #365 shipped are derived from term strings).
- [x] The Glossary tab still shows the same five category chips — Data Sources, Data Modeling, Organization, Analytics, System. **No new "Portals" chip.**
- [x] Spot-check three glossary entries outside the portal cluster (e.g. `Field Mapping`, `Sync`, `Job Status`) — wording unchanged.
- [x] Related-term links from a FAQ answer still jump to the Glossary tab and expand the target entry (the #365 cross-tab behavior, unaffected).

## §8 — Not manually verifiable (recorded, not skipped)

The spec's first acceptance criterion — all cases pass, `lint` / `type-check` / `format:check` clean — is a **CI assertion**, not a walkthrough step. Confirm CI is green on the PR; that plus your sign-off is the merge gate.

---

## Sign-off checklist

- [x] §1 (glossary) — three practices present, cross-links resolve, tool-pack guidance single-sourced, no literal markup.
- [x] §2 (FAQ) — three questions present and plain-text, related terms resolve, 11 Analytics entries.
- [x] §3 (search) — the phrases from the acceptance criteria surface the guidance.
- [x] §4 (marketing site) — builds; JSON-LD carries clean prose and validates.
- [x] §5 (running-job answer) — every clause verified against the app, or filed and corrected.
- [x] §6 (billing reorder) — nothing user-visible moved.
- [x] §7 (no regressions) — no rename, no new category, anchors intact.
- [x] CI green on the PR (§8).
- [x] 2026-08-13 — Ben Turner — walked against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread (base `epic/portal-guidance`), or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <the copy as rendered, a screenshot, or the app behavior that contradicts it>
**Repro:** <exact URL or click path>
**Surface:** <Help view | marketing site JSON-LD | both>
```
