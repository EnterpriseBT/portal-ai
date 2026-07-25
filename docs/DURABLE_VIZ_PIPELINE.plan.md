# Durable re-executable visualization pipeline — Plan

**Four TDD slices that make a `d3` widget's data pipeline durable and re-executable: core contract + mint, the refresh service/endpoint, the web plumbing, then the widget's auto/manual refresh — each behind a green suite, leaf logic first, wiring last.**

Spec: `docs/DURABLE_VIZ_PIPELINE.spec.md`. Discovery: `docs/DURABLE_VIZ_PIPELINE.discovery.md`. Issue: #270 (epic #267). Builds on #269 (`visualize_d3` mints the `d3` blocks this extends), merged into `epic/d3-dashboard-widgets`.

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/durable-viz-pipeline`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"), PRing into `epic/d3-dashboard-widgets`.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **S1** pins the shared contract (schemas + constants) and fills it at mint, so the api and web layers have a stable shape to build against. **S2** adds the server re-execution (service + endpoint) against S1's schemas — the whole backend half, testable end-to-end via integration before any UI. **S3** lands the web plumbing (SDK call + `blockRef` threading) that S4 needs, kept separate so the additive core-dispatch change is reviewed on its own. **S4** wires the widget behavior (auto + manual refresh) on top of S3's hook. No slice depends on a later one.

---

## Slice 1 — Core contract + constants + mint

The durable `pipeline` field on the `d3` block, the refresh-response schema, the freshness/rate constants, and `visualize_d3` populating the pipeline at mint. Cross-package (core schema + api mint together — the mint test asserts the field the schema defines).

**Files**

- Edit (core): `contracts/d3-widget.contract.ts` — add `D3PipelineSchema`; `D3BaseContentSchema` gains `pipeline: D3PipelineSchema.optional()`.
- Edit (core): `contracts/portal-sql.contract.ts` — add `WidgetRefreshResponseSchema` + type.
- Edit (core): `constants/large-data-ops.constants.ts` — add `VIZ_REFRESH_FRESHNESS_MS`, `VIZ_REFRESH_RATE_PER_MIN`.
- Edit (api): `tools/visualize-d3.tool.ts` — both `type: "d3"` return branches gain `pipeline: { sql, stationId, organizationId }`.
- Edit (tests): `packages/core/__tests__/contracts/d3-widget.contract.test.ts`, `.../portal-sql.contract.test.ts`, the core constants test; `apps/api/__tests__/tools/visualize-d3.tool.test.ts`.

**Steps**

1. **Tests (spec cases: core d3-widget ~5, portal-sql response ~3, constant ~1; api mint ~2).** `pipeline` optional (block without it parses); valid `pipeline` validates on both inline + handle; `D3PipelineSchema` rejects empty `sql`/`stationId`/`organizationId`; `WidgetRefreshResponseSchema` accepts inline + handle, rejects kind-less; constants present with expected shape; the tool mint populates `pipeline` on inline + handle returns, and the data-table fallback carries none. Run; fail.
2. **Implement** the schema additions, constants, and the two mint fields (`sql` from input, `stationId`/`organizationId` from the `build(...)` closure). Green.
3. Lint + type-check (full `packages/core` + `apps/api` unit — the drizzle-zod `d3` content type must still compile; nothing consumes `pipeline` yet).

**Done when:** the core contract/constant cases + the mint cases pass; a `d3` block minted by `visualize_d3` carries `pipeline`; nothing else references it yet.

**Risk:** keep `pipeline` **optional** so pre-#270 and mid-stream blocks still parse (fail-safe render) — a required field would break existing `d3` block rendering. Run the **full api unit suite** at the boundary (the mint change ripples into any snapshot of the tool output — the #269 coupling lesson).

---

## Slice 2 — Refresh service + endpoint

The server-side re-execution: load the persisted block by reference, scope-check, re-run via `resolveSqlDelivery`, rate-limit. The entire backend half, integration-tested before any UI.

**Files**

- New (api): `services/portal-viz-refresh.service.ts` — `PortalVizRefreshService.refresh({messageId, blockIndex, organizationId})`.
- Edit (api): `constants/api-codes.constants.ts` — `VIZ_WIDGET_NOT_FOUND` (404), `VIZ_WIDGET_NOT_REFRESHABLE` (422), `VIZ_REFRESH_RATE_LIMITED` (429) + `ApiCodeMessages` entries.
- Edit (api): `routes/portal-sql-handle.router.ts` — `POST /api/portal-sql/widget-refresh` (`getApplicationMetadata`, body `{messageId, blockIndex}`, per-org rate limit, `@openapi`).
- Edit (api): `config/swagger.config.ts` — register `WidgetRefreshRequest` + `WidgetRefreshResponse` components.
- New (tests): `__tests__/services/portal-viz-refresh.service.test.ts`; `__tests__/__integration__/routes/portal-viz-refresh.integration.test.ts`.

**Steps**

1. **Tests (spec cases: service ~7, integration ~5).** Service: inline + handle delivery mapping (mock `resolveSqlDelivery`); missing message / out-of-range or non-`d3` block → `VIZ_WIDGET_NOT_FOUND`; cross-org → `VIZ_WIDGET_NOT_FOUND`; no `pipeline` → `VIZ_WIDGET_NOT_REFRESHABLE`. Integration: happy path returns a fresh delivery; cross-org member → 404; unknown → 404; over rate limit → 429; a body carrying `sql` is ignored (only `{messageId,blockIndex}` honored). Run; fail.
2. **Implement** the service (load via `repo.portalMessages.findById`, parse `pipeline` with `D3PipelineSchema`, org cross-check, `resolveSqlDelivery({sql}, {stationId, organizationId})` → map to `WidgetRefreshResponse`), the ApiCodes, the route + rate limit (cost-gate Redis fixed-window; **fail-open** on limiter infra error), swagger components. Green.
3. Lint + type-check (full `apps/api` unit + the new integration test — needs DB + Redis).

**Done when:** service + integration cases pass; `POST /api/portal-sql/widget-refresh` re-executes a persisted widget's pipeline org-scoped, read-only, rate-limited, ignoring client SQL; no UI yet.

**Risk:** the integration test needs the DB + Redis harness (docker) — run `npm run test:integration`, don't rely on unit-only local runs (the #269 integration-pin lesson). Confirm `findById` on `PortalMessagesRepository` (base `Repository`) reads `blocks`; if a projection omits `blocks`, load the full row.

---

## Slice 3 — Web SDK + block-render `blockRef` threading

The additive plumbing S4 needs: the refresh SDK call, and threading `{messageId, blockIndex}` through the open renderer dispatch to the widget. Reviewed on its own because it touches the core dispatch.

**Files**

- Edit (web): `api/portal-sql.api.ts` — `portalSql.widgetRefresh` (`useAuthMutation`, POST); `api/keys.ts` only if a key is needed (imperative mutation likely needs none).
- Edit (core): `ui/ContentBlockRenderer.tsx` — `BlockRenderer` gains optional `ctx?: { blockRef?: {messageId, blockIndex} }`; `ContentBlockRenderer` gains optional `blockRef` prop, forwards it.
- Edit (web): `components/PortalMessage.component.tsx` — pass `blockRef={{messageId: message.id, blockIndex: i}}` when rendering a persisted assistant block via `ContentBlockRenderer`.
- Edit (tests): `packages/core/__tests__/ui/ContentBlockRenderer.test.tsx`; `apps/web/__tests__/PortalMessage.test.tsx`.

**Steps**

1. **Tests (spec cases: ContentBlockRenderer ~2, PortalMessage ~1).** `blockRef` is forwarded to the renderer; omitting it is a no-op for existing renderers (text/data-table unaffected); `PortalMessage` renders a persisted `d3` block with `blockRef={{messageId, blockIndex}}`. (SDK: a lightweight mount/shape assertion consistent with the other `portalSql` methods.) Run; fail.
2. **Implement** the SDK method, the additive `ctx`/`blockRef` on the dispatch, and the `PortalMessage` pass-through. Green.
3. Lint + type-check (full `packages/core` + `apps/web` unit — the additive `ctx` arg must not break any existing renderer or the `registerBlockRenderer` d3 registration).

**Done when:** those cases pass; the widget *will receive* a `blockRef` for persisted blocks and the SDK can call the endpoint; `D3Widget` doesn't consume `blockRef` yet (ignored prop, no behavior change).

**Risk:** the `BlockRenderer` signature change is monorepo-wide — the optional 2nd arg keeps every existing renderer valid; type-check across web + core proves it. Don't thread `blockRef` for streaming/unpersisted blocks (no persisted id → nothing to refresh).

---

## Slice 4 — Widget auto-refresh + manual affordance

The user-facing behavior: freshness-gated auto-refresh on mount, the always-present manual button + "Updated ⟨time⟩ ago" cue, and expired-handle auto-recovery.

**Files**

- New (web): `modules/D3Widget/utils/use-widget-refresh.util.ts` — the freshness/auto-refresh hook (tracks last-hydrated per `blockRef`, calls `widgetRefresh`, swaps delivery).
- Edit (web): `modules/D3Widget/D3Widget.component.tsx` — `D3WidgetProps`/`D3WidgetUIProps` gain `blockRef` + refresh state; wire auto-refresh, the manual `IconButton` + spinner/disable, the "Updated ⟨time⟩ ago" caption, and expired-handle → auto-refresh (no dead-end); `VIZ_WIDGET_NOT_REFRESHABLE` → re-run note.
- Edit (web): the d3 renderer registration (`modules/D3Widget/utils/register.util.tsx`) so it forwards `ctx.blockRef` from S3 into `D3Widget`.
- Edit (tests): `apps/web/__tests__/.../D3Widget.test.tsx`.

**Steps**

1. **Tests (spec case: D3Widget ~9).** Auto-refresh fires on mount when stale/expired and swaps data; within `VIZ_REFRESH_FRESHNESS_MS` it does **not** refetch; the manual button is always rendered for a persisted widget and forces refresh; disabled + spinner while in flight; "Updated ⟨time⟩ ago" updates after a successful hydration; refresh failure → typed error with prior render intact; `VIZ_WIDGET_NOT_REFRESHABLE` → re-run note; no `blockRef` → no auto-refresh and no button. Drive `D3WidgetUI` by props + the container with a mocked `widgetRefresh`. Run; fail.
2. **Implement** the hook + widget wiring + the renderer forwarding of `blockRef`. Green.
3. Lint + type-check (full `apps/web` unit).

**Done when:** all D3Widget cases pass; a persisted widget auto-refreshes when stale, always offers a manual refresh + freshness cue, and auto-recovers from an expired handle; a fresh widget makes no refresh call.

**Risk:** the freshness bookkeeping must survive React re-renders without re-fetching inside the window (a session-scoped last-hydrated map keyed by `blockRef`, not component state that resets on remount). Keep the viewport-observer/lazy-mount out — that's #271 (scope line in the spec).

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | core `pipeline`/response schemas + constants; `visualize_d3` mints `pipeline` | core + api unit green; minted block carries `pipeline` |
| 2 | refresh service + `POST /widget-refresh` + ApiCodes + rate limit + swagger | api unit + **integration** green; org-scoped, SQL-ignoring, rate-limited |
| 3 | SDK `widgetRefresh` + `blockRef` threading (core dispatch + PortalMessage) | core + web unit green; `blockRef` reaches the renderer |
| 4 | `D3Widget` auto + manual refresh, freshness cue, expired auto-recovery | web unit green; widget behavior complete |

## Cross-slice notes

- **`pipeline` stays optional across all slices** — the schema (S1) tolerates its absence so existing/streaming `d3` blocks render; only refresh (S2) treats absence as `VIZ_WIDGET_NOT_REFRESHABLE`. No slice makes it required.
- **The `BlockRenderer` signature change (S3)** is the one monorepo-wide touch; the optional 2nd arg + optional prop keep it non-breaking, verified by `type-check` at the S3 boundary.
- **No migration, no cache-invalidation** — the pipeline rides existing `jsonb`; refresh is read-only and writes nothing back (Q2), so there are no query-key invalidations to add.
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync"):** auto/manual widget refresh is a **new user-facing concept**. In S4, add a glossary term (`glossary.util.ts` — "live widget / refresh") and an FAQ entry (`faq.util.ts` — "why did my chart update / how do I refresh it"); the pinning tests will flag missing entries. The `visualize_d3` **tool description** and `system.prompt` are unchanged (the agent doesn't drive refresh), so no agent-contract doc-sync.
- **Integration harness (S2)** needs docker (DB + Redis) — same gate as the epic's other integration tests.

## Next step

Implementation begins on `feat/durable-viz-pipeline`, slice 1 first (tests → green → lint/type-check), one commit per slice — only after discovery + spec + plan are reviewed and confirmed.
