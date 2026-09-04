# Demo org runbook — Harborview Supply Co.

The presenter's script for the `admin@portalsai.io` production demo org (epic #507). It names the fictional company, the dataset, and the exact prompts to run live so a presenter always knows what "working" looks like. The dataset is authored in #508, seeded by #509, extended by the custom toolpack in #510, and provisioned per #511.

> **This is a durable reference** (unsuffixed) — it is maintained as the demo evolves, not swept like a phase doc.

## The company

**Harborview Supply Co.** is a fictional mid-market industrial & outdoor-equipment distributor operating across North America. It sells a priced catalog (power tools, safety, fasteners, outdoor, electrical, material handling, storage) to B2B accounts in four segments (enterprise, mid-market, SMB, reseller), ships from ~15 distribution centers, and tracks the whole operation in Portals. Everything is invented but internally consistent: customer ids join orders, shipments, transactions and follow-ups; sites join shipments; products join orders, transactions and inventory.

All dates are anchored to **2026-08-31** with **30 months** of history, so the time series always ends "now" relative to the demo.

## Preconditions

1. **Org & login.** On prod, sign in as `admin@portalsai.io` (Google) — the demo org is its default org on the free, unlimited **Demo** tier (#511). On app-dev/local, the seeded rehearsal org.
2. **Station.** Use the demo station — it carries all eight built-in toolpacks plus the custom webhook toolpack (#510).
3. **Reset first.** Run `portalai demo reset --env <env> --org <orgId>` (app-dev/local) or a `portalai demo seed` re-run (prod — reset is guard-blocked there) so the org is at the checked-in state before you begin (#509).
4. **Connectors.** Four populated instances: **Sandbox**, **File Upload** (CSV + XLSX), **Google Sheets**, **REST API**. (Microsoft 365 Excel is intentionally excluded — Google Sheets covers the identical file-based OAuth workflow.)

## The dataset

Authored deterministically by `packages/admin-cli/fixtures/demo/generate.ts` (`npm run --workspace @portalai/admin-cli fixtures:demo`) from the shared module `packages/admin-cli/src/fixtures/demo-data.ts`.

| Entity | File | Rows | Join keys |
|---|---|---|---|
| customers | `customers.csv` | 800 | `customer_id` (PK); ~12 near-duplicate names for identity resolution |
| products | `products.csv` | 120 | `product_id` (PK) |
| orders | `orders.xlsx` (one sheet per year) | 8,000 | `customer_id` → customers, `product_id` → products |
| sites | `sites.csv` | 15 | `site_id` (PK) |
| shipments | `shipments.csv` | 2,500 | `origin_site_id`/`dest_site_id` → sites, `customer_id` → customers |
| notes (**writable**) | `notes.csv` | 40 | `customer_id` → customers |
| **transactions** (**large-volume**) | `transactions.sample.csv` (sample) | **~1,000,000 seeded** / 5,000 sample | `customer_id`, `product_id`, `site_id` |
| financials | `financials.xlsx` (Cash Flows / Loan Schedule / Portfolio) | 30 / 60 / 10 | standalone |
| inventory (REST) | `apps/site/public/demo/inventory.json` | 120 | `product_id` → products |
| customers+orders | `customers_orders.xlsx` (Customers / Orders) | 800 / 2,000 | Google Sheet hand-upload source (#511) |

**Invariants:** every `orders`/`transactions` `customer_id` and `product_id` resolves; every `shipments`/`transactions` `site_id` resolves; loan schedule closes at ~0; portfolio weights sum to 1. Enforced by `packages/admin-cli/src/__tests__/demo-dataset.test.ts`.

The `transactions` table is the **large-volume story**: ~1M rows synthesized at seed time (#509) from the same generator, streamed through the batch-upsert primitives. The committed `transactions.sample.csv` is a 5K slice for parsing/inspection; the full volume is seeded, not committed.

### Data dictionary (entity → column → system column definition)

The field-mapping source of truth for #509. Every column maps to an existing `SYSTEM_COLUMN_DEFINITIONS` key (`apps/api/src/services/seed.service.ts`) — no new system column is introduced.

- **customers:** `customer_id`→`string_id`, `name`→`name`, `segment`→`enum`, `region`→`enum`, `signup_date`→`date`, `street_address`→`address`, `latitude`→`latitude`, `longitude`→`longitude`
- **products:** `product_id`→`string_id`, `name`→`name`, `category`→`enum`, `unit_price`→`currency`, `unit_cost`→`currency`
- **orders:** `order_id`→`string_id`, `customer_id`→`reference`(customers), `product_id`→`reference`(products), `order_date`→`date`, `quantity`→`quantity`, `amount`→`currency`
- **sites:** `site_id`→`string_id`, `name`→`name`, `type`→`enum`, `street_address`→`address`, `latitude`→`latitude`, `longitude`→`longitude`
- **shipments:** `shipment_id`→`string_id`, `origin_site_id`→`reference`(sites), `dest_site_id`→`reference`(sites), `customer_id`→`reference`(customers), `ship_date`→`date`, `units`→`quantity`, `weight_kg`→`decimal`
- **notes:** `note_id`→`string_id`, `customer_id`→`reference`(customers), `note`→`text`, `follow_up_date`→`datetime`, `status`→`status`, `tag`→`tag`
- **transactions:** `transaction_id`→`string_id`, `customer_id`→`reference`(customers), `product_id`→`reference`(products), `site_id`→`reference`(sites), `occurred_at`→`datetime`, `quantity`→`quantity`, `amount`→`currency`, `channel`→`enum`
- **financials — Cash Flows:** `month`→`date`, `inflow`/`outflow`/`net`→`currency`
- **financials — Loan Schedule:** `period`→`integer`, `payment`/`principal`/`interest`/`balance`→`currency`
- **financials — Portfolio:** `ticker`→`code`, `weight`→`percentage`, `price`→`currency`, `expected_return`→`percentage`
- **inventory:** `product_id`→`string_id`, `sku`→`code`, `on_hand`→`quantity`, `warehouse`→`enum`, `updated_at`→`datetime`

## The presenter script

Run these in order — each builds on the last. Every prompt names the **toolpack** it exercises, the **result kind** to expect, and a one-line **"what to say."** Wording is a guide; the agent is a tool-caller, so phrasing can vary.

1. **Large-volume SQL** — *"What was total revenue by month for the last 12 months?"*
   Toolpack **data_query** (`sql_query`) → a table. Then: *"Show me the full transaction list."* → paginated list stays snappy.
   *Say:* "That just aggregated about a million transactions, and the list pages instantly — this is production-scale data."

2. **Top customers** — *"Who are our top 10 customers by revenue?"*
   **data_query** (`sql_query`, joins transactions→customers) → table.
   *Say:* "Joins across entities in plain language."
   *(Identity variant: "Do we have any duplicate customers?" → `resolve_identity` surfaces the near-duplicate names.)*

3. **Trend chart** — *"Chart monthly revenue over the full history."*
   **visualize** (`visualize_d3`) → an interactive D3 line/bar chart.
   *Say:* "Any query becomes a chart."

4. **Map** — *"Map our distribution centers and customers."*
   **gis** (`visualize_map`) → a map with clustered points across North America.
   *Say:* "Geospatial is built in — hundreds of points, clustered."

5. **Geocode** — *"Where is <a customer name> located?"*
   **gis** (`geocode`) → resolved lat/lng from the customer's address.
   *Say:* "It geocodes the stored address on demand."

6. **Statistics** — *"Cluster our customers by order volume and segment."*
   **statistics** (`cluster`) → k-means clusters.
   *Say:* "Real statistics, not just charts."

7. **Forecast** — *"Forecast next quarter's revenue."*
   **regression** (`forecast`, Holt-Winters) → a forecast series with a confidence band.
   *Say:* "It projects the trend forward."

8. **Financial** — *"What's the monthly payment and total interest on our loan?"* / *"What's the IRR of our portfolio?"*
   **financial** (`amortize` / `irr`) → a figure / schedule.
   *Say:* "Full financial toolkit — amortization, NPV, IRR."

9. **Create a record** — *"Log a follow-up note for <a customer>: renewal call next week."*
   **entity_management** (`entity_record_create`) → a created `notes` row.
   *Say:* "It doesn't just read — it writes back, with permissions."

10. **Web search** — *"What are current industrial supply market trends?"*
    **web_search** → a cited, web-backed answer.
    *Say:* "It can reach outside your data when the question needs it."

11. **Custom toolpack** — the #510 webhook tool: *"<the custom tool's documented prompt>."*
    Custom webhook toolpack → its documented result.
    *Say:* "And you can plug in your own tools — this one is a custom webhook we host."

All eight built-in toolpacks (`data_query`, `visualize`, `gis`, `statistics`, `regression`, `financial`, `web_search`, `entity_management`) plus the custom toolpack are each exercised at least once.

## Notes

- **Google Sheets / OneDrive.** The `customers_orders.xlsx` file is committed; the one-time upload to admin@'s Drive (→ Google Sheet) is a #511 provisioning step, not part of `demo seed`. Microsoft 365 Excel is out of scope for the demo.
- **Reset semantics.** `demo reset` returns the org to zero portals and the seeded record set; it is guard-blocked in prod, where a `demo seed` re-run is the refresh path (#509).
