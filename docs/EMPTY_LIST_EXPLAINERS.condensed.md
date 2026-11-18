# Explain each empty list and link to Help — Condensed design (#1059)

**Issue:** [EnterpriseBT/portal-ai#1059](https://github.com/EnterpriseBT/portal-ai/issues/1059) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** An empty top-level list says only that it's empty ("No pinned results"), and it's the first thing a new user sees. The fix gives each one sentence on what the list holds plus a link to the matching Help FAQ entry, in one shape on every page. It touches `packages/core` (`PageEmptyState` takes a help link, and two new FAQ entries) and `apps/web` (the ten empty states). There's no API or contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `PageEmptyState` | `packages/core/src/ui/PageEmptyState.tsx` | `icon`, `title` (h2), optional `description`, optional `action` |
| Empty states in scope | `components/StationList.component.tsx:202`, `views/Connector.view.tsx:218` and `:273`, `Entities.view.tsx:220`, `CuratedViews.view.tsx:92`, `EntityGroups.view.tsx:191`, `Tags.view.tsx:126`, `ColumnDefinitionList.view.tsx:139`, `PinnedResultsListView.view.tsx:112`, `Jobs.view.tsx:86` | Each already has an `EmptyResults` branch for an active search/filter |
| Create in the empty state | `CuratedViews.view.tsx:100`, `EntityGroups.view.tsx:195`, `Tags.view.tsx:130` | `action={createButton}`, a second copy of the header's `primaryAction` |
| Permission-dependent copy | `CuratedViews.view.tsx:96-99` | "No views have been shared with you yet" when create isn't allowed |
| FAQ content | `packages/core/src/content/faq.util.ts` | No entry for views or for what jobs are |
| Help anchors | `apps/web/src/utils/routes.util.ts:161-197` (`helpAnchorHash`), `views/Help.view.tsx:373` | `#faq-entry-<slug>` expands and scrolls to the entry; slug from `contentEntrySlug` |
| Router link for core | `apps/web/src/components/RouterLink.component.tsx` | Passes `href` straight to TanStack `to`, which carries no hash |

## Decision: core owns the layout, web owns the page→FAQ map

- **Core.** `PageEmptyState` gains `helpLink?: { href: string; label: string }` and `linkComponent?: React.ElementType` (the `DetailCard` precedent, since core can't import the router). It renders, in this order:
  - the title;
  - the `description` sentence;
  - the link, as `Help: <label>`;
  - any `action`, kept for the out-of-scope detail pages.
- **Web: one map.** `utils/empty-list-help.util.ts` holds `EMPTY_LIST_HELP`, keyed by list: `stations`, `connectors`, `connectorDefinitions`, `entities`, `views`, `entityGroups`, `tags`, `columnDefinitions`, `pinnedResults` and `jobs`. Each entry has a `description` and an FAQ `question`. `emptyListHelp(list)` returns `{ description, helpLink }`, with the href `/help#faq-entry-<contentEntrySlug(question)>` and the question as the label. Every page spreads it into its `PageEmptyState`, so no page writes its own copy.
- **Web: links with a fragment.** `RouterLink` splits a `#fragment` off `href` and passes it as TanStack's `hash`. Without that, the link can't reach the anchor.
- **No permission-based copy, no Create in the empty state.**
  - Views, Entity Groups and Tags drop `action={createButton}`, leaving the header's gated Create as the only one.
  - The Views sentence stops depending on the create gate.
- **FAQ additions** (Data / Jobs): "What is a view?" and "What are jobs?". Their answers follow the glossary's *Curated View* and *Job* definitions. Both also appear on the marketing site.

| List | Sentence | FAQ entry |
|---|---|---|
| Stations | A station bundles the views, connectors and tool packs a portal session works with. | What is a Station and why do I need one? |
| Connectors | A connector links a data source, such as a file, a spreadsheet or an API, and brings its data in. | How do I connect my first data source? |
| Connector definitions | Connector definitions are the kinds of data source you can connect. | How do I connect my first data source? |
| Entities | An entity is one table of records from a connector, such as a sheet or an API endpoint. | What's the difference between a connector and an entity? |
| Views | A view is a chosen set of an entity's columns and rows that stations query. | What is a view? |
| Entity groups | An entity group joins entities from different sources that describe the same things. | What are entity groups and when should I use them? |
| Tags | Tags are color-coded labels you attach to entities to group and filter them. | How do tags work? |
| Column definitions | A column definition is a shared field type that field mappings use to validate and format values. | What are column definitions and why do they matter? |
| Pinned results | A pinned result is a chart, table, map or answer kept from a portal session. | How do I save results from a portal session? |
| Jobs | Jobs are background tasks such as imports, syncs and revalidations. | What are jobs? |

## Plan: 1 slice

**Files**
- Core: `ui/PageEmptyState.tsx` and `content/faq.util.ts`.
- Web: new `utils/empty-list-help.util.ts`, `components/RouterLink.component.tsx`, and the nine files in Current shape.

**Tests** (test first)
- Core, `__tests__/ui/PageEmptyState.test.tsx`:
  - the elements render in order: title, sentence, link;
  - the link's text is `Help: <label>` and it uses `linkComponent`;
  - axe passes.
- Web, `__tests__/empty-list-help.util.test.ts`:
  - every list's FAQ question exists in `FAQ_ENTRIES`, so a renamed or removed entry fails;
  - each sentence is one sentence of at most 110 characters;
  - the copy names no role or permission.
- Web, `__tests__/RouterLink.test.tsx`: an `href` with `#…` reaches the router as `hash`.
- Web, the view tests for each page:
  - the empty list shows its sentence and Help link;
  - a search with no matches still shows `EmptyResults`;
  - Views, Entity Groups and Tags have no Create in the empty state.
- Core `content/faq.util.test.ts` covers the two new entries.
- Run `npm run test:unit -- --testPathPattern …` in each package.

## Smoke (manual, against your dev stack)

1. Sign in to an org with no data in a list. For each page, confirm the empty list shows its title, then the one sentence, then a `Help: …` link:
   - Stations, Connectors (both tabs), Entities, Views, Entity Groups, Tags, Column Definitions, Pinned Results and Jobs.
2. Follow each link. Help opens on the FAQ tab with that entry expanded and scrolled into view.
3. Type a search that matches nothing on a non-empty list. "No results" shows, not the explainer.
4. On Views, Entity Groups and Tags, the only Create is in the page header.
5. Tab to the Help link with the keyboard and press Enter. It navigates.
6. View an empty list as a member who can't create. The sentence is identical.

## Out of scope

- Nested tables on detail pages, `DataTable`'s `emptyMessage`, and the filtered `EmptyResults` state.
- A create action or onboarding flow inside the empty state.
