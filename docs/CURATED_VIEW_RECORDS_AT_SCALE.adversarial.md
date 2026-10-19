# CURATED_VIEW_RECORDS_AT_SCALE — Adversarial Review

Adversarial probes for [#649](https://github.com/EnterpriseBT/portal-ai/issues/649) — keyset paging, server-side `reverse`, text-only trigram search and a cached total on curated-view records, plus the hourly search-index sweep. **Branch under test:** `chore/649-curated-view-records-at-scale` (PR [#820](https://github.com/EnterpriseBT/portal-ai/pull/820)).

The new attack surface is a **client-supplied cursor** (base64 JSON whose `value`/`id` reach SQL), the `reverse` flag, the rewritten search predicate, and a **shared count cache** keyed per view scope. Probes concentrate there.

## Preflight

### Environment
- [ ] `chore/649-curated-view-records-at-scale` checked out, `npm run dev` up (web :3000, API :3001), migration 0126 applied
- [ ] Playwright MCP available; `e2e:auth:all` fixtures present (owner, admin, member)

### Fixtures
- [ ] The smoke fixtures: **contacts** entity (≥ 30 rows; text `name`/`city`, number `age`, datetime `seen`; some empty cells) and the **all-cols view** on it
- [ ] An owner bearer token from the e2e storageState, for the `— backend` request probes
- [ ] A curated view id from a **different** org (any org the e2e owner isn't a member of), for §5

### Reset between runs
- [ ] Probes that mutate (§3, §6) restore what they changed; note any id they leave behind in the Findings

## §1 — Boundary & limit inputs
- [ ] `GET /api/curated-views/<view>/records?limit=0` and `?limit=100000` — expected SAFE: a `400 CURATED_VIEW_INVALID_QUERY`, or a clamp to the contract max; never an unbounded page. — backend
- [ ] Walk to the true end, then replay the final page's request with the previous page's `nextCursor` — expected SAFE: the last rows again with `nextCursor: null`, never an empty page carrying a cursor (an infinite Next). — backend
- [ ] A view over an **empty** entity: open it, click Next and Last — expected SAFE: `0` rows, Next and Last disabled, no error and no request loop.
- [ ] Search with a 5,000-character term — expected SAFE: `200` with `0` rows (or a clean `400`), no 500. — backend

## §2 — Malformed & injection input
- [ ] A forged cursor whose `value` is SQL: base64 of `{"sortBy":"city","sortOrder":"asc","value":"x' OR 1=1; DROP TABLE users;--","id":"00000000-0000-0000-0000-000000000000"}` with `sortBy=city&sortOrder=asc` — expected SAFE: `200`, rows seeking past the literal string (the value is a bound parameter); `users` still exists. — backend
- [ ] A forged cursor whose `id` isn't a uuid (`"id":"not-a-uuid"`) and one whose `value` has the wrong type for its column (`"value":"abc"` under `sortBy=age`) — expected SAFE: a page-1 fallback or a clean `400`; never a `500` from a Postgres cast error. — backend
- [ ] A forged cursor with an extra key, a `reverse` of `"yes"`, or a JSON array body — expected SAFE: `200`, never a `500`. A non-object body or a bad `reverse` fails to decode and page 1 is served; an extra key is stripped by the schema and changes nothing. — backend
- [ ] `sortBy=city;DROP TABLE users` and `sortBy=<a column not in the view>` — expected SAFE: `400 CURATED_VIEW_INVALID_SORT` or the `_record_id` fallback; never interpolated. — backend
- [ ] Search `'`, `\`, `\%`, `O'Brien` in the browser — expected SAFE: no error alert, rows match only literally.

## §3 — Concurrency & races
- [ ] Mid-walk on page 2, delete the record that was the last row of page 1 (the cursor's anchor), then click Next — expected SAFE: the seek still works off the anchor's values; no row repeated, none skipped among the survivors. — backend
- [ ] Mid-walk, insert a record that sorts before the cursor — expected SAFE: no `500`, no repeated rows; the new row simply isn't on later pages, and the total updates on the next count. — backend
- [ ] Sweep vs. a reconcile holding the entity lock — expected SAFE: the sweep reports `busy` and leaves the lock free. Covered by the integration test "skips an entity whose lock a reconcile or write holds". — backend

## §4 — Auth & permission boundaries
- [ ] As a **narrow-grant** member (reads the view, not its `city` mapping), search a term that occurs only in `city` — expected SAFE: `0` rows, so search can't be used as an oracle on an unreadable column. — manual
- [ ] Same member: a forged cursor with `sortBy=city` — expected SAFE: the anchor is ignored (city isn't in their effective sort set), and they get page 1 sorted by an allowed key or a `400`; no city values in the response. — manual
- [ ] Same member and an owner load the same search back to back — expected SAFE: different totals when grants differ (separate `viewScope` fingerprints); the member never sees the owner's cached total. — manual
- [ ] As **member** without read on the view: `GET …/records` — expected SAFE: `404`, the same as a view that doesn't exist.

## §5 — Multi-tenant isolation
- [ ] As the e2e owner, `GET /api/curated-views/<other org's view id>/records` with and without a cursor — expected SAFE: `404`, no rows, no total. — backend
- [ ] Replay a cursor minted on view A against view B (same org, different entity) — expected SAFE: `200` and B's own rows (the cursor carries only a sort value and a record id; it can't import A's data). — backend
- [ ] Redis `erc:*` keys: every key carries an entity id, and the two orgs' views produce disjoint keys — expected SAFE: no key is shared across entities. — backend

## §6 — State & lifecycle abuse
- [ ] Delete the view while on page 2, then click Next — expected SAFE: a `404`-driven "not found" state, no stale rows.
- [ ] Retire the column a walk is sorted by (remove it from the view's projection), then replay the cursor — expected SAFE: page 1 under the fallback sort, or `400 CURATED_VIEW_INVALID_SORT`; never a `500` on a missing column. — backend
- [ ] Soft-delete a record, then search for its unique name — expected SAFE: `0` rows and the total drops (the count cache's version bump covers deletes). — backend

## §7 — Misuse sequences
- [ ] Click **Last**, then the browser **Back** button, then **Next** — expected SAFE: a coherent page and pager; no blank table, no duplicated rows.
- [ ] On the Last page, change the page size — expected SAFE: the walk restarts at page 1 with the new size.
- [ ] Rapidly click Last, First, Last — expected SAFE: the final state is the last page with the correct rows; no interleaved stale response wins.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
