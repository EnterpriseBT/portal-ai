# curated-view-records-at-scale — Smoke Suite

Manual smoke test for [#649](https://github.com/EnterpriseBT/portal-ai/issues/649). It covers:

- curated-view records paged by keyset cursor, with a cached, grant-scoped total
- the exact-mirror last page on both tables
- text-only search over trigram indexes
- cast-free string filters
- the hourly search-index sweep
- `pg_trgm`, and what the trigram indexes cost sync writes

**Branch under test:** `chore/649-curated-view-records-at-scale` (PR [#820](https://github.com/EnterpriseBT/portal-ai/pull/820)).

Run **§Preflight** once. After that the sections are independent. Each step is tagged:

- **untagged:** `/smoke-walk` can drive it in the browser.
- **`— backend`:** read the DB, Redis or the API log.
- **`— manual`:** a human walks it.

§8 (sync cost) and §9 (app-dev) are **merge decisions**, not only checks.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link the section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout chore/649-curated-view-records-at-scale && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The pagination contract gained `reverse`, so the API and web need the rebuilt core dist.
- [ ] `cd apps/api && npm run db:migrate && cd ../..`. Migration `0126_enable-pg-trgm.sql` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, and `npm run dev` only seeds, it doesn't migrate.
- [ ] `psql "$DATABASE_URL" -c "\dx pg_trgm"` lists the extension. — backend
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). The API log shows the maintenance worker attaching with no error about `wide-table-search-index-sweep`.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **contacts** | An entity in the e2e org (`npm run --workspace @portalai/e2e e2e:seed`) with **≥ 30 records** and a mix of column types: at least two text columns (string or enum, say `name` and `city`), one number (say `age`), one datetime. Some cells in `city` and `age` must be **empty**. A CSV upload through the File Upload connector is the quickest way to get this. | §1–§6 |
| **all-cols view** | A curated view on **contacts** projecting every column, no filter. | §1, §3–§5 |
| **narrow-grant member** | Read access to the all-cols view plus only **some** of its field mappings (Settings → Access). The e2e member can't read entities ([[project_e2e_member_fixture_limits]]), so grant through Access or use a second real login. | §5b |

### Reset between runs

- [ ] Nothing to reset for §1–§5, which are reads. In §6, recreate any index you dropped, or let the sweep rebuild it. §8 leaves an extra connector instance behind; delete it afterwards.

---

## §1 — Curated-view table pages by keyset (spec AC 1–3)

- [ ] Open the **all-cols view**, sorted by `created` (the default), with 10 rows per page. The toolbar shows the total (e.g. "1–10 of 34").
- [ ] Click **Next** twice. In the network panel each `GET /api/curated-views/<id>/records` after the first carries `cursor=…` and no growing `offset`. Each response has `payload.nextCursor` as a string.
- [ ] Walk to the end with **Next**. Every row shows up exactly once (spot-check that the first row of each page wasn't on the previous one), and the last page's response has `nextCursor: null`.
- [ ] From page 1, click **Last**. The request carries `reverse=true` and the **same** `sortOrder` as before (not flipped). The rows are the final rows of the forward order, in forward order.
- [ ] Sort by **age ascending** and click **Last**. The last page ends in the rows with an **empty** age, because NULLs come last. Before #649 this page showed the highest ages.
- [ ] Sort by **age descending**. The empty-age rows are still at the **end**, and rows sharing an age keep a stable order between page loads.
- [ ] Sort by the **datetime** column, then walk Next to the end. No row repeats or goes missing.
- [ ] Change the sort while on page 3. The table returns to page 1 of the new order, not page 3.
- [ ] Stale cursor: copy a `cursor` value from an age-sorted request and replay it with `sortBy=name`: `curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/curated-views/<id>/records?sortBy=name&limit=10&cursor=<copied>"`. You get **200** with page 1 of the name order. `cursor=garbage` gives the same 200 and page 1. — backend

## §2 — Entity table last page (shared fix, slice 1b)

- [ ] Open **contacts** in the entity records table, sort by `city` ascending, and click **Last**. The request carries `reverse=true` and an unchanged `sortOrder`, and the page ends in the **empty-city** rows.
- [ ] Sort by `city` descending and click **Last**. The page holds the lowest cities, followed by the empty-city rows.
- [ ] Click **First** and **Next** after a Last. Paging forward works normally, and the requests carry no `reverse`.

## §3 — Text-only search (spec AC 4)

- [ ] In the view table, the search box placeholder reads **"Search text columns"**.
- [ ] Search a **substring** from the middle of a `name` value (e.g. `ris` for "Morrison"). The matching rows come back, and the total shrinks to match.
- [ ] Search a value that appears only in **age** (e.g. `42`). **No rows**: numbers aren't searched, so a filter is the way to reach them.
- [ ] Search a year that appears only in the **datetime** column. **No rows.**
- [ ] Search `%` and then `_`. They match only cells containing a literal `%` or `_`, not every row.
- [ ] Clear the search. The full total returns.

## §4 — String filters without the cast (slice 4)

- [ ] View table: add a filter **name contains `ri`**. The rows narrow correctly.
- [ ] Repeat with **starts with** and **ends with**. Each is correct and **case-insensitive**, matching what it did on `main`.
- [ ] Entity records table: the same `contains` filter on `city` narrows correctly (this path shares the filter code).
- [ ] Combine a filter, a search and a sort, then page Next and Last. Everything composes, and the total reflects every condition.

## §5 — Cached total, scoped by grants (spec AC 8)

### §5a — Cache window

- [ ] Open the view and note the total. `redis-cli --scan --pattern 'erc:<contacts-entity-id>:*'` shows at least one key. — backend
- [ ] Press **Next**, **Prev**, **Next** within 60s. The total doesn't change, and the API log shows no new count query for these requests (or watch `pg_stat_statements` `calls` for the `SELECT COUNT(*)::int AS n FROM "er__…"` statement, which stays flat). — backend
- [ ] Edit one record so it no longer matches an active search (or delete it), then reload. The total updates straight away: the write bumped the entity's count version.

### §5b — Grant isolation — manual

- [ ] As the owner, open the view with a search that matches a value in a column the **narrow-grant member** can't read. Note the total.
- [ ] As the narrow-grant member, open the same view with the same search. Their total counts **only** matches in columns they can read, and it is **not** the owner's number.
- [ ] Each caller reloads. Neither ever sees the other's total.

## §6 — Trigram indexes and the sweep (spec AC 5–7)

- [ ] **New column gets its index at first sync.** Add a new **string** field mapping to **contacts** (or import a new entity), then run `psql "$DATABASE_URL" -c "\di er__<entity-id>*_trgm"`. One `_trgm` index exists per text column, including the new one, and none on number or date columns. — backend
- [ ] **Index use.** `EXPLAIN SELECT * FROM "er__<id>" WHERE c_city ILIKE '%bos%'` shows a `Bitmap Index Scan` on the `_trgm` index. On a small fixture the planner may pick a Seq Scan, which is fine (CLAUDE.md, don't assert plans on small tables); the production-sized evidence is the PR measurement comment. — backend
- [ ] **Sweep builds a missing one.** Drop one `_trgm` index by name, then wait for the next **:45** past the hour. The API log has `Wide-table search-index sweep finished` with `built ≥ 1`, and `\di` shows the index back with `indisvalid = true`. — backend
- [ ] **Sweep drops a retired column's index.** Delete a text field mapping on **contacts** that no view uses, so the column is retired. After the next :45 sweep the log shows `dropped ≥ 1` and that column's `_trgm` index is gone. — backend
- [ ] **Sweep yields to a held entity lock.** In psql, run `BEGIN; SELECT pg_advisory_xact_lock(<entityLockKey>);` (or start a large layout-plan commit on that entity) while an index is missing. The :45 sweep logs `busy ≥ 1` for it, and the run after it builds the index. Optional; an integration test already covers it. — backend

## §7 — OpenAPI and docs

- [ ] `http://localhost:3001/api/docs` → `GET /api/curated-views/{id}/records` lists `cursor` and `reverse`. `nextCursor` is typed string-or-null, and the `search` description says text columns only.
- [ ] `GET /api/entity-records…` list operations list the `reverse` parameter.
- [ ] `deploy/helm/portalai/README.md` names `pg_trgm` as a database requirement. — manual

## §8 — Sync write cost (merge decision) — manual

The trigram indexes are the only change to the write path. Measured on the wide-table step alone they made it about 7.8× slower for inserts and 4.9× for updates; this section measures a **whole** import. Run it on your local stack, since app-dev runs `main` only until merge. Don't save any source file while an import runs: nodemon restarts the API and kills the job ([[project_local_env_unsuitable_for_long_jobs]]).

- [ ] Generate a 100K-row CSV with four text columns plus a number and a date:
  ```bash
  python3 -c "
  import random,string,datetime
  r=lambda n:''.join(random.choices(string.ascii_lowercase,k=n))
  print('id,name,city,email,status,score,joined')
  for i in range(100000):
      print(f'{i},{r(10)} {r(8)},{r(9)},{r(7)}@{r(5)}.com,{random.choice([\"open\",\"closed\",\"hold\"])},{random.randint(0,999)},{datetime.date(2020,1,1)+datetime.timedelta(days=i%1500)}')
  " > /tmp/sync-cost.csv
  ```
- [ ] **Baseline on `main`:**
  1. `git checkout main && npm run build --workspace=packages/core`, then restart `npm run dev`.
  2. Import `/tmp/sync-cost.csv` through the File Upload connector, mapping name, city and email as **string** and status as **enum**.
  3. When the job completes, read `SELECT (completed_at - started_at) AS ms FROM jobs WHERE id = '<job-id>'`.
  4. Record **baseline ms**.
- [ ] **This branch:** check out the branch, rebuild core, migrate, restart `npm run dev`, and repeat the same import into a **new** connector instance. Confirm `\di er__<new-entity-id>*_trgm` shows **4** indexes, then record **branch ms**.
- [ ] **Re-sync (update path):** re-upload the same file to the branch's instance, changing one column in every row (e.g. regenerate with a different `city`), and record the duration. Do the same on `main`.
- [ ] **Decision:** slowdown = branch ms ÷ baseline ms − 1. If **either** the import or the re-sync is **> 25%** slower, file the "index only columns a view shows" ticket and resolve it **before merge**. Otherwise record both numbers on PR #820 and accept the cost.
  - Import: baseline ____ ms, branch ____ ms, ____ %
  - Re-sync: baseline ____ ms, branch ____ ms, ____ %

## §9 — app-dev: `pg_trgm` (spec AC 9) — manual

- [ ] **Before merge: can the app's role create it?** Run `portalops db psql --env app-dev`, then:
  ```sql
  SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';
  BEGIN; CREATE EXTENSION IF NOT EXISTS pg_trgm; ROLLBACK;
  ```
  The extension is listed, and the `CREATE` succeeds with no permission error before rolling back. `pg_trgm` is a trusted extension on RDS, so the database owner can create it. If it fails, merging would break the app-dev deploy's migrate step. Stop and pre-create the extension as the master user first.
- [ ] **After merge (app-dev deploy):** the deploy's migrate step reports `UPGRADE COMPLETE`, and `\dx pg_trgm` lists it on app-dev.
- [ ] **After the first :45 after deploy:** the app-dev API log has `Wide-table search-index sweep finished`, with `built` > 0 if app-dev has text columns, `failed: 0`, and `deferred` draining over the following hours.
- [ ] Open a large view on app-dev and click **Last**. It answers about as fast as page 1.

## §10 — Error & edge cases

- [ ] A view with **no text columns** (project only number or date columns): searching anything returns **0 rows** and no error.
- [ ] `GET …/records?reverse=maybe` returns **400** `CURATED_VIEW_INVALID_QUERY` naming `reverse`. — backend
- [ ] Remove a column from the view's projection (as a writer) while a reader is mid-walk. The reader's next Next either continues or falls back to page 1, never a 500, because the view-scope part of the cache key changed.
- [ ] Toggle the search box while on page 4. Results start from page 1, and the total reflects the search.

## Sign-off

- [ ] Every section above verified, or waived with a reason
- [ ] §8 numbers recorded on PR #820, and the decision noted
- [ ] §9 pre-merge creatability confirmed on app-dev
- [ ] ____ (date + name): confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / view / entity / job ids):
