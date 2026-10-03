# Field-mapping read check — Condensed design (#692)

**Issue:** [EnterpriseBT/portal-ai#692](https://github.com/EnterpriseBT/portal-ai/issues/692) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The four field-mapping GET routes don't authorize reads (and the GET inventory found ~15 more; see Plan):
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

## Plan — 8 slices (amended: the GET inventory found ~15 more unchecked reads)

Each slice is an owner / member / other-org integration test first (via `seedTenancyFixture` or the suite's helpers), then the fix, then one commit. Runs use `npm run test:integration -- --testPathPattern <suite>`.

1. **Field mappings (done, 8969089d).** List visibility; by-id/impact/validate via `loadReadableMapping`.
2. **Connector entities** (`connector-entity.router.ts`, `entity-tag-assignment.router.ts`, `field-mappings.repository.ts`). `GET /:id` and `/:id/impact` gain the org check. `countByRefEntityKey` is filtered to the caller's org. `GET /:id/tags` requires the entity in-org and readable, and lists only readable tags.
3. **Entity-group members** (`entity-group-member.router.ts`). The list and overlap require the group in-org and readable. Overlap also requires the target entity in-org and readable, and the target mapping in-org and on that entity.
4. **Records, definitions, views.** The records list/count/by-id add `can read entity` on the parent. `GET /connector-definitions/:id` checks `resource.read connector_definition` (404). `GET /curated-views?stationId=` requires the station in-org and readable (404).
5. **Uploads + map tiles.** `sheet-slice` calls `FileUploadAccessService.assertOwnUploadSession`. The message tile loads its portal through `PortalAccessService.load`. The pin tile checks `resource.read pin`. All return 404.
6. **Jobs.** A `JobPayloadRedaction` shared by `GET /api/jobs`, `GET /api/jobs/:id` and the job-events SSE: non-creators without `* *` receive the row with `metadata` and `result` removed (id/type/status/progress/timestamps/error kept).
7. **Small ones.** `GET /api/grants` on an unreadable object returns 404, not 403. `/field-mappings/:id/impact` omits a counterpart the caller can't read.
8. **Guard.** `ROUTE_AUTHORIZATION` gains all 80 GET entries; the test filter covers every route (floor > 180, GETs > 80; the self-test probes a read). Plus the CLAUDE.md authorization bullet ("every route, reads included") and its mirror.

## Smoke (manual, against your dev stack)

Tokens as in the #685 smoke: `$OWNER`, `$MEMBER` (in `e2e-fixture`), `$OTHER` (a caller switched into another org). `FM` = an owner-created mapping on an entity the member can't read.

1. `GET /api/field-mappings?limit=100` as `$MEMBER` → only mappings the member can read (not the owner's `FM`); as `$OWNER` → all.
2. `GET /api/field-mappings/$FM` as `$MEMBER` → `404 FIELD_MAPPING_NOT_FOUND`; as `$OTHER` → `404`; as `$OWNER` → `200`.
3. `GET /api/field-mappings/$FM/impact` and `/validate-bidirectional` as `$MEMBER` and `$OTHER` → `404`; as `$OWNER` → `200`.
4. **Browser, member:** the member's own entity's detail page still lists its field mappings and the mapping edit dialog opens; no new console 404s on their own pages.
5. **Browser, owner:** the entity detail and column-definition pages still list mappings; the impact preview before deleting a mapping still loads.
6. `$OTHER` → `404` on `GET /api/connector-entities/<owner entity>`, `/impact`, `/tags`, and `GET /api/entity-groups/<owner group>/members` (and `/members/overlap?…`). `$OWNER` → `200`.
7. `$MEMBER` → `404` on `/api/connector-entities/<owner entity>/records`, `/api/connector-definitions/<unreadable def>`, `/api/curated-views?stationId=<unreadable station>`, `/api/file-uploads/sheet-slice?uploadSessionId=<owner's session>…`, a map tile from the owner's portal message and from an unshared pin.
8. `$MEMBER` → `GET /api/jobs/<owner's job>` returns the row **without** `metadata`/`result`; for their own job, with both. `$OWNER` sees both on every job. The browser Jobs list and job detail still load for both.
9. `$MEMBER` → `GET /api/grants?resourceType=station&resourceId=<unreadable station>` → `404`.

## Adversarial

All probes are `— backend` (API with real `$OWNER` / `$MEMBER` / `$OTHER` tokens, as in Smoke) unless marked. "Safe" means: refused with the route's 404 (unreadable == absent), nothing from the hidden row in the body, and nothing written.

**§1 Boundary.**
- [ ] `$MEMBER` `GET /api/field-mappings?limit=100000&offset=0` and `?offset=999999`. Safe: the limit is capped, and both pages hold only readable mappings, with `total` counting readable rows only.

**§2 Malformed input.**
- [ ] A NUL byte or junk id on the fixed by-id reads (`/field-mappings/%00`, `/connector-entities/%00/tags`, `/entity-groups/%00/members`). Safe: no row from any org. A 5xx whose message carries SQL text is #687, recorded but not this ticket's.
- [ ] Overlap with a missing or garbage `targetLinkFieldMappingId`. Safe: 400, no record counts.

**§4 Permission boundaries.**
- [ ] **A share grants mapping read; revoking removes it.** The owner shares a curated view over their entity (with the mapping projected) Read with the member. The member's GET of that mapping is 200 and it's in their list. The owner revokes the share. Safe: the member's GET is 404 again and it leaves the list.
- [ ] `$MEMBER` `GET /api/jobs?search=<text in the owner's job error or metadata>`. Safe: no payload is reachable through filtering; matched rows are still redacted.
- [ ] `$MEMBER` `GET /api/field-mappings?include=connectorEntity`. Safe: only readable mappings, so no unreadable entity rides along in the include.

**§5 Multi-tenant.**
- [ ] Another org's ids in **query params**: `$OWNER` `GET /api/field-mappings?connectorEntityId=<other org entity>` and `?columnDefinitionId=<other org column>`, `GET /api/curated-views?connectorEntityId=<other org entity>`. Safe: empty results, nothing from the other org.
- [ ] `$OWNER` `GET /api/portal-map/tiles/pin/<other org pin>/0/0/0` and `GET /api/grants?resourceType=pin&resourceId=<other org pin>`. Safe: 404.
- [ ] **Org switch:** the member switches to their personal org, then GETs their own `e2e-fixture` mapping and job by id. Safe: 404 (access follows the current org). Switching back restores access.

**§6 Lifecycle.**
- [ ] A soft-deleted mapping, entity and group: by-id reads, records and members all 404 for the owner too.
- [ ] **Removed member:** the owner removes the member from the org, and the member's still-valid JWT GETs their own mapping, job and entity. Safe: refused, nothing returned. Restore with `e2e:seed`.
- [ ] **Demoted admin:** the admin reads a member's job (payload visible), is demoted to member, and re-reads with the same token. Safe: payload redacted at once (permissions load per request).

**§7 Misuse.**
- [ ] **Id harvesting through jobs:** the member lists `GET /api/jobs?type=dissolve_precompute,file_upload_parse` to find the owner's message, pin and upload-session ids. Safe: the metadata is redacted, so no ids leak to feed the tile or sheet-slice routes.

**§3 Concurrency:** N/A. These are reads with no write path; staleness is covered by §4 and §6.

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 NUL-byte ids on the fixed by-id reads | 500 whose message is the raw SQL text + params (`/field-mappings/%00`, `/connector-entities/%00/tags`, `/entity-groups/%00/members`). No row from any org; the query fails before returning. | low | waived: pre-existing app-wide (≈151 handlers echo `error.message`), filed as #687 |
| §4 `include=connectorEntity` as a member | `rows=0` (the member owns no mapping: members can't read any column definition, a #630 rule), so the include couldn't carry anything. While the view was shared, the member's list held exactly the shared mapping (`rows=1`). | none | expectation holds (only readable rows); a richer include probe needs a member-owned mapping |
| Smoke §7 (observed): owner map tile on a **non-map** block | 500 "column src.geom does not exist": past authorization, the renderer runs a data-table pipeline. Members are refused before rendering. | low | pre-existing robustness bug (should 404/400), not authorization; to file |
| _All other probes_ | Held. §1 limit/offset stay filtered. §2 overlap with missing or garbage params → 400. §4 share → 200 + listed, revoke → 404 + unlisted; job search/type filters return others' rows redacted. §5 other-org ids in query params → empty; other-org pin → 404 on tiles and grants; org switch → 404, switching back restores. §6 deleted mapping/entity/group → 404 for the owner; demoted admin redacted on the next request; removed member's token → 404 / empty. §7 job lists leak no message/pin/upload ids. | — | — |

## Out of scope

- #687 (5xx messages leak SQL text): a separate fix to the error path.
- Per-object `capabilities` on field-mapping payloads: #688.
- Read-route authorization *policy* changes, i.e. what members should be able to read. This enforces the existing seeded rules.
