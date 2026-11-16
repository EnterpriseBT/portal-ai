# Attach curated views from a portal session — Plan

**A TDD-sequenced implementation of the agent-side view attachment: request-memo invalidation, the shared attach/detach and station-list services under the existing routes, then the `curated_view_attach` / `curated_view_detach` / `station_list` tools, the copy, and the web refresh.**

Spec: `docs/ATTACH_VIEWS_FROM_PORTAL.spec.md`. Discovery: `docs/ATTACH_VIEWS_FROM_PORTAL.discovery.md`. Issue: #1036. It builds on the shipped `view_management` pack (#645) and station attachments (#674). #848 (Administrate and Playground) depends on it.

The work is seven slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/1036-attach-views-from-portal`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, and only the touched files locally (the full suite is CI's job):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run them on their own.
4. Run `npm run lint && npm run type-check` (and `npm run format:check`) at the boundary.
5. Move to the next slice.

A slice that touches `packages/core` runs the root `npm run build` before its commit, because a core change ripples into web and site fixtures.

**Sequencing rationale.** The plumbing lands under unchanged routes first, so the tools are thin.

| Slice | What lands | Why it sits here |
|---|---|---|
| 1 | `forgetForRequest` + `PortalSqlService` key owner | A leaf utility with no callers yet |
| 2 | `StationAttachmentService.attachViews` / `detachViews` / `loadWritableStation`; the routes rewired | Route parity proves the extraction before any tool depends on it |
| 3 | `StationQueryService.listForCaller` + `listViewsForStations`; `GET /api/stations` rewired | The same parity discipline, for listing |
| 4 | `curated_view_attach` / `curated_view_detach`, their registries, guards and attach copy | Composes 1 + 2. The same-turn acceptance test goes green here, so **#848's Playground loop works after this slice** |
| 5 | `station_list` and its registries, guards and prompt line | Composes 3. Attaching elsewhere *by name* works |
| 6 | Help content (glossary, FAQ) | Copy only. Its own commit keeps the core-content pins reviewable |
| 7 | Web: tool names on `onDone` + the `stations.root` invalidation | Independent of the api slices, but last so it ships with the tools whose names it reads |

There is no migration and no seed.

---

## Slice 1 — `forgetForRequest` + the session-views key owner

The leaf utilities. Nothing calls them yet.

**Files**

- Edit: `apps/api/src/utils/request-context.util.ts` — add `forgetForRequest(key)`, and reword the `memoizeForRequest` docstring (spec § request-context).
- Edit: `apps/api/src/services/portal-sql.service.ts` — add `static sessionViewsKey(...)` and `forgetSessionViews(...)`. `resolveViewsForSession` uses `sessionViewsKey` (`:1225-1228`).
- Edit: `apps/api/src/__tests__/utils/request-context.util.test.ts`, `apps/api/src/__tests__/services/portal-sql-view-memo.test.ts`.

**Steps**

1. **Tests (spec api unit: request-context, portal-sql-view-memo).**
   - `forgetForRequest` makes the next `memoizeForRequest` recompute;
   - it's a no-op outside a store;
   - it removes only the named key;
   - `sessionViewsKey` is the key `resolveViewsForSession` memoizes under;
   - `forgetSessionViews` causes a re-resolve inside one store.

   Run; they fail.
2. **Implement** both. They go green.
3. Lint + type-check.

**Done when:** the memo cases pass and `resolveViewsForSession` builds its key only through `sessionViewsKey`.

**Risk:** none. This is additive, and existing memo behaviour is unchanged when nothing calls `forget`.

---

## Slice 2 — Attach and detach in `StationAttachmentService`, routes on top

The UI and the agent will share one authorization path. The routes behave exactly as before.

**Files**

- Edit: `apps/api/src/services/station-attachment.service.ts`
  - Add `AttachmentAuditContext`, `ViewAttachResult` and `ViewDetachResult`.
  - Add `loadWritableStation(ctx, stationId)`, moved from the router, plus `attachViews` and `detachViews`.
  - Add a private `auditChange`, moved from the router's `auditViewAttachment`.
- Edit: `apps/api/src/routes/curated-view.router.ts`
  - `POST /:id/attach` and `DELETE /:id/attach/:stationId` call the service with `auditContextFromRequest(req)`.
  - Delete the private `loadWritableStation` and `auditViewAttachment`.
- Edit: `apps/api/src/__tests__/services/station-attachment.service.test.ts`.

**Steps**

1. **Tests (spec api unit: `attachViews` / `detachViews`).**
   - `attachViews`: ids are deduped; one unreadable id refuses the batch with no insert and no audit; `alreadyAttached` is reported; only `added` is audited; an unreadable or cross-org station gets 404 before a missing write gets 403.
   - `detachViews`: write alone is enough; `notAttached` is reported; only `removed` is audited.

   Run; they fail.
2. **Implement** the service methods. Insert in one transaction, and audit after commit (fail-open). They go green.
3. **Rewire both routes.** Run `curated-view.router.integration.test.ts` and `station-attachments.router.integration.test.ts` **unchanged**; they must stay green, which shows the routes still behave the same.
4. Lint + type-check.

**Done when:** the service cases pass, both route suites pass untouched, and the router no longer contains station-loading or audit code.

**Risk:** route drift. The unchanged integration suites are the guard. Watch the 404-before-403 ordering, and that the route's response still echoes the single `curatedViewId`.

---

## Slice 3 — `StationQueryService` + batched attached views

Listing moves out of the router, and attached views can be read for many stations at once.

**Files**

- New: `apps/api/src/services/station-query.service.ts` — `listForCaller(ctx, opts)`, moved from `station.router.ts:191-283`.
- Edit: `apps/api/src/routes/station.router.ts` — `GET /` calls it, with its parsing and response unchanged.
- Edit: `apps/api/src/services/station-attachment.service.ts` — `listViewsForStations(set, organizationId, stationIds)`.
- New: `apps/api/src/__tests__/services/station-query.service.test.ts`; edit `station-attachment.service.test.ts`.

**Steps**

1. **Tests.**
   - `listForCaller` applies org scope and `visibilityPredicate`, and returns `enabledToolpacks` and `capabilities` for each row.
   - `listViewsForStations` reads every station's views in one batched query, and returns unreadable ones with no id, key or label.

   Run; they fail.
2. **Implement.** They go green.
3. **Rewire `GET /api/stations`.** `station.router.integration.test.ts` stays green **unchanged**.
4. Lint + type-check.

**Done when:** the new cases pass, the station route suite passes untouched, and the list logic exists only in the service.

**Risk:** a performance regression on the list route. The move is verbatim (same queries), so a reviewer should diff the before and after query count.

---

## Slice 4 — `curated_view_attach` / `curated_view_detach`

The tools, everything that registers them, and the agent-facing copy that currently says attaching is impossible. They ship together so no commit describes the pack wrongly.

**Files**

- New: `apps/api/src/tools/curated-views/curated-view-attach.tool.ts`, `curated-view-detach.tool.ts`.
- Edit: `apps/api/src/tools/curated-views/curated-view-tool.util.ts` — map `STATION_ATTACHMENT_NOT_READABLE` to `TOOL_TARGET_NOT_FOUND`, checked before the 403 re-throw.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `CURATED_VIEW_ATTACH_FAILED`, `CURATED_VIEW_DETACH_FAILED`.
- Edit: `apps/api/src/services/tools.service.ts` — add the names to `BUILTIN_TOOL_NAMES`, build both with `(permissionContext, { stationId, portalId })`, and update the pack comment.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — the mirrors (schema parity), `rbacWrite()` capabilities, the pack JSDoc and description, and the `curated_view_create` / `curated_view_entity_list` descriptions.
- Edit: `packages/core/src/registries/tool-phase-labels.ts` — the two labels.
- Edit: `apps/api/src/tools/curated-views/curated-view-create.tool.ts`, `curated-view-entity-list.tool.ts` — matching descriptions.
- Edit: `apps/api/src/prompts/system.prompt.ts` — replace the "**You cannot attach a view to a station.**" paragraphs (`:638-645`, `:675-679`) with the attach and same-turn guidance (the `station_list` line waits for slice 5).
- Tests:
  - `curated-view-tools.test.ts`, `curated-view-tools.integration.test.ts`;
  - `tools.service.test.ts` (`VIEW_TOOLS`, cost-wrap `:1025`, NUL `:1107`, refusal-before-admission `:1165`, authorization coverage `:1250`);
  - core `builtin-toolpacks.test.ts` (`:437-449`), `tool-capabilities.test.ts`, `tool-phase-labels.test.ts`;
  - `system.prompt.test.ts` (`:404-409`).

**Steps**

1. **Unit tests (spec api unit: the attach and detach tools).**
   - `stationId` defaults to the session, and `isSessionStation` is set;
   - `forgetSessionViews` is called only for the session station and only when something changed;
   - `KEY_CONFLICT` is reported;
   - `STATION_ATTACHMENT_NOT_READABLE` comes back as `TOOL_TARGET_NOT_FOUND`;
   - a 403 is re-thrown, and a 5xx becomes `*_FAILED`;
   - a batch of 26 is refused by the schema;
   - plus the registry and guard expectations and the new prompt pins.

   Run; they fail.
2. **Integration tests (spec api integration: the attach tool).**
   - **The same-turn case:** attach a view to the session station, then `sql_query` returns its rows inside one `requestContext.run`.
   - Detach, then `sql_query` no longer sees it.
   - A member without station write gets `TOOL_PERMISSION_DENIED`, and no row is written.
   - Re-attaching is a no-op.
   - Each change records one audit event with `userAgent: "portal-agent"`.

   Run; they fail.
3. **Implement** the tools, the error mapping, the codes, the registries and the copy. They go green.
4. Root `npm run build` (core changed), then lint and type-check.

**Done when:** every listed suite passes, and nothing in code, pack copy or the prompt still says the agent can't attach.

**Risk:** the same-store integration test is the one that proves the acceptance criterion. If it's flaky, check that `sql_query` and the tool really share one `AsyncLocalStorage` store, rather than loosening the assertion.

---

## Slice 5 — `station_list`

The agent can find another station by name before attaching to it.

**Files**

- New: `apps/api/src/tools/curated-views/station-list.tool.ts` — `StationQueryService.listForCaller` plus `listViewsForStations`, with `isSessionStation`, toolpack slugs, and the paging defaults (25) and maximum (100).
- Edit: `api-codes.constants.ts` (`STATION_LIST_FAILED`), `tools.service.ts`, `builtin-toolpacks.ts` (the mirror before `curated_view_attach`, `rbacRead()`), `tool-phase-labels.ts`, `system.prompt.ts` (the "find the station with `station_list` and check it has `data_query`" line).
- Tests: `curated-view-tools.test.ts`, `curated-view-tools.integration.test.ts` (visibility; attaching to another station by name, and that station's member seeing the view next turn), and the same registry and guard suites as slice 4.

**Steps**

1. **Tests.**
   - `isSessionStation`, toolpacks, and unreadable views carrying no id or label;
   - paging defaults and the maximum;
   - visibility: a member sees only the stations they can read;
   - the cross-station flow: `station_list`, then `curated_view_attach({stationId})`, then a member's `resolveViewsForSession` on that station includes the view;
   - the registry, guard and prompt pins.

   Run; they fail.
2. **Implement.** They go green.
3. Root build, lint, type-check.

**Done when:** the station_list cases and the cross-station acceptance case pass.

**Risk:** none beyond slice 3's.

---

## Slice 6 — Help content

The user-facing help says the assistant can attach views.

**Files**

- Edit: `packages/core/src/content/glossary.util.ts` — "Curated View" (`:257`) and "Station" (`:242`).
- Edit: `packages/core/src/content/faq.util.ts` (`:325`).
- Edit: `glossary.util.test.ts` — a pin for the agent-attach sentence on "Curated View". `faq.util.test.ts` stays green (no question added, so the count stays 32).

**Steps**

1. **Test.** Add the glossary pin. Run; it fails.
2. **Implement** the three copy edits. They go green.
3. Root build (the glossary also feeds the marketing site), lint.

**Done when:** the glossary and FAQ suites pass, and no help entry says attaching is only possible in the station editor.

**Risk:** the glossary also feeds `apps/site`, so the root build catches any fixture that relies on the old text.

---

## Slice 7 — Web: refresh stations after an attach or detach turn

**Files**

- New: `apps/web/src/utils/station-attachment-tools.util.ts` (+ `__tests__/station-attachment-tools.util.test.ts`).
- Edit: `apps/web/src/utils/portal-stream.util.ts` — a per-stream `Set` ref of `tool_result` tool names, reset on `send`; `onDone(clear, { toolNames })`.
- Edit: `apps/web/src/components/PortalSession.component.tsx` — `handleStreamDone` invalidates `queryKeys.stations.root` when `changedStationAttachments(turn.toolNames)`.
- Tests: `__tests__/portal-stream.util.test.ts`, `__tests__/PortalSession.test.tsx`; any other `onDone` caller's test follows the new signature.

**Steps**

1. **Tests (spec web).**
   - `changedStationAttachments` returns true only for the two tool names.
   - `onDone` receives the turn's tool names, and they reset on each `send`.
   - A turn with `curated_view_attach` invalidates `stations.root`; a turn without it doesn't (spy on `invalidateQueries`).

   Run; they fail.
2. **Implement.** They go green.
3. Lint (zero-warning), type-check, and a grep of the web test fakes for `usePortalStream` (partial module mocks break on a new signature).

**Done when:** the web cases pass, and the portal header's view list refreshes after an attach turn.

**Risk:** partial module mocks of `portal-stream.util` in other web tests. Grep for `unstable_mockModule(".*portal-stream` before pushing.

---

## Sequence summary

| # | Commit (scope) | Gating check |
|---|---|---|
| 1 | `feat(api): forget a request-memo entry (#1036)` | memo unit cases |
| 2 | `refactor(api): station view attach/detach in StationAttachmentService (#1036)` | service cases + route suites unchanged |
| 3 | `refactor(api): station listing in StationQueryService (#1036)` | service cases + station route suite unchanged |
| 4 | `feat(api,core): curated_view_attach and curated_view_detach tools (#1036)` | same-turn integration + registry, guard and prompt pins |
| 5 | `feat(api,core): station_list tool (#1036)` | cross-station integration + pins |
| 6 | `docs(core): help says the assistant can attach views (#1036)` | glossary and FAQ suites |
| 7 | `feat(web): refresh stations after an attach turn (#1036)` | web cases |

## Cross-slice notes

- **The `view_management` mirror order is pinned** (`builtin-toolpacks.test.ts:437-449`). Slice 4 appends attach and detach after `curated_view_share`, and slice 5 inserts `station_list` before them, so the order ends up as the spec states.
- **Schema parity has an empty exemption list.** Each mirror lands in the same slice as its tool class.
- **The permission gate** depends on `runViewTool` re-throwing 403s. The new `STATION_ATTACHMENT_NOT_READABLE` rule must be checked *before* that re-throw (slice 4).
- **No new route,** so `route-authorization.map.ts`, the `@openapi` blocks and Swagger are unchanged. If either rewire (slices 2 and 3) changes a response, that's a bug, not a doc update.
- **Docs in sync:**
  - the tool surfaces (`.tool.ts` + mirror + `system.prompt.ts`): slices 4 and 5;
  - help (glossary and FAQ): slice 6;
  - `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`: N/A, because there's no new interactive pattern;
  - `DEPLOYMENT_SECURITY_REVIEW.md`: N/A, because there's no egress.
- **Core changes need the root build** before pushing (slices 4–6), not just per-package type-checks.
- **#848** rebases onto `main` after this merges. Its Playground acceptance criterion relies on slice 4.

## Next step

Implementation starts on this branch with slice 1, tests first and one commit per slice, once discovery, spec and plan are confirmed.
