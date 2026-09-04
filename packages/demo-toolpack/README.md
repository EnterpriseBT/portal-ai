# @portalai/demo-toolpack

Reference **custom webhook toolpack** for the demo org (#510) — and a worked example for [`docs/CUSTOM_TOOLPACK_INTEGRATION.md`](../../docs/CUSTOM_TOOLPACK_INTEGRATION.md).

A single AWS Lambda **function-URL** handler that serves the custom-toolpack contract and answers two deterministic tools over the Harborview Supply Co. demo domain (#508). It is the smallest real thing that demonstrates the enterprise "plug in your own tools" axis: an org-hosted endpoint, not part of Portals AI, that the agent calls and pays nothing for.

## The contract it serves

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/schema` | GET | open | Tool catalog (`{ tools: [...] }`) |
| `/metadata` | GET | open | Human-readable descriptions/examples |
| `/runtime` | POST | **HMAC** | Invoke a tool: body `{ tool, input }`, returns any JSON |

`/schema` and `/metadata` are served openly (they are non-sensitive tool catalogs, and the app fetches `/schema` **signed with a secret it only returns after registration** — enforcing there would make registration impossible). `/runtime` verifies the `X-Portalai-*` HMAC signature (see `docs/CUSTOM_TOOLPACK_INTEGRATION.md`) against the `PORTALAI_SIGNING_SECRETS` allow-list. An empty allow-list fails `/runtime` closed with a 401.

## The tools

Both are **deterministic** (a hash of the inputs) and **not derivable from the connected data** — that's the point.

- **`quote_shipping_rate`** — `{ origin_site_id, dest_site_id, weight_kg }` → `{ distance_miles, quoted_rate_usd, transit_days, service }`.
  Example: `{ "origin_site_id": "SITE-001", "dest_site_id": "SITE-009", "weight_kg": 250 }` → `{ "distance_miles": 1997, "quoted_rate_usd": 136.46, "transit_days": 4, "service": "freight" }`.
- **`credit_check`** — `{ customer_id }` → `{ credit_score, risk_band, approved, credit_limit_usd }`.
  Example: `{ "customer_id": "CUST-00001" }` → `{ "credit_score": 719, "risk_band": "good", "approved": true, "credit_limit_usd": 13000 }`.

## Configuration

| Env var | Purpose |
|---|---|
| `PORTALAI_SIGNING_SECRETS` | Comma-separated allow-list of the `whsec_…` secrets Portal returns at registration — one per demo env sharing this endpoint. `/runtime` accepts a request whose signature matches **any** of them. |

## Deploy (ops)

One shared endpoint serves all demo envs (epic #507 decision). Deployed via CloudFormation as the env-agnostic stack `portalai-demo-toolpack` (`infra/cloudformation/demo-toolpack.yml`), wired into the `deploy-infra` job. Because the function-URL is `AuthType: NONE`, the HMAC signature is the gate.

1. **Deploy the stack** (creates the Lambda + function URL). Note the function URL output.
2. **Register** the toolpack in each demo env via `RegisterToolpackDialog` (or #509's non-interactive path) using the payload below; capture the `whsec_…` each returns once.
3. **Provision the secrets:** `portalops vars set DEMO_TOOLPACK_SIGNING_SECRETS "<local>,<app-dev>,<prod>" --env <env> --yes` (the value is the same comma-joined allow-list in each env's copy) and redeploy so the Lambda picks up the new env var.
4. **Verify:** `curl` `/runtime` with a valid signature → tool result; without → 401. `GET /schema` returns the catalog unsigned.

## Registration payload (for #509)

```json
{
  "name": "demo_supply_tools",
  "description": "Harborview Supply Co. vendor tools — shipping quotes and credit checks.",
  "endpoints": {
    "schema": "<FUNCTION_URL>/schema",
    "runtime": "<FUNCTION_URL>/runtime",
    "metadata": "<FUNCTION_URL>/metadata"
  }
}
```

No `authHeaders` — the HMAC signature is the only auth. `<FUNCTION_URL>` is the single shared endpoint, read from config by #509 (`DEMO_TOOLPACK_URL`).

## Local development

The handler is framework-free and unit-tested. To exercise the endpoints locally, the sibling `apps/api` mock (`npm run --workspace @portalai/api webhook:toolpack`) is the Express reference; this package is the deployable Lambda equivalent.

```bash
npm run --workspace @portalai/demo-toolpack test:unit   # tools, signing, handler
npm run --workspace @portalai/demo-toolpack build       # dist/ (index.handler is the Lambda entry)
```
