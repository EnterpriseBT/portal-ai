# Demo dataset + presenter script — Condensed design (#508)

**Issue:** [EnterpriseBT/portal-ai#508](https://github.com/EnterpriseBT/portal-ai/issues/508) · Feature (epic child of #507) · **small / condensed** (discovery + spec + plan + smoke in one doc). Branch `feat/demo-dataset`, base `epic/demo-org`.

**Why.** The demo-org seeder (#509) and presenter runbook need a fictional-company dataset worth showing, and the repo has none — the only sample assets are two upload *templates* (`apps/web/src/workflows/FileUploadConnector/SampleFiles.component.tsx:19`). This ticket authors that dataset — one fictional company across CSV/XLSX/JSON files with real cross-entity join keys — plus `docs/DEMO_ORG.runbook.md`. **Content + authoring/validation tooling only; no application code.** It feeds #509 (the seeder parses these files) and is independent of #510/#511.

## Current shape

| Piece | Location | Note |
|---|---|---|
| System column definitions (30 keys) | `apps/api/src/services/seed.service.ts:51-349` | The data-dictionary target — every fixture column must map onto an **existing** key. A **new** key needs a backfill migration (header note `:34-49`), so the dataset uses only these 30. |
| Geospatial keys | `seed.service.ts:155` (`address`), `:328` (`latitude`), `:339` (`longitude`), `:316` (`geometry`) | `latitude`/`longitude` carry `geoRole` for the map layer; `address` is the geocode input; `geometry` is where the bulk geocoder writes points. |
| Connector definitions | `seed.service.ts:438` (sandbox), `:458` (file-upload), `:481` (google-sheets), `:504` (microsoft-excel), `:524` (rest-api) | All five exist globally, but the demo populates **four** instances: file-upload takes CSV/XLSX; Google Sheets is OAuth (uploaded by hand in #511); REST-api syncs an HTTP JSON URL. `microsoft-excel` is **intentionally not populated** — Google Sheets covers the identical file-based OAuth workflow (epic decision, 2026-09-04). |
| Eight built-in toolpacks | `packages/core/src/registries/builtin-toolpacks.ts:32-41` (slugs), `:1392` (order) | `data_query`, `visualize`, `gis`, `statistics`, `regression`, `financial`, `web_search`, `entity_management` — each runbook prompt names one. |
| Writable-entity tools | `builtin-toolpacks.ts:836` (`entity_record_create`), `:874` (update), `:895` (delete) | Operate on records keyed by mapped field names — the `notes` entity gives them a target. |
| XLSX reader (multi-sheet) | `apps/api/src/services/workbook-adapters/xlsx.adapter.ts:137` | ExcelJS streaming, one region per worksheet — multi-sheet is first-class. **Merged cells are dropped** (`:121`); **password-protected throws** (`:78`). |
| Region/header interpret | `packages/spreadsheet-parsing/src/interpret/stages/detect-headers.ts:22`, `detect-regions.ts:73` | Clean parse = one dense region per sheet, one unambiguous non-numeric header row at the region edge, no title banners inside the data rectangle, no merged cells. |
| Existing fixture convention | `apps/web/public/samples/supported_layouts.{csv,xlsx}` | Committed data files live under an app's `public/`; **no `packages/admin-cli/fixtures/` exists yet.** |
| Site public assets | `apps/site/astro.config.mjs:17`; `apps/site/scripts/verify-pages.mjs:43` | `public/` copies verbatim to `dist/` root; verify-pages + sitemap only touch `*.html`, so a `/demo/*.json` asset is served and ignored by both. |
| REST ingest contract | `apps/api/src/adapters/rest-api/rest-api.adapter.ts:87,114`; `inference.util.ts:56` | Top-level array + `recordsPath:""`; each element a flat object; scalar-typed fields (avoid mixed types); a stable `id` via `idField`; `pagination:none`, `auth:none`. |

## Decision — the fictional company & entity model

**Company: "Harborview Supply Co."** — a fictional mid-market industrial & outdoor-equipment distributor operating across North America (name settleable by you; the runbook holds the one-paragraph story so every file and prompt tells it). Chosen because a distributor naturally has all the shapes each toolpack needs: regional B2B customers (geocode + map + segment stats), a priced catalog (margin SQL), 24+ months of orders (time series → D3, forecast), physical sites + shipments (map lines, spatial SQL), finances (NPV/IRR/amortization), and follow-ups (writable entity).

Entities and cross-entity **join keys** (the `resolve_identity` / Entity-Group story):

| Entity | File | Rows (target) | Join keys |
|---|---|---|---|
| `customers` | `customers.csv` | ~800 | `customer_id` (PK); a deliberate handful of **near-duplicate names** for identity resolution |
| `products` | `products.csv` | ~120 | `product_id` (PK) |
| `orders` | `orders.xlsx` (multi-sheet, one per year → gives the layout wizard work) | ~8,000 | `customer_id` → customers, `product_id` → products |
| `sites` | `sites.csv` | ~15 | `site_id` (PK) |
| `shipments` | `shipments.csv` | ~2,500 | `origin_site_id`/`dest_site_id` → sites, `customer_id` → customers |
| `financials` | `financials.xlsx` (3 sheets: monthly cash flows, a loan amortization schedule, a small portfolio) | ~36 + ~60 + ~10 | standalone |
| `inventory` (REST) | `apps/site/public/demo/inventory.json` | ~120 | `product_id` → products |
| `notes` (**writable**) | `notes.csv` | ~40 | `customer_id` → customers |
| `transactions` (**large-volume**) | `transactions.sample.csv` (committed sample only) — **~1,000,000 rows synthesized at seed time** | ~5,000 sample / **~1M seeded** | `customer_id` → customers, `product_id` → products, `site_id` → sites |
| customers+orders combined (hand-uploaded) | `customers_orders.xlsx` | — | same `customer_id`; the file a human uploads to admin@'s Drive (→ Google Sheet) in #511 |

**Invariants (stated in the runbook, asserted by the integrity check below):** every `orders.customer_id` ∈ customers; every `orders.product_id` ∈ products; every `shipments` site/customer id resolves; every `transactions` customer/product/site id resolves (asserted on the committed sample; the synth function preserves it at scale). Row counts as above.

**Base dataset vs. large table.** The base entities (customers…notes) total tens of thousands of rows and seed in **well under a minute**. `transactions` is the deliberate **large-volume story** — ~1M rows synthesized deterministically at seed time (not committed) and streamed through the batch-upsert primitives — so the demo shows fast aggregate SQL, keyset pagination, and map/chart rendering over a genuinely large table. It seeds in **minutes, not seconds**, chunked to stay within the 512 MB app-dev ECS task (never held whole in memory). Local seeds a smaller scale (`--rows` override) since the local container is unsuited to long jobs.

## Decision — fixture format & location

**A committed, seeded generator emits the files; the generated outputs are committed too.** Options were (A) hand-author every row — infeasible at thousands of rows with join integrity; (B) a deterministic generator (fixed seed) whose outputs are committed. Chosen **B**: `packages/admin-cli/fixtures/demo/generate.mjs` (ExcelJS is already a dependency; a fixed **seeded PRNG**, no `Math.random`) writes the CSV/XLSX/JSON. This guarantees reproducibility, join-key integrity, and clean single-region-per-sheet XLSX layouts. The generator is **authoring tooling, not application code** (mirrors `apps/site/scripts/generate-tokens.mjs`).

**The generator is also a shared synthesis module, not just a one-shot script.** It exports deterministic, seed-parameterized row-producing functions — in particular a **streaming/generator `synthesizeTransactions(rowCount, seed)`** that yields rows lazily (never materializing 1M rows in an array). The fixture script calls it with a small count to emit the committed `transactions.sample.csv`; **#509 imports the same function** to stream ~1M rows straight into the batch-upsert primitives at seed time. One source of truth for the shape means the committed sample and the seeded volume can never diverge, and the integrity test that runs against the sample validates the logic that runs at scale.

**Location:** the seeder-parsed files (`customers.csv`, `products.csv`, `orders.xlsx`, `sites.csv`, `shipments.csv`, `financials.xlsx`, `notes.csv`, `transactions.sample.csv`, `customers_orders.xlsx`) and the shared generator live under **`packages/admin-cli/fixtures/demo/`** — next to the `portalai demo seed` command (#509) that reads them. The **REST source is the single exception**: it must be HTTP-served, so `inventory.json` lives at **`apps/site/public/demo/inventory.json`** (served at `https://www.portalsai.io/demo/inventory.json`). #509 configures the REST instance's base URL per env; #508 only authors and places the JSON.

## Decision — data dictionary (entity → column → system key)

The runbook carries the full table; the mapping #509 uses as its field-mapping source of truth. Representative rows:

- **customers:** `customer_id`→`string_id`, `name`→`name`, `segment`→`enum`, `region`→`enum`, `signup_date`→`date`, `street_address`→`address`, `latitude`→`latitude`, `longitude`→`longitude`
- **products:** `product_id`→`string_id`, `name`→`name`, `category`→`enum`, `unit_price`→`currency`, `unit_cost`→`currency`
- **orders:** `order_id`→`string_id`, `customer_id`→`reference`(customers), `product_id`→`reference`(products), `order_date`→`date`, `quantity`→`quantity`, `amount`→`currency`
- **sites:** `site_id`→`string_id`, `name`→`name`, `type`→`enum`, `street_address`→`address`, `latitude`→`latitude`, `longitude`→`longitude`
- **shipments:** `shipment_id`→`string_id`, `origin_site_id`→`reference`(sites), `dest_site_id`→`reference`(sites), `customer_id`→`reference`(customers), `ship_date`→`date`, `units`→`quantity`, `weight_kg`→`decimal`
- **notes:** `note_id`→`string_id`, `customer_id`→`reference`(customers), `note`→`text`, `follow_up_date`→`datetime`, `status`→`status`, `tag`→`tag`
- **financials** (per sheet): cash-flows `month`→`date`, `inflow`/`outflow`/`net`→`currency`; loan `period`→`integer`, `payment`/`principal`/`interest`/`balance`→`currency`; portfolio `ticker`→`code`, `weight`→`percentage`, `price`→`currency`
- **inventory (REST):** `product_id`→`string_id`, `sku`→`code`, `on_hand`→`quantity`, `warehouse`→`enum`, `updated_at`→`datetime`
- **transactions** (large-volume): `transaction_id`→`string_id`, `customer_id`→`reference`(customers), `product_id`→`reference`(products), `site_id`→`reference`(sites), `occurred_at`→`datetime`, `quantity`→`quantity`, `amount`→`currency`, `channel`→`enum`

Every column uses one of the 30 existing keys — **no new system column definition is introduced**, so no backfill migration is needed.

## Decision — runbook prompt sequence

`docs/DEMO_ORG.runbook.md` (durable, unsuffixed): company paragraph → presenter preconditions (which org/station, `demo reset` first) → data dictionary → **the prompts in a building order**, each naming its toolpack, expected result kind, and a one-line "what working looks like":

1. **Large-volume SQL** — aggregate revenue by month/channel across the **~1M `transactions`** table (`data_query` / `sql_query`) → table, returned fast. *Say:* "that just aggregated a million rows." Follow by scrolling the full transaction list to show **keyset pagination** stays snappy deep in.
2. SQL table — top customers by revenue, joined through transactions (`data_query` / `sql_query`) → table
3. D3 chart — monthly revenue trend over the full transaction history (`visualize` / `visualize_d3`) → chart
4. Map — sites + customers, many points (`gis` / `visualize_map`) → clustered map
5. Geocode — resolve a customer's address (`gis` / `geocode`) → lat/lng
6. Statistics — cluster customers by segment/volume (`statistics` / `cluster`) → clusters
7. Forecast — next-quarter revenue (`regression` / `forecast`) → forecast series
8. Financial — loan payoff / portfolio IRR (`financial` / `amortize`|`irr`) → figure
9. Create a record — log a follow-up note (`entity_management` / `entity_record_create`) → created record
10. Web search — a market question (`web_search`) → cited answer
11. Custom toolpack — the #510 webhook tool → its documented answer

Identity-resolution prompt (`resolve_identity`, near-duplicate customers) folds into prompt 2 or a standalone step. The runbook states the seeded `transactions` count so the presenter can name the scale.

## Plan — 5 slices

1. **Generator + core entities.** `packages/admin-cli/fixtures/demo/generate.mjs` (seeded PRNG) exporting reusable per-entity synth functions + committed outputs: `customers.csv`, `products.csv`, `orders.xlsx` (multi-sheet), `sites.csv`, `shipments.csv`, `notes.csv`. **Tests:** `packages/admin-cli/fixtures/demo/__tests__/dataset-integrity.test.ts` — loads the committed files, asserts row counts + every join key resolves (no dangling `customer_id`/`product_id`/site id) + column headers match the dictionary keys. Run via the admin-cli package `test` npm script.
2. **Large-volume `transactions` synth + sample.** A **streaming/generator `synthesizeTransactions(rowCount, seed)`** in the same module (yields rows lazily — never a 1M-row array), plus the committed `transactions.sample.csv` (~5K) it emits at a small count. **Tests:** integrity test asserts every sample transaction's `customer_id`/`product_id`/`site_id` resolves, and a determinism assertion (same seed → same first-N rows) so #509's scaled synth is trustworthy. #509 imports this function to stream ~1M rows through the batch-upsert primitives; #508 does not seed.
3. **Financials + REST source + combined workbook.** `financials.xlsx` (3 sheets), `apps/site/public/demo/inventory.json` (top-level array, scalar fields, stable `product_id`), `customers_orders.xlsx` (the Google Sheet hand-upload source). Extend the integrity test to cover the REST JSON shape (array of flat objects, no mixed-type columns) and financials sheet presence.
4. **`docs/DEMO_ORG.runbook.md`.** Company paragraph, preconditions, full data dictionary, the prompt script (with the large-volume opener + the seeded `transactions` count as a talking point), row-count + join-coverage statement, and the note that the Google Sheet upload is a #511 step.
5. **Verify site asset.** Confirm `npm run --workspace @portalai/site build` emits `dist/demo/inventory.json` and `verify-pages` stays green (JSON ignored). No sitemap entry expected.

## Smoke (manual, against your dev stack)

1. Run `npm run --workspace @portalai/admin-cli fixtures:demo` → all files regenerate; CSV/JSON are **byte-identical** to the committed outputs (`git status` clean for them). XLSX regenerates to **content-equivalent** files (ExcelJS zips embed timestamps, so bytes may differ — the integrity test re-reads and compares rows, which is the real guarantee).
2. In local web, File Upload wizard → upload `customers.csv`, `orders.xlsx`, `sites.csv`, `shipments.csv`, `products.csv`, `notes.csv`, `financials.xlsx`: each parses, regions auto-detect, columns auto-bind at high confidence with **no manual column fixes and no warnings**. `orders.xlsx`/`financials.xlsx` show one region per sheet.
3. `npm run --workspace @portalai/site build` then serve `dist/` → `GET /demo/inventory.json` returns the array; `npm run --workspace @portalai/site verify-pages`-equivalent stays green.
4. Spot-check join integrity: open `customers.csv` + `orders.xlsx`, confirm a sampled `orders.customer_id` exists in customers and the near-duplicate names are present.
5. Large-volume synth: `synthesizeTransactions` yields correct rows and is deterministic (same seed → identical output); the committed `transactions.sample.csv` matches a small-count run. **Actual ~1M seed timing/behavior is verified in #509 on app-dev** (not local — the local container is unsuited to long jobs), so this ticket's smoke stops at the sample + determinism.
6. Read `docs/DEMO_ORG.runbook.md` end-to-end: every built-in toolpack (8) + the custom toolpack is named by at least one prompt; the large-volume opener is present and names the transaction count; each prompt states its expected result kind.

## Out of scope

- The seeder that loads these files (#509), the hosted toolpack prompt 10 calls (#510), and the org/tier/OAuth-upload operations (#511) — the Google Sheet upload is a #511 runbook step; #508 only commits the file to upload.
- The **Microsoft 365 Excel** connector — intentionally excluded from the demo (epic decision, 2026-09-04): Google Sheets exercises the identical file-based OAuth sync workflow, so a second OAuth instance adds setup cost with no new story. The connector definition still ships; the demo just doesn't populate an instance.
- Real or anonymized customer data — fictional by epic decision.
- Actors & roles / standard-vs-bespoke PRD dimensions — `N/A`: content consumed by the maintainer's tooling only (waived in the issue).
- The REST connector's per-env base-URL config and the custom-toolpack URL — owned by #509/#510.
