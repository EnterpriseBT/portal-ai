# Same-org read disclosures — Condensed design (#694)

**Issue:** [EnterpriseBT/portal-ai#694](https://github.com/EnterpriseBT/portal-ai/issues/694) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The #692 read-route inventory left five low-severity, same-org disclosures: a route checks the object it was asked for, then returns data derived from *other* objects (a portal, records, member entities) without checking the caller can read those. Each fix applies an existing read pattern (`visibilityPredicate`, `readableInOrg`, the handle's `_userId`). `apps/api` only; no contract change.

## Current shape

| # | Piece | Location | Note |
|---|---|---|---|
| 1 | Handle GET user check | `routes/portal-sql-handle.router.ts:100-110` | 404 on org mismatch, or `_userId` **present** and ≠ caller; absent ⇒ any org member |
| 1 | Webhook write token | `services/webhook-read-token.service.ts:28-39` (`TokenRecord`), `mint()` :64 | org, handle, mode, stationId — **no user** |
| 1 | Token minted | `tools/webhook.tool.ts:219-235` (`buildOutputGrant`); tool built at `services/tools.service.ts:865` inside `buildAnalyticsTools(…, userId)` | `userId` in scope, not passed |
| 1 | Staging | `routes/webhook-handle.router.ts:221-226` → `produceFromRows` (`portal-sql-handle.service.ts:232-237`) | helper already sets `_userId` when given (:439); `produce`/`produceFromTransform`/`produceFromStream` all pass it |
| 2 | Pin list `include=portal` | `db/repositories/portal-results.repository.ts:50-79` (`findManyWithPortal`) | bare `LEFT JOIN portals`; route `routes/portal-results.router.ts:443-499` |
| 2 | Portal read pattern | `routes/portal.router.ts:235` | `set.visibilityPredicate("portal", {createdByCol, idCol})` |
| 3 | validate-bidirectional | `routes/field-mapping.router.ts:1209-1330` | both entities' records via `findHydratedMany` (:1265-1274), unfiltered; returns `inconsistentRecordIds`, `totalChecked` |
| 4 | Group members list | `routes/entity-group-member.router.ts:129-165` | every member's `connectorEntityLabel` (:158) |
| 5 | Overlap | `routes/entity-group-member.router.ts:758-915` | target + member records unfiltered (:847-851, :870-883); member entity unchecked |
| — | Record predicate precedent | `routes/entity-group.router.ts:1022-1058` (#658) | `visibilityPredicate("entity_record", {createdByCol: entityRecords.createdBy, idCol: entityRecords.id})` ANDed into the read |
| — | Entity check | `ObjectAccessService.readableInOrg(set, org, "entity", row)` (`services/object-access.service.ts:19-31`) | in-memory on an already-joined row |

`findHydratedMany` already takes `opts.where` (`db/repositories/entity-records.repository.ts:607-642`), so 3 and 5 need no repository change.

## Decision — how each leak closes

1. **Handles: bind the webhook-staged handle to the invoking user.** Thread `userId` `buildAnalyticsTools` → `WebhookTool` → `mint({…, userId})` → `TokenRecord.userId` → `produceFromRows({…, userId})`. The GET check stays as is: binding the producer is the fix, and other producers (jobs) may legitimately omit a user. *Not chosen:* failing closed on a missing `_userId` in GET. It would strand any handle produced without a user, and the token is the only staging path this ticket covers. A rows handle with `_userId` is safe: `requireHandleUser` (:99-107) only gates the `sql` re-execute paths.
2. **Pin portal name: AND the `portal` visibility predicate into the join's `ON`.** An unreadable portal yields `portalName: null`; the pin row is unchanged. The contract already allows null (`packages/core/src/contracts/portal.contract.ts:126`). The repository takes the predicate as an argument; it never builds RBAC itself.
3. **validate-bidirectional: filter side A by the `entity_record` predicate** (the #658 shape). `inconsistentRecordIds` and `totalChecked` then cover only readable records. Side B is still read whole, because a counterpart the caller can't read exists: an A record pointing at one is *not checkable*, not broken. Filtering B as well reported correct links as inconsistent (found in code review). The counterpart mapping's existence (`isConsistent`) is metadata of a mapping the caller can already read, so it stays.
4. **Group members: drop members whose entity fails `readableInOrg(…, "entity", …)`** (`ObjectAccessService.readableGroupMembers`), on every route that returns a group's members: the member list, overlap, group detail and `/resolve` (the last two found in review). That is *unreadable == absent*. *Not chosen:* nulling the label, because `connectorEntityLabel` is `z.string()` in two core contracts (`entity-group.contract.ts:16`, `entity-group-member.contract.ts:85`), and nulling it would be a contract change plus web null-handling.
5. **Overlap: skip unreadable member entities (same check as 4) and filter both record reads by the `entity_record` predicate.** Counts and percentage then describe only what the caller can read.

## Plan — 3 slices

**Slice 1: handle user binding.**
Files: `services/webhook-read-token.service.ts`, `tools/webhook.tool.ts`, `services/tools.service.ts`, `routes/webhook-handle.router.ts`.
Tests:
- `__tests__/tools/webhook.tool.test.ts`: the grant carries `userId`.
- `__tests__/__integration__/routes/webhook-handle.router.integration.test.ts`: a staged handle's meta has `_userId`, and another org member's `GET /api/portal-sql/handle/:id` returns 404.
- `__tests__/routes/portal-sql-handle.router.test.ts:155` stays: it pins the GET semantics for no-user producers.

**Slice 2: pin portal name.**
Files: `db/repositories/portal-results.repository.ts`, `routes/portal-results.router.ts`.
Tests: `portal-results.router.integration.test.ts` (near :756) adds a member case. A pin is shared with the member from the owner's portal: `portalName` is null, and the pin is still listed.

**Slice 3: record/entity filtering.**
Files: `routes/field-mapping.router.ts`, `routes/entity-group-member.router.ts`.
Tests:
- `field-mapping.router.integration.test.ts`, #692 block (:2291-2420): a member reading a mapping through a curated view gets only readable ids and counts.
- `entity-group-member.router.integration.test.ts`: a member-vs-owner case. The list omits an unreadable member entity, and overlap counts only readable records and skips the unreadable member.
- Update the route-map notes at `__tests__/config/route-authorization.map.ts` :256, :260, :296, :382, :740.

Run `npm run test:unit` and `npm run test:integration -- --testPathPattern <file>` for touched files only, plus `npm run type-check` and `npm run lint` in `apps/api`.

## Smoke (manual, against your dev stack)

Run as owner and member of one org (e2e fixture, `e2e:use <role>`).

1. **Handle:** as the member, run a custom webhook tool in a portal that stages rows, and note the `qh-…` id. As the owner, `curl` `GET /api/portal-sql/handle/<id>`: expect **404**. As the member: expect **200**.
2. **Pin name:** the owner shares a pin from their own portal with the member. As the member, `GET /api/portal-results?include=portal`: the pin is listed and `portalName` is `null`. As the owner: the name is present.
3. **validate-bidirectional:** as a member reading a bidirectional mapping through a curated view, the response's `inconsistentRecordIds` and `totalChecked` cover only records the member can read. As the owner on the same mapping, the counts are full.
4. **Group members:** the owner creates a group whose members include an entity the member can't read. As the member, the members list omits it. The overlap check against that group skips that member, and its counts match the member's readable records.
5. **No regression:** as the owner, all four surfaces match their pre-change output.

## Out of scope

- Failing closed in the handle GET for handles produced with no user (see Decision 1).
- Hiding a mapping's counterpart existence from validate-bidirectional.
- A batch "readable ids" helper for portals. The join predicate makes it unnecessary here.
- The other open permissions follow-ups, #687 (5xx SQL text) and #699 (portal header), which get their own branches.
