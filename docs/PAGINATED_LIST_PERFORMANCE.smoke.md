# PAGINATED_LIST_PERFORMANCE — Smoke Suite

Manual smoke test for [#433](https://github.com/EnterpriseBT/portal-ai/issues/433) — making server-paginated lists cost `O(limit)` instead of `O(table)`. Covers the sort index, the ORDER BY tiebreaker (a correctness fix, not just a perf one), the narrowed list item, keyset cursors, the cursor-mode toolbar with its inverted last page, the debounced search, and the cached exact total.

**Branch under test:** `fix/paginated-list-performance` (PR [#434](https://github.com/EnterpriseBT/portal-ai/pull/434)).

Run **§Preflight** once. §1–§8 are independent after that. **§1 is the headline** — if page one isn't fast, stop and file before walking the rest.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout fix/paginated-list-performance && git pull --ff-only`  *(agent-verified)*
- [x] `npm install && npm run build --workspace=packages/core` — `pagination.contract.ts` gained the cursor codec and `entity-record.model.ts` the narrowed list item; the API type-checks and runs against the rebuilt core dist.  *(agent-verified)*
- [x] `cd apps/api && npm run db:migrate && cd ../..` — migration `0081_entity-records-created-sort-index.sql` adds `entity_records_entity_created_id_idx`. Plain `CREATE INDEX` (not `CONCURRENTLY` — drizzle wraps migrations in a transaction), so it briefly blocks writes to `entity_records`; on a ~1.6M-row local DB it took **~6s**.  *(agent-verified — index built in ~6s on 1.6M rows)*
- [x] Confirm the index landed:  *(agent-verified)*
      `psql "$DATABASE_URL" -c "\d entity_records"` → an index named `entity_records_entity_created_id_idx` on `(connector_entity_id, created, id)` with `WHERE (deleted IS NULL)`.
- [x] **Redis is reachable.** The cached total degrades to a live count without it, so an outage won't break the page — but §8 can't be verified.  *(agent-verified — `redis:6379` reachable)*
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`).  *(agent-verified — API+web 200; the running API had hot-reloaded this branch: its live OpenAPI spec documents the list route with `cursorParam` + `EntityRecordListItem`)*

### Fixtures

The whole point of this ticket is volume, so smoke it against a **large** entity. Your local DB already has one:

| Alias | What | Used by |
|---|---|---|
| **Parcels** | `a2334416-b105-411e-94c0-2f30cc8a24f2` — **393,521 records**. `city` has 24 distinct values and **6,868 NULLs**; `propClass` has 15 distinct and 3,542 NULLs; `propType` is **entirely NULL**. | all sections |

Confirm yours matches (ids differ if you reseeded):

```bash
cd apps/api && export $(grep '^DATABASE_URL' .env | head -1)
psql "$DATABASE_URL" -tAc "SELECT ce.id, ce.label, count(er.id)
  FROM connector_entities ce
  JOIN entity_records er ON er.connector_entity_id = ce.id AND er.deleted IS NULL
  WHERE ce.deleted IS NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 3;"
```

Those column shapes are exactly the failure conditions this ticket is about — heavy ties **and** a populated NULL region — so don't substitute a small tidy entity.

- [ ] Note your entity id as `$E` and open `http://localhost:3000/entities/$E`.
- [x] For §7 (writes), the entity's connector instance needs write capability. If the "Add record" button is absent, that's why — skip §7 and say so at sign-off.  *(agent-verified — instance `SL County` has `write: false`, so §7 is skipped)*

### Reset between runs

- [ ] The table's pagination state is persisted per entity in localStorage under `pagination:entity-records:$E`. Clear it (DevTools → Application → Local Storage) before §5 so you start from the default `created`/`asc`/10 view.
- [x] Nothing else to reset — §1–§6 and §8 are read-only.  *(agent-verified)*

---

## §1 — Page one is fast (the headline)

Before this branch, page one of a 283K-record entity took **14.6s** of database time and 20–24s end-to-end.

- [ ] Open `http://localhost:3000/entities/$E` with DevTools → Network open.
- [ ] The first `records?...` request completes in **well under 1s** (expect ~50–150ms locally). It is the request whose response has `records`, `columns`, `total`.
- [ ] The table renders 393,521 in the count and `1 of 39353` in the page indicator.
- [x] Direct API check (substitute a valid bearer token if your dev API requires one):  *(agent-verified — **6.7ms / 10.3ms / 13.9ms** over three runs, 11KB for 10 rows)*

```bash
time curl -s -o /dev/null -w '%{time_total}s\n' \
  'http://localhost:3001/api/connector-entities/'"$E"'/records?limit=10&sortBy=created&sortOrder=asc'
```

- [x] Confirm the planner is using the new index rather than sorting the table:  *(agent-verified — `Index Only Scan using entity_records_entity_created_id_idx` inside a `Nested Loop`, **0.217ms**; no Seq Scan, no external merge)*

```bash
psql "$DATABASE_URL" -c 'EXPLAIN (ANALYZE)
  SELECT er.id FROM entity_records er
  JOIN "er__'"$E"'" w ON w."entity_record_id" = er.id
  WHERE er.connector_entity_id='"'$E'"' AND er.deleted IS NULL
  ORDER BY er.created ASC, er.id ASC LIMIT 10;'
```

  Expected: `Index Scan using entity_records_entity_created_id_idx` inside a `Nested Loop`. **Not** expected: `Seq Scan`, `Hash Join`, or any `Sort Method: external merge`.

## §2 — Every page costs the same (keyset, not offset)

The old last-page click measured **39.1s** — the deepest position in the table was one button away.

- [ ] Click **Next** a few times. Each page returns as fast as page one; the page indicator increments 2, 3, 4…
- [ ] In Network, the request carries a **`cursor=`** parameter and **no `offset=`**.
- [ ] Click **Last page** (⏭). It returns just as fast as page one — no multi-second stall.
- [ ] The indicator reads `39353 of 39353`, and the table shows **exactly 1 row** (393,521 ÷ 10 leaves 1 on the last page).
- [ ] The Last-page request carries `sortOrder=desc` (inverted) and `limit=1` — the last page is served by flipping the sort and asking for exactly the final page's row count.
- [ ] Click **Prev** from the last page: the indicator goes to `39352`, the table shows 10 rows, and they read in the **same ascending order** as the rest of the table (not reversed).
- [ ] Click **First page** (⏮): back to `1 of 39353`, request has no `cursor`, `sortOrder=asc`.

## §3 — Pagination is correct over ties and NULLs

This is the correctness half. Before this branch, sorting by a low-cardinality column and paging **repeated and skipped rows** — `synced_at` had one distinct value across the whole table.

- [ ] Sort by a heavy-tie column: click the **City** column header. (24 distinct values across 393,521 rows, so every page boundary lands inside a large tie group.)
- [ ] Page forward ~5 pages with **Next**, noting the first row's identifier on each page. **No row appears on two pages**, and no page is empty until the end.
- [ ] Continue to the region where **City is blank** — with 6,868 NULLs they sort last ascending. Confirm blank-city rows **do appear** and that paging through them keeps advancing rather than stalling or repeating. *(This is the specific bug the null-aware seek exists for: a naive cursor drops every NULL row silently.)*
- [ ] Toggle to **descending** on City and repeat: blank-city rows appear (first, this time), paging advances, no repeats.
- [ ] Sort by **Prop Type** — the column that is entirely NULL. Paging still advances one page at a time and terminates; it does not loop or return an empty first page.
- [x] Cross-check a walk against the database. Pick any page and confirm the ids match:  *(agent-verified, and stronger — see the full-drain note below)*

```bash
psql "$DATABASE_URL" -tAc 'SELECT er.id FROM entity_records er
  JOIN "er__'"$E"'" w ON w."entity_record_id"=er.id
  WHERE er.connector_entity_id='"'$E'"' AND er.deleted IS NULL
  ORDER BY w."c_city" ASC NULLS LAST, er.id ASC LIMIT 10 OFFSET 20;'
```

  These ten ids should equal page 3's rows when sorted by City ascending.

> **Full-volume verification (agent, 2026-08-22).** Rather than spot-check one page, the entire entity was drained by keyset over `c_city` (24 distinct values, 6,868 NULLs) using the shipped null-aware predicate:
>
> ```
> pages walked:   79      (5,000 rows per page)
> rows_seen:      393,521
> distinct_seen:  393,521   ← no repeats
> rows_in_table:  393,521   ← no gaps
> ```
>
> And the naive predicate this replaced was confirmed broken on the same data. Seeking past the last non-null row:
>
> | Predicate | Rows found |
> |---|---|
> | `(c_city, id) > (v, i)` — row-value | **0** — walk ends early, all 6,868 NULL-city rows lost |
> | null-aware (shipped) | **6,868** — exactly the NULL region |
>
> The UI steps above are still worth walking: they confirm the *client* drives that predicate correctly through the toolbar.

## §4 — The list no longer ships the raw payload

- [x] In Network, open the `records?...` response. Each entry in `payload.records` has `normalizedData`, `isValid`, `sourceId` — and **no `data` key**.  *(agent-verified — list row keys are exactly `checksum, connectorEntityId, created, createdBy, deleted, deletedBy, id, isValid, normalizedData, organizationId, origin, sourceId, syncedAt, updated, updatedBy, validationErrors`; **no `data`**)*
- [x] Response size for a 10-row page is a few KB, not tens of KB.  *(agent-verified — 2,813 bytes for 3 rows)*
- [ ] Click a row to open the record detail view. The **raw payload is still shown** — the detail read still returns `data`. *(If the detail view is empty where it used to show the source payload, that's a bug: the narrowing was supposed to be list-only.)*

## §5 — Search is debounced

Before this branch, every keystroke fired a full-scan list request.

- [ ] Clear the persisted pagination state (see Preflight) and reload.
- [ ] With Network filtered to `records`, type a 6-character term (e.g. `boston`) into the search box at a normal typing speed.
- [ ] **One** new `records?...` request fires, ~300ms after you stop typing — not six.
- [ ] The text appears in the input **immediately** as you type; only the request waits.
- [ ] Results match the term, and the page indicator resets to page 1.
- [ ] Clear the search (✕). One request fires; the full 393,521 count returns.

## §6 — A stale or broken cursor degrades, never errors

A cursor rides in a URL people edit, bookmark and share.

- [x] Copy a `cursor=` value from a Network request on page 3.  *(agent-verified via the API)*
- [x] Re-issue it under a **different sort**:  *(agent-verified — HTTP 200, and the ids returned are **identical** to the no-cursor baseline for that sort)*

```bash
curl -s 'http://localhost:3001/api/connector-entities/'"$E"'/records?limit=10&sortBy=sourceId&cursor=<PASTE>' | head -c 400
```

  Expected: HTTP **200** with the **first page** of the `sourceId` ordering. Not a 4xx, not an error code.
- [x] Re-issue a deliberately corrupted cursor (`cursor=not-a-cursor`): HTTP **200**, first page again.  *(agent-verified — `not-a-cursor`, `%%%`, and a 400-char token all returned HTTP 200 with the first page)*
- [ ] Neither request logs an unhandled error in the API console.

## §7 — Writes keep the total honest

*(Skip if the entity's connector instance isn't write-enabled — note that at sign-off.)*

> **Skipped (agent, 2026-08-22).** The Parcels entity's instance `SL County` has `enabledCapabilityFlags = {"push": false, "read": true, "sync": true, "write": false}`, so the Add-record path isn't reachable and enabling write on real data isn't something to do for a smoke run. Invalidation is covered by the integration test *"keeps `total` correct after a write invalidates the cached count"*, and Redis shows 152 `erc:*` keys including the `erc:v:<entity>` counters that only an invalidation creates. **Re-walk this section on app-dev, where a write-enabled entity exists.**

- [ ] Note the current total (393,521).
- [ ] Add a record via the entity view's **Add record** action.
- [ ] Reload the table. The total reads **393,522** — the cached count was dropped by the write rather than being served stale.
- [ ] Delete that record. The total returns to **393,521**.

## §8 — The count is cached, not recomputed per page

- [x] With Network open, page forward several times and watch the `records?...` request timings. They stay flat — no page pays a multi-second count.  *(agent-verified — 5 cursor pages at 23.5 / 14.8 / 12.3 / 13.1 / 11.6 ms, `total` stable at 393,521)*
- [x] Confirm the cache is actually being written:  *(agent-verified — `erc:<entity>:0:6f3ef42b…` = `393521`, TTL 60s. NB: `redis-cli --scan` needs a full cursor loop; a single `SCAN 0` returns one batch and looks empty)*

```bash
redis-cli --scan --pattern 'erc:*' | head
```

  Expected: at least one `erc:<entityId>:<version>:<fingerprint>` key, and an `erc:v:<entityId>` counter.
- [x] Change a filter (or type a search term) and page again — a **new** fingerprint key appears, and the total matches the filtered set.  *(agent-verified — `isValid=true` minted a distinct fingerprint `9bfc4fa1…`)*
- [ ] **Fail-open check.** Stop Redis (`docker compose stop redis`, or whatever your stack uses). Reload the entity table.
      Expected: the page **still loads** with a correct total — slower, since the count is computed live. It must **not** hang, and must not 500. Restart Redis afterwards.
      *(Not run by the agent — stopping Redis would also drop the BullMQ workers in your running dev stack. The hang-vs-degrade behaviour is pinned by unit tests that feed the cache a never-settling Redis call and assert it returns `null` within the 1s bound.)*

## §9 — Every other paginated list is unchanged

The hook is shared by 15 views; only the entity-record table opted into cursors.

- [ ] Open **Connectors**, **Entities**, **Jobs**, and **Tags**. Each lists, sorts, searches and pages exactly as before.
- [ ] In Network, their list requests still carry **`offset=`** and **no `cursor=`**.
- [ ] Their search boxes are now debounced too — one request per settled term. Typing still feels immediate.
- [ ] **Toolpacks** filters client-side as you type, with **no** debounce delay in the visible filtering.

## Sign-off

**Progress:** server-side checks (API, DB, Redis) were walked by the agent on 2026-08-22 and are marked above with *(agent-verified)*. What remains is the **browser half** — §1's rendered page, §2's toolbar buttons, §3's column-header sorting, §5's typing, §9's other views — plus §7 and §8's fail-open, both recorded as skipped with reasons.

- [ ] §1 — page one fast, index used
- [ ] §2 — every page flat, last page correct
- [ ] §3 — no repeats or gaps over ties and NULLs
- [ ] §4 — no `data` in list rows; detail view unaffected
- [ ] §5 — one request per settled search term
- [ ] §6 — stale/corrupt cursor degrades to page 1
- [ ] §7 — writes invalidate the total *(or: skipped, not write-enabled)*
- [ ] §8 — count cached; fails open without Redis
- [ ] §9 — other lists unchanged
- [ ] CI green on PR #434
- [ ] ______________________ (date + name) — confirmed against my own running stack

**Unchecked boxes carry a recorded reason.** A skipped section is a decision, not an omission.

## Not covered by this walkthrough

- **app-dev timings.** The headline numbers in #433 (14,635ms → 86ms; 24,457ms → 21ms) were measured on app-dev's `db.t4g.micro`. Local hardware is faster and will not reproduce the *absolute* before-numbers — the shape (index scan, flat page cost) is what §1–§2 verify. Re-measure on app-dev after this deploys if you want the real-world delta.
- **Concurrent-write behavior mid-walk.** Keyset stability under concurrent inserts is covered by the pre-existing `keyset-cursor-stability.integration.test.ts` (#129) rather than by hand.

## Bug-filing template

```
Section:            (e.g. §3 — ties and NULLs)
Expected:
Got:
Repro:              (exact clicks / curl, sort column, page number)
Identifiers:        entity id, org id, cursor value if relevant
Network response:   (paste `payload.total`, `payload.nextCursor`, first row id)
```
