# Demo org runbook — Harborview Supply Co.

The presenter's script for a Portals demo (epic #507). It names the fictional company, the dataset, and the exact prompts to run live so a presenter always knows what "working" looks like. The dataset is authored in #508, seeded by #509, extended by the custom toolpack in #510, and provisioned per #511. **Each demo gets its own new org** (#1035): `portalai demo create` provisions it from a clean slate, the demo can change it freely, and afterwards it is kept as a reference or removed with `portalai demo delete`.

> **This is a durable reference** (unsuffixed) — it is maintained as the demo evolves, not swept like a phase doc.

## The company

**Harborview Supply Co.** is a fictional mid-market industrial & outdoor-equipment distributor operating across North America. It sells a priced catalog (power tools, safety, fasteners, outdoor, electrical, material handling, storage) to B2B accounts in four segments (enterprise, mid-market, SMB, reseller), ships from ~15 distribution centers, and tracks the whole operation in Portals. Everything is invented but internally consistent: customer ids join orders, shipments, transactions and follow-ups; sites join shipments; products join orders, transactions and inventory.

All dates are anchored to **2026-08-31** with **30 months** of history, so the time series always ends "now" relative to the demo.

## Preconditions

1. **A fresh demo org.** Create one per client (below). Never re-use a previous demo's org: people change things during a demo, and nothing resets an org back to the baseline.
2. **Login.** Sign in as the org's owner (the `--owner-email` you created it with) and switch to the demo org in the org switcher (or `portalai member switch <orgId> <email> --env <env> --yes`). `demo create` deliberately doesn't make it the owner's current org.
3. **Station.** Use the station named **Demo**. It carries the demo connectors, a curated view per entity (the station's queryable data, #674), all the built-in toolpacks and the custom webhook toolpack (#510). The org's Administrate and Playground stations are the ones every new org gets, and the demo doesn't use them.
4. **Connectors.** Four populated instances: **Sandbox**, **File Upload** (CSV + XLSX), **Google Sheets**, **REST API**. (Microsoft 365 Excel is intentionally excluded — Google Sheets covers the identical file-based OAuth workflow.)

## Provisioning (operator, #511, #1035)

Every step is a CLI command or a named console action; guards are server-enforced (`docs/CLI_OPERATIONS_CHARTER.md`).

### Once per environment

- **Toolpack config.** `demo create` reads the shared #510 endpoint and its signing secret from the env's config, and refuses with exit 3 when either is missing. Set them once:
  - `portalops vars set DEMO_TOOLPACK_URL <url> --env <env> --yes [--confirm-prod]`. The URL is the `portalai-demo-toolpack` CloudFormation stack output `demo-toolpack-url`.
  - `portalops vars set DEMO_TOOLPACK_SIGNING_SECRETS <whsec_…> --env <env> --yes [--confirm-prod]`. This must be the env's entry in the demo Lambda's allow-list.

  Locally, export both in the shell or put them in `apps/api/.env`. Without them a local demo gets built-in packs only.
- **The `demo` tier (optional).** Free, unlimited, all toolpacks, `cta contact`, no Stripe price. It is a **custom tier outside the catalog** (`tier apply` never touches it) and isn't on `GET /api/public/site-config`.
  - **Local:** created automatically by `portalops local provision --env local --yes` (the `demo-tier` step).
  - **App-dev / prod:** `portalops tier create --env <env> --slug demo --display-name "Demo" --description "Internal demo organization — unlimited usage." --yes [--confirm-prod]`.
  - **Verify:** it stays unmanaged — `portalops tier apply --env <env> --dry-run` lists `demo` under `unmanaged`.

  Assigning a tier ignores its visibility, so `--tier demo` works for any org once the tier exists. Without it, demos run on `enterprise`, which includes every pack but has finite allocations.

### Per demo

1. **Owner.** The owner must be an existing user: users originate in Auth0, so they sign in once first (`admin@portalsai.io` on prod).
2. **Create.**
   ```
   portalai demo create --name "<Client> demo" --owner-email <email> --env <env> --yes [--confirm-prod] [--tier demo] [--rows <n>]
   ```
   This provisions a new org (its Administrate and Playground stations exactly as any new org has them), marks it as a demo, puts it on the tier (`enterprise` by default), adds the **Demo** station, and loads the dataset, connectors and packs onto it. The output's `organizationId` is the org.
   - **Rows.** `--rows` sizes the synthesized `transactions` table and defaults to **10,000**. For the "about a million transactions" beat, pass `--rows 1000000`. That import streams over your DB connection: over a `portalops db tunnel` from a laptop it measured roughly **110 minutes**. Run it from a low-latency vantage inside the env, or keep the machine awake and the tunnel open, and never from the devcontainer, which suspends when idle.
   - **Failure.** A failed load deletes the org it created and exits non-zero, so just re-run. If the process is killed mid-load, no cleanup runs: find the leftover with `portalai org list --search "<Client> demo" --env <env>` and remove it with `demo delete`.
3. **Google Sheets.** In the app, as the owner, connect **Google Sheets** on the Demo station. The owner's Drive must hold #508's `customers_orders.xlsx`, uploaded once and converted to a Google Sheet. Connect against the env's own OAuth callback.
4. **Verify.** Settings → Subscription shows the tier, the Demo station lists the four connector instances as `active`, and the presenter script's first prompt answers. Rehearse the script.
5. **After the demo.** Keep the org as a reference, or remove it:
   ```
   portalai demo delete <orgId> --env <env> --yes [--confirm-prod]
   ```
   It refuses any org `demo create` didn't make (exit 9). It runs the full org deletion: the dataset and everything the demo added are removed, and the org and its memberships are tombstoned.

## The dataset

Authored deterministically by `apps/api/src/scripts/generate-demo-fixtures.ts` (`npm run --workspace @portalai/api fixtures:demo`) from the shared module `apps/api/src/demo/demo-data.ts`, written into `apps/api/fixtures/demo/` (#509 relocated all three from `admin-cli` so the seeder can import the generator directly).

| Entity | File | Rows | Join keys |
|---|---|---|---|
| customers | `customers.csv` | 400 | `customer_id` (PK); ~12 near-duplicate names for identity resolution |
| products | `products.csv` | 120 | `product_id` (PK) |
| orders | `orders.xlsx` (one sheet per year) | 2,000 | `customer_id` → customers, `product_id` → products |
| sites | `sites.csv` | 15 | `site_id` (PK) |
| shipments | `shipments.csv` | 800 | `origin_site_id`/`dest_site_id` → sites, `customer_id` → customers |
| notes (**writable**) | `notes.csv` | 40 | `customer_id` → customers |
| **transactions** (**large-volume**) | `transactions.sample.csv` (sample) | **~1,000,000 seeded** / 5,000 sample | `customer_id`, `product_id`, `site_id` |
| financials | `financials.xlsx` (Cash Flows / Loan Schedule / Portfolio) | 30 / 60 / 10 | standalone |
| inventory (REST) | `apps/site/public/demo/inventory.json` | 120 | `product_id` → products |
| customers+orders | `customers_orders.xlsx` (Customers / Orders) | 400 / 2,000 | Google Sheet hand-upload source (#511) |

**Invariants:** every `orders`/`transactions` `customer_id` and `product_id` resolves; every `shipments`/`transactions` `site_id` resolves; loan schedule closes at ~0; portfolio weights sum to 1. Enforced by `apps/api/src/demo/__tests__/demo-dataset.test.ts`.

The `transactions` table is the **large-volume story**: synthesized at seed time (#509) from the same generator, 10,000 rows by default and ~1M with `demo create --rows 1000000` (#1035), streamed through the batch-upsert primitives. The committed `transactions.sample.csv` is a 5K slice for parsing/inspection; the full volume is seeded, not committed.

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
   *Say:* "That just aggregated about a million transactions, and the list pages instantly — this is production-scale data." (Only with `--rows 1000000` at create time; at the default 10,000, say "ten thousand transactions" and skip the production-scale line.)

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

All eight of the data & analysis built-in toolpacks (`data_query`, `visualize`, `gis`, `statistics`, `regression`, `financial`, `web_search`, `entity_management`) plus the custom toolpack are each exercised at least once. Three more built-in packs are out of this walkthrough: `rbac_management` (#629), which performs RBAC admin actions (create policies/roles/groups, assign members, share objects) rather than reading or writing the demo dataset and is covered by the #629 RBAC smoke; `member_management` (#847), which invites and removes members on the org's roster; and `help` (#1050), which answers product questions; ask the Demo station "How do I create a station?" to show it.

## Notes

- **Google Sheets / OneDrive.** The `customers_orders.xlsx` file is committed. Uploading it to the owner's Drive (→ Google Sheet) is a one-time step per owner, and connecting it is a per-demo step in the app; neither is part of `demo create`. Microsoft 365 Excel is out of scope for the demo.
- **No reset.** There is no way to return a used org to the baseline (#1035 removed `demo seed --org` / `demo reset`): a fresh `demo create` is the clean slate.
