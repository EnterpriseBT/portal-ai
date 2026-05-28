# REST API connector — pre-commit probe + transform — Smoke Checklist

Manual smoke check exercised against a real public REST API after the
slice 1–9 work lands. Run end-to-end before opening the PR for review.

**Reference:** `docs/REST_API_PRE_COMMIT_PROBE.{discovery,plan}.md`.

---

## Setup

1. Start the local stack (`npm run dev` from the repo root). API on
   `http://localhost:3001`, web on `http://localhost:3000`.
2. Sign in with a dev Auth0 account; open the **Connectors** view.
3. Click "New connector" → **REST API**.

## Test API picks

Two endpoints, picked so the smoke covers both `recordsPath` and
`transform` paths against real-world response shapes:

| API | Endpoint | Notes |
|---|---|---|
| GitHub Search Repositories | `https://api.github.com/search/repositories` | Requires `q` query param; records nested under `items` — drives `recordsPath` path. Auth: none for public read-only. |
| OpenWeatherMap Geocoding | `https://api.openweathermap.org/geo/1.0/direct` | API-key auth via `appid` query param; response is a top-level array of one-level-nested objects — drives the `transform` path with a projection. Free-tier key from openweathermap.org. |

If either API is rate-limiting, fall back to any public REST that
returns JSON. The acceptance criteria below are API-agnostic.

---

## Step 1 — Basics

- [ ] Connector name accepts free text.
- [ ] Base URL accepts an `https://…` URL; invalid URLs surface inline.
- [ ] Auth toggle (`none` / `apiKey` / `bearer` / `basic`) shows the
      matching credential form when selected.
- [ ] First field receives autofocus when the modal opens.

## Step 2 — Endpoints (recordsPath path)

Use the GitHub example.

- [ ] Add endpoint with `path = /search/repositories`, `method = GET`,
      `recordsPath = items`.
- [ ] Pagination = `none` (default).
- [ ] Save returns the user to the endpoints step with the new row listed.
- [ ] No `transform` is set; the "Advanced — transform" accordion is collapsed.

## Step 3 — Probe & review (recordsPath path)

- [ ] Step-3 entry auto-fires the probe (network panel: one
      `POST /api/connector-instances/probe-endpoint-draft` per endpoint).
- [ ] Loading state shows briefly, then transitions to success.
- [ ] Inferred columns table is populated (column key, type, sample).
- [ ] `SuggestionChip`s render with the matched ColumnDefinition label
      + confidence when the AI-assist layer is wired.
- [ ] If the classifier isn't wired in dev (`llm-disabled` degradation),
      the section renders without chips and the table still lists
      heuristic-inferred columns.

## Step 2 (revisit) — Endpoints (transform path)

Use the OpenWeatherMap example (or substitute one with a nested response).

- [ ] Add a second endpoint with `path = /direct`, query params for
      `q` and `appid`, no `recordsPath`.
- [ ] Expand "Advanced — transform"; the editor renders.
- [ ] Type a projection (e.g. `$.{ "name": name, "lat": lat, "lon": lon }`).
- [ ] Live preview pane shows the transformed records when a probe
      response is available; until then it shows the "probe first" hint.
- [ ] Status line reads `✓ N records` for a valid expression; switches
      to `✗ Parse error: …` for `data.{ unclosed`.
- [ ] Setting both Transform and Records path fields surfaces the
      client-side mutual-exclusion error before submit.

## Step 3 — Probe & review (transform path)

- [ ] Re-entering step 3 fires only the transform-bearing endpoint's
      probe (the recordsPath endpoint hits the in-process cache).
- [ ] Success state lists flattened columns (e.g. `name`, `lat`, `lon`)
      derived from the transformed shape — NOT the nested original keys.
- [ ] Click "Re-probe" on the transform endpoint → network panel shows
      one new request with `forceRefresh: true`; other endpoint cards
      are unaffected.

## Step 3 — Failure paths

- [ ] Edit the transform expression to deliberately error (e.g.
      `data.{ unclosed`) and re-enter step 3 → that endpoint card
      shows the warning banner with the parse error message; columns
      table is empty. The OTHER endpoint's card still shows success.
- [ ] The Next button is enabled (per discovery decision 7 — probe
      failures warn but don't block step advancement).

## Step 4 — Review + commit

- [ ] Review step lists both endpoints with their column counts.
- [ ] Commit fires `POST /api/connector-instances` then per-endpoint
      `POST /api/connector-instances/:id/api-endpoints` (network panel).
- [ ] On success the workflow navigates to the new connector's detail
      view; both endpoints render with the materialized field mappings.
- [ ] No errors in browser console; no errors in API logs.

## Step 5 — Edit invalidation

- [ ] From the workflow modal (open → step 2), edit the transform
      endpoint's `label` only (rename). Re-enter step 3 → that endpoint
      does NOT re-probe (cache hit, no network request).
- [ ] Edit the same endpoint's `path` → re-enter step 3; that endpoint
      DOES re-probe.

## Step 6 — Sync against transform-bearing endpoint

After commit, from the connector detail view:

- [ ] Trigger a manual sync.
- [ ] Records flow into the wide table with the FLATTENED column
      keys (matching what the probe showed).
- [ ] Sync completes successfully.
- [ ] Mid-sync, deliberately corrupt the transform (via PATCH on the
      endpoint config) → next sync fails with REST_API_TRANSFORM_FAILED
      in the job error; restoring the transform fixes the next run.

---

## Acceptance criteria

- All boxes checked above.
- No console errors during the full walk-through.
- API server logs show no 5xx responses (4xx during validation is
  fine; 5xx is a bug).
- The transform-bearing endpoint's flattened columns match what
  JSONata's live preview rendered before commit.

If any box fails, file an issue with the API picks + steps + browser
console output. The doc gets a row in the issue body for the failure.
