# curated-view-table-parity — Adversarial Review

Adversarial probes for [#678](https://github.com/EnterpriseBT/portal-ai/issues/678):
- `GET /api/curated-views/:id/records` takes a view-scoped `filters` (base64 FilterExpression) and a normalizedKey `sortBy`, and returns `ResolvedColumn`s;
- the view page's filter, sort and column settings are remembered per view in localStorage.

The questions: can the new filter/sort inputs reach columns or rows the caller can't read, widen the view, inject SQL, or wedge the page?

**Branch under test:** `fix/678-curated-view-column-labels` (PR [#679](https://github.com/EnterpriseBT/portal-ai/pull/679)).

## Preflight

### Environment
- [ ] `git checkout fix/678-curated-view-column-labels && npm install && npm run build --workspace=packages/core && npm run dev` (web :3000, API :3001). No migration.
- [ ] Playwright MCP is available. `e2e:auth:all` fixtures (owner / admin / member) are present.

### Fixtures
- [ ] The smoke fixture: `Parity people` (5 rows: Alice 34, Bob 17, Cara 52, Dan 29, Eve 41), `Parity view` (full_name/email/age/tags, `age >= 18`), `Parity narrow` (full_name/email). See `CURATED_VIEW_TABLE_PARITY.smoke.md` §Preflight.
- [ ] **Member partial grant.** The member gets `read` on `Parity view` and `read` on the `full_name`, `email` and `tags` field mappings, but **not** on `age`. Grant it through Access as the owner. Fallback: `permission_grants` rows for `curated_view` and `field_mapping`, as in the integration test. The member has no grant on `Parity narrow`.
- [ ] Bearer tokens for owner and member, from `packages/e2e/.auth/<role>.storageState.json` (`@@auth0spajs@@…` → `body.access_token`). `B64(x)` = URL-encoded base64 of the JSON `x`.
- [ ] A curated view id from **another org**, for §5. If none exists, create one in a scratch org.

### Reset between runs
- [ ] Clear `pagination:curated-view:*` and `column-config:curated-view:*` in localStorage. The probes are read-only except §6, which restores what it changes.

## §1 — Boundary & limit inputs
- [ ] `filters=B64({"combinator":"and","conditions":[]})` (empty group) → 200 with the view's own 4 rows, exactly as with no `filters`. It must not be a 400 or 500, and it must not drop the view filter (Bob absent). — backend
- [ ] `filters=` (empty string) → 200, the 4 rows, the same as omitting it, or a clean 400 `CURATED_VIEW_INVALID_FILTER`. Never a 500. — backend
- [ ] `between` with reversed bounds, `{"field":"age","operator":"between","value":[50,20]}` → 200, 0 rows, or a clean 400. Never a 500, and never rows outside the view. — backend
- [ ] `offset=1000` with a filter → 200, `records: []`, with `total` still the filtered count. — backend
- [ ] A filter nested 50 groups deep, or with 500 conditions → a clean 400 or 200. Never a 500, and the API stays responsive. — backend

## §2 — Malformed & injection input
- [ ] `{"field":"full_name","operator":"eq","value":"x' OR '1'='1"}` → 200, 0 rows. `… "value":"x'); DROP TABLE users;--"` → 200, 0 rows, and the table still exists. — backend
- [ ] `{"field":"full_name\" OR 1=1 --","operator":"eq","value":"x"}` (a hostile field name) → 400 `Unknown field`. — backend
- [ ] `{"field":"__proto__","operator":"eq","value":"x"}` and `"field":"constructor"` → a clean **400** `CURATED_VIEW_INVALID_FILTER`, not a 500 (security review noted a stray 500 here). — backend
- [ ] `{"field":"full_name","operator":"contains","value":"%"}` → only rows whose name contains a literal `%` (0 here). A wildcard match of all 4 is a low-severity correctness finding. — backend
- [ ] `{"field":"age","operator":"gt","value":"30 OR 1=1"}` (string into number) → a clean 400, or 0 rows. Never all rows, never a 500. — backend
- [ ] `sortBy=full_name;DROP TABLE x` and `sortBy="full_name"` → 200 with the fallback order (an unprojected key), no SQL error. `sortOrder=sideways` → 400 validation error. — backend
- [ ] In devtools, set `pagination:curated-view:<Parity view id>` to non-JSON (`{oops`) and reload → the page loads with defaults; no crash or blank page.

## §3 — Concurrency & races
- N/A: the endpoint is read-only. No job locks or writes were added. The one client race (columns arriving after mount) is pinned by the slice-4 and smoke-fix tests.

## §4 — Auth & permission boundaries
- [ ] **Member**, `Parity view`: `filters=B64(age > 30)` → **400** `Unknown field: "age"`. The member can't read `age`, so it can't be a value oracle, even though `age` is projected. — backend
- [ ] **Member**, oracle by difference: `filters=B64(age is_empty)` and `B64(age is_not_empty)` → **both 400**. Neither total reveals anything about `age`. — backend
- [ ] **Member**, `sortBy=age` → 200 with the **same order** as `sortBy=nonexistent_column`. An unreadable column must behave exactly like an absent one: no 400, and no order that leaks `age`. — backend
- [ ] **Member**, `search=34` → no row matches on `age` (search is limited to readable columns). — backend
- [ ] **Member**, response → `columns` lists full_name/email/tags only. No row carries an `age` key.
- [ ] **Member** opens `Parity view` in the browser → the builder's field picker and Configure columns list full_name/email/tags only. No `age` header.
- [ ] **Member**, `GET /api/curated-views/<Parity narrow id>/records?filters=B64(full_name eq "Alice Adams")` (no grant on the view) → the same denial as without `filters` (403/404). The filter must not turn a denial into a 400 that confirms the view exists. — backend

## §5 — Multi-tenant isolation
- [ ] **Owner**, `GET /api/curated-views/<other-org view id>/records?filters=B64(…)&sortBy=…` → 404, the same as without `filters`. No rows, columns or field names leak in the error. — backend
- [ ] **Owner**, a filter whose `field` is a normalizedKey that exists only in the other org's entity → 400 `Unknown field`. The validation set is this view's own columns. — backend

## §6 — State & lifecycle abuse
- [ ] With the page open and `age > 30` applied, the owner removes `age` from `Parity view` in another tab, then pages or sorts in the first tab → the server 400 is caught and the filter cleared. The info toast "Your filter referenced a column you can't use in this view, so it was cleared." appears, and rows load. The page doesn't stick in an error. Restore `age` afterwards.
- [ ] With `sortBy=age` saved, the owner removes `age` from the view, then reload → the page loads with the fallback order and no error (an unprojected sortBy falls back). Restore `age`.
- [ ] Delete `Parity narrow` (after noting its id), then request its records with `filters` → 404, not a 500. Recreate it if later probes need it. — backend

## §7 — Misuse sequences
- [ ] As the **member**, in devtools, save a `pagination:curated-view:<Parity view id>` whose `advancedFilters` is `age > 30`, then reload → the hook strips `age` against the member's columns before sending. No `filters` naming `age` goes out, and no 400 or toast.
- [ ] As the **member**, hand-edit the request in devtools to `filters=B64(age > 30)` → 400. The server is the boundary, not the stripped client state. — backend
- [ ] A view whose **own** stored filter references a column later removed from the entity: request its records → a clean error. No user-filter toast claims the reader's filter was cleared (the code-review fix #2). — backend

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/view/entity ids):
