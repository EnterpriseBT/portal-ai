# @portalai/demo-toolpack

Reference **custom webhook toolpack** for the demo org (#510) — and a worked example for [`docs/CUSTOM_TOOLPACK_INTEGRATION.md`](../../docs/CUSTOM_TOOLPACK_INTEGRATION.md).

A single AWS Lambda **function-URL** handler that serves the custom-toolpack contract and answers two deterministic tools over the Harborview Supply Co. demo domain (#508). It is the smallest real thing that demonstrates the enterprise "plug in your own tools" axis: an org-hosted endpoint, not part of Portals AI, that the agent calls and pays nothing for.

## The contract it serves

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/schema` | GET | **HMAC** | Tool catalog (`{ tools: [...] }`) |
| `/metadata` | GET | **HMAC** | Human-readable descriptions/examples |
| `/runtime` | POST | **HMAC** | Invoke a tool: body `{ tool, input }`, returns any JSON |

The handler verifies the `X-Portalai-*` HMAC signature (see `docs/CUSTOM_TOOLPACK_INTEGRATION.md`) on **every request** when `PORTALAI_SIGNING_SECRETS` is set: the GETs over the empty body, `/runtime` over its raw body. The app registers with a secret this allow-list already holds (the demo seed uses its first entry, #911), so the registration fetches verify too. When it is **unset**, every route accepts unsigned calls (the reference `mock-toolpack-server`'s SKIPPED mode). That open catalog is an option, since the demo payloads are invented, but a weaker one: anyone can call the endpoint. Set `PORTALAI_SIGNING_SECRETS` to lock it down.

## The tools

Both are **deterministic** (a hash of the inputs) and **not derivable from the connected data** — that's the point.

- **`quote_shipping_rate`** — `{ origin_site_id, dest_site_id, weight_kg }` → `{ distance_miles, quoted_rate_usd, transit_days, service }`.
  Example: `{ "origin_site_id": "SITE-001", "dest_site_id": "SITE-009", "weight_kg": 250 }` → `{ "distance_miles": 1997, "quoted_rate_usd": 136.46, "transit_days": 4, "service": "freight" }`.
- **`credit_check`** — `{ customer_id }` → `{ credit_score, risk_band, approved, credit_limit_usd }`.
  Example: `{ "customer_id": "CUST-00001" }` → `{ "credit_score": 719, "risk_band": "good", "approved": true, "credit_limit_usd": 13000 }`.

## Configuration

| Env var | Purpose |
|---|---|
| `PORTALAI_SIGNING_SECRETS` | Comma-separated allow-list of `whsec_…` secrets, one per demo env sharing this endpoint. Every route accepts a request whose signature matches **any** of them. Set through the stack's `SigningSecrets` parameter. |

## Deploy (ops)

One shared endpoint serves all demo envs (epic #507 decision). Deployed via CloudFormation as the env-agnostic stack `portalai-demo-toolpack` (`infra/cloudformation/demo-toolpack.yml`), wired into the `deploy-infra` job. Because the function-URL is `AuthType: NONE`, the HMAC signature is the gate.

1. **Generate one secret per demo env:** `whsec_` + 43 base64url characters, e.g. `node -e "console.log('whsec_'+require('crypto').randomBytes(32).toString('base64url'))"` (or copy one from the register dialog).
2. **Record each env's secret:** `portalops vars set DEMO_TOOLPACK_SIGNING_SECRETS "<this-env's secret>" --env <env> --yes`. The demo seed registers with the **first** entry, so if an env's copy lists several, put that env's own secret first.
3. **Load the allow-list into the Lambda:** update the `portalai-demo-toolpack` stack with `SigningSecrets` set to every env's secret, comma-joined (`aws cloudformation deploy … --parameter-overrides SigningSecrets=<a>,<b>,<c>`). The deploy workflow leaves the parameter as it was.
4. **Register** by running `portalai demo seed --env <env> --org <id> …` with `DEMO_TOOLPACK_URL` and `DEMO_TOOLPACK_SIGNING_SECRETS` exported in your shell (read them with `portalops vars get`). The seed script only sees what your shell passes it. A re-seed keeps the same secret.
5. **Verify:** `curl` each route with a valid signature → 200; without → 401.

**Release order (#911).** This version verifies `/schema` and `/metadata` too, so once it's deployed with a non-empty allow-list, a registration the Lambda can't verify is refused. Before deploying it: put each env's existing registered secret in `DEMO_TOOLPACK_SIGNING_SECRETS` (or record a new one and re-seed), and make sure the `SigningSecrets` allow-list holds them all. A demo seed run without the variable mints a secret the Lambda doesn't hold, so its registration fails with `TOOLPACK_SIGNATURE_REJECTED` and the demo org gets built-in toolpacks only. Existing registrations keep working as long as their stored secret is in the allow-list.

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
