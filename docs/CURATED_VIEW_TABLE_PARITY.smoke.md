# curated-view-table-parity — Smoke Suite

Manual smoke test for [#678](https://github.com/EnterpriseBT/portal-ai/issues/678). The curated view page now renders the entity records table:
- `normalizedKey` headers with a `label · type` caption;
- type-aware cells;
- sorting on sortable types only;
- the column picker and the advanced filter builder over the caller's readable projected columns, remembered per view.

The records endpoint takes a view-scoped `filters` param that can only narrow.

**Branch under test:** `fix/678-curated-view-column-labels` (PR [#679](https://github.com/EnterpriseBT/portal-ai/pull/679)).

Run **§Preflight** once. After that the sections are independent.

## Preflight

### Environment

- [ ] `git checkout fix/678-curated-view-column-labels && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. The curated-view contract changed, so the API and web need the rebuilt core dist. No migration.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Signed in as the org owner of the `e2e-fixture` org.

### Fixtures

The seeded `Contacts` entity has only two string columns. These steps need a number column, a json column, and two columns sharing one column definition, so build a small entity first:

- [ ] Save this as `parity-people.csv`:
  ```csv
  full_name,email,backup_email,age,tags
  Alice Adams,alice@example.com,alice.b@example.com,34,"[""admin"",""ops""]"
  Bob Brown,bob@example.com,bob.b@example.com,17,"[""ops""]"
  Cara Cole,cara@example.com,,52,"[]"
  Dan Diaz,dan@example.com,dan.b@example.com,29,"[""sales""]"
  Eve Evans,eve@example.com,eve.b@example.com,41,"[""admin""]"
  ```
- [ ] Connectors → File Upload → upload it as entity **`Parity people`**. In the mapping step:
  - `full_name` → the `Name` column definition (string);
  - `email` **and** `backup_email` → the **same** `Email` column definition (string);
  - `age` → a number column definition (e.g. `Age`);
  - `tags` → a **json** column definition (e.g. `Tags`; create it if it's missing).

  Commit, and wait for the import to finish. The entity's records table shows 5 rows. — manual
- [ ] Views → New view **`Parity view`** over `Parity people`: all five columns projected, row filter `age >= 18`. Its page says **Row filter: Filtered**.
- [ ] Views → New view **`Parity narrow`** over `Parity people`: only `full_name` + `email` projected, no row filter. Its page says **Row filter: All rows**.
- [ ] Note both view ids from the URL (`/views/<id>`). They're needed for the §6 curl probes.

### Reset between runs

- [ ] In devtools → Application → Local Storage, delete the keys `pagination:curated-view:<id>` and `column-config:curated-view:<id>` for both views. Data is read-only; nothing else to reset.

## §1 — Headers and cells

- [ ] Open `Parity view`. The headers are `full_name`, `email`, `backup_email`, `age`, `tags`, in that order (the entity's field-mapping order). Each has a caption: `Name · string`, `Email · string`, `Email · string`, `Age · number`, `Tags · json`.
- [ ] `email` and `backup_email` are two separate columns, both captioned `Email · string`. A shared definition doesn't merge or collapse them.
- [ ] The table shows **4 rows** (Alice, Cara, Dan, Eve). Bob (17) is excluded by the view's own filter, and the total reads 4.
- [ ] `age` cells render as numbers. `tags` cells render as code/JSON (e.g. `["admin","ops"]`), not `[object Object]`. Cara's empty `backup_email` renders as an empty cell, not `null` text.
- [ ] There's **no** `Valid` column and **no** Cached/Live chip.
- [ ] Open the `Parity people` entity's own records page. It **still** has the `Valid` column and the Cached/Live chip (no regression). Its headers have the same captions.

## §2 — Sort

- [ ] On `Parity view`, click the `age` header. Rows order 29, 34, 41, 52 (Dan, Alice, Eve, Cara). Click again: they reverse.
- [ ] Click `full_name`. Rows order alphabetically (Alice, Cara, Dan, Eve).
- [ ] The `tags` (json) header has **no** sort affordance. Clicking it doesn't change the order or send a request with `sortBy=tags`.
- [ ] Reload. The last sort (`full_name` asc) is remembered.

## §3 — Advanced filters

- [ ] On `Parity view`, the toolbar shows an **Advanced Filters** button. Open it. The field picker lists exactly `full_name`, `email`, `backup_email`, `age`, `tags`, and nothing from outside the view.
- [ ] Add `age` `>` `30` and apply. The table shows **3 rows** (Alice 34, Eve 41, Cara 52), the total reads 3, the button badge reads 1, and paging resets to page 1.
- [ ] Change the filter to an OR group, `age < 20` OR `age > 30`. The table shows Alice, Eve and Cara, and **not Bob**: the ad-hoc filter can't bring back a row the view's own filter excludes.
- [ ] Add a search of `ali` on top of the filter. Only Alice remains. Clear the search and the filter, and the 4 rows return.
- [ ] Reload with a filter applied (`email` contains `dan`). The filter is still applied after reload (1 row, Dan) and the badge reads 1.
- [ ] Open `Parity narrow`. Advanced Filters lists only `full_name` and `email`. The `Parity view` filter is **not** carried over (filters are per view).

## §4 — Column picker

- [ ] On `Parity view`, open **Configure columns**. It lists exactly `full_name`, `email`, `backup_email`, `age`, `tags`, with no `Valid` entry and no id/source columns.
- [ ] Hide `backup_email` and move `age` to first. The table updates. Reload, and the order and hidden state are kept.
- [ ] Open `Parity narrow`. Its columns are unaffected (`full_name`, `email`, default order): column config is per view.
- [ ] Open the `Parity people` entity records page. Its column config is also unaffected (it keeps its own key).

## §5 — Stale state recovery

- [ ] On `Parity view`, apply the filter `age > 30` AND `full_name` contains `a`. Then edit the view (Edit → remove `age` from the projection → Save) and reload the view page.
  - The page loads without an error.
  - The `age` condition is dropped on its own; the `full_name` condition is still applied.
  - No toast appears.
  - The request URL's `filters` decodes without `age`.
- [ ] Put `age` back into the projection.

## §6 — Server checks (filter scope) — backend

Grab the bearer token from any `/api/curated-views/...` request in devtools → Network. `B64` is the base64 of the JSON shown.

- [ ] `{"combinator":"and","conditions":[{"field":"age","operator":"gt","value":30}]}` against **`Parity narrow`** (`GET /api/curated-views/<narrow-id>/records?filters=<B64>`) gives **400** `CURATED_VIEW_INVALID_FILTER`, with a message naming `Unknown field "age"`. `age` is on the entity but outside this view's projection.
- [ ] The same filter against **`Parity view`** gives 200 with `total: 3`.
- [ ] `?sortBy=tags` against `Parity view` gives **400** `CURATED_VIEW_INVALID_SORT`.
- [ ] `?filters=not-base64!!` gives 400 `CURATED_VIEW_INVALID_FILTER`.
- [ ] A 200 response's `columns[]` entries carry `normalizedKey`, `label`, `type` (`ResolvedColumn`). Each row is keyed by normalizedKey plus `_record_id` / `_source_id`, with no `c_*` keys.

## §7 — Metadata

- [ ] The `Parity view` metadata list still reads **Row filter: Filtered**, and `Parity narrow` reads **All rows**. The raw filter expression isn't shown.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/view/entity ids):
