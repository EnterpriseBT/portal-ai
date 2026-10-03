# Field-mapping read check — Condensed design (#692)

**Issue:** [EnterpriseBT/portal-ai#692](https://github.com/EnterpriseBT/portal-ai/issues/692) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The four field-mapping GET routes don't authorize reads:
- `GET /:id` (and `/impact`, `/validate-bidirectional`) loads the mapping by id with **no org check**. A user in another org reads it (verified live: 200 with the full row).
- `GET /` filters by org only, so a member sees every mapping in the org, including ones on entities that 404 for them.

#685 closed mutation and SSE routes, and its guard classifies only those, so reads were never inventoried. This fixes the field-mapping reads and extends the guard to every GET route, so a missing read check fails CI. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| List | `routes/field-mapping.router.ts:103` | `eq(organizationId)` only; no `visibilityPredicate` |
| GET-one | `:233` | plain `findById(id)`; no org, no `can` |
| Impact / validate | `:885`, `:1168` | `findById(id)`; no org, no `can` |
| Sibling pattern | `routes/entity-tag.router.ts:109-116` (list), `:241-254` (GET-one) | `loadSet(ctx).visibilityPredicate(type, {createdByCol, idCol})`; `can("resource.read", {type,id,createdBy})` else 404 |
| `in_curated_view` read | `permission.service.ts:149-204` (FK expansion in `loadSet`) | The member read condition on field mappings expands to concrete ids, so the generic predicate and `can` cover it |
| Guard | `__tests__/config/route-authorization.{map,test}.ts` | `MUTATION` + `SSE` regexes only (`test.ts:15-20`); 81 non-SSE GET routes are unclassified |

## Decision — fix the four routes the sibling way; then classify every GET route

**Routes.** The list adds `visibilityPredicate("field_mapping", …)`. GET-one, `/impact` and `/validate-bidirectional` require `organizationId === caller's` **and** `can("resource.read")`, else `404 FIELD_MAPPING_NOT_FOUND` (unreadable == absent; another org's id is indistinguishable from a missing one). One shared helper in the router loads a readable mapping, so the three by-id routes can't diverge.

**Guard.** The `ROUTE_AUTHORIZATION` map gains every `GET` route. The test's route filter becomes "every route" (mutation + SSE + GET), with the same unclassified, stale and vague-entry checks, and its floor rises. Each GET entry names its read check (`org scope + visibilityPredicate <type>`, `org + can read`, …) or an exemption with its reason (health, docs, public site config, the signature-checked webhook GET). Rejected: a separate read map, which would mean two maps to keep and the same review for each route.

**Gaps the inventory finds.** If another GET route lacks its org or read check, it's the same class of bug as this one: fix it in this PR with an owner-vs-member / cross-org integration test, as #685's slices 6b/6c did. A gap that needs a product decision (what *should* be readable) is filed instead, and its map entry says so.

## Plan — 2 slices

**Slice 1: the four field-mapping routes.**
- Files: `routes/field-mapping.router.ts`; `__tests__/__integration__/routes/field-mapping.router.integration.test.ts`.
- Tests, written first, in the integration suite (via `seedTenancyFixture`):
  - a member's list excludes the owner's mappings and includes their own;
  - a member GET/impact/validate on the owner's mapping → 404;
  - another org's caller → 404 on all three;
  - the owner and the member's own mappings → 200;
  - a mapping in a curated view shared with the member is readable (`in_curated_view`).
- Run with `npm run test:integration -- --testPathPattern field-mapping.router`.

**Slice 2: classify every GET route.**
- Files: `__tests__/config/route-authorization.map.ts` (+81 entries) and `route-authorization.test.ts` (filter + floor); a fix + integration test per gap found; `CLAUDE.md` API Style Guide authorization bullet ("every mutation, SSE **and GET** route") and its copilot mirror.
- Tests: the guard (an unclassified GET fails; the self-test probes a GET), run with `npm run test:unit -- --testPathPattern route-authorization`.

## Smoke (manual, against your dev stack)

Tokens as in the #685 smoke: `$OWNER`, `$MEMBER` (in `e2e-fixture`), `$OTHER` (a caller switched into another org). `FM` = an owner-created mapping on an entity the member can't read.

1. `GET /api/field-mappings?limit=100` as `$MEMBER` → only mappings the member can read (not the owner's `FM`); as `$OWNER` → all.
2. `GET /api/field-mappings/$FM` as `$MEMBER` → `404 FIELD_MAPPING_NOT_FOUND`; as `$OTHER` → `404`; as `$OWNER` → `200`.
3. `GET /api/field-mappings/$FM/impact` and `/validate-bidirectional` as `$MEMBER` and `$OTHER` → `404`; as `$OWNER` → `200`.
4. **Browser, member:** the member's own entity's detail page still lists its field mappings and the mapping edit dialog opens; no new console 404s on their own pages.
5. **Browser, owner:** the entity detail and column-definition pages still list mappings; the impact preview before deleting a mapping still loads.
6. Each GET gap slice 2 fixes gets its own `curl` line here once found (cross-org / member → 404, owner → 200).

## Out of scope

- #687 (5xx messages leak SQL text): a separate fix to the error path.
- Per-object `capabilities` on field-mapping payloads: #688.
- Read-route authorization *policy* changes, i.e. what members should be able to read. This enforces the existing seeded rules.
