# Demo custom webhook toolpack — Condensed design (#510)

**Issue:** [EnterpriseBT/portal-ai#510](https://github.com/EnterpriseBT/portal-ai/issues/510) · Feature (epic child of #507) · **small / condensed** (discovery + spec + plan + smoke in one doc). Branch `feat/demo-webhook-toolpack`, base `epic/demo-org`.

**Why.** The demo needs one **real** custom webhook toolpack — the enterprise extension axis and paid differentiator (`customToolpacks` entitlement). Nothing hosted exists; `docs/CUSTOM_TOOLPACK_INTEGRATION.md` defines the contract and `RegisterToolpackDialog` carries boilerplates, but there's no reference deployment. This ships one small hosted endpoint over the Harborview Supply Co. domain (#508) whose answers are visibly **not** derivable from the loaded data, so a demo prompt proves "plug in your own tools." Code here; the deploy + secret + curl are ops (like #511).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Wire contract | `docs/CUSTOM_TOOLPACK_INTEGRATION.md:17-19,283-304` | Three endpoints: `GET /schema` (required, tool catalog), `GET /metadata` (optional), `POST /runtime` (required, body `{tool, input}`, response any JSON). |
| Outbound signing | `docs/CUSTOM_TOOLPACK_INTEGRATION.md:27-47`; `apps/api/src/utils/webhook-signing.util.ts:43-66` | Every call carries `X-Portalai-Timestamp` / `-Webhook-Id` / `-Signature` (`v1=` HMAC-SHA256 over `<ts>.<id>.<rawBody>`). GET body = `""`. 401 `SIGNATURE_MISSING`/`TIMESTAMP_STALE`(>300s/<-60s)/`SIGNATURE_INVALID`. **This is the authoritative auth**; configured `authHeaders` are additive. |
| Reference impl to mirror | `apps/api/src/scripts/mock-toolpack-server.ts` | Express version of the three endpoints + signature verification. Our Lambda mirrors its verify logic. |
| Registration | `apps/api/src/routes/toolpacks.router.ts:276-398`; `RegisterToolpackDialog.component.tsx:60-133` | Payload = `{name, description?, endpoints:{schema,runtime,metadata?}, authHeaders?}`. App **generates** the signing secret and returns it once (`whsec_…`); it fetches the tool list from `/schema` (no tool list submitted). Slug `^[a-z][a-z0-9_]{0,62}$`. |
| Cost | `apps/api/src/services/cost-gate.service.ts:148-150` | Custom tools are `costBearer:"organization"` → admission short-circuits, **never charged**. `costHint` is advisory only. |
| Infra | `infra/cloudformation/*.yml`; `.github/workflows/deploy-{dev,prod}.yml` `deploy-infra` job | Standalone stacks `portalai-<env>-<component>` (env-agnostic `portalai-dns-email`), deployed via `aws cloudformation deploy … --template-file …`, region us-east-1. **No Lambda exists yet** — this creates the pattern. |
| Secret catalog | `packages/devops-cli/src/catalog.ts:18-43`; `packages/cli-env/src/aws.ts` | `secret("KEY","name")` → Secrets Manager `portalai/<env>/<name>`; `portalops vars set/get`. Parity test (`deploy-parity.test.ts:109`) requires a template-consumed secret to be catalogued. |

## Decision — hosting: one shared Lambda function URL

**A single AWS Lambda + function URL, deployed once (env-agnostic stack `portalai-demo-toolpack`), that every demo env registers.** Alternatives: a route on our own API under `/api/public/demo/…` (rejected — it undercuts the "org-hosted, not part of Portals, who-pays" story), or one Lambda per env (rejected — the epic decision is a **shared** endpoint across local/app-dev/prod, and demo data is invented so there's no env-isolation reason). Function URL `AuthType: NONE` — the HMAC signature is the gate, not IAM. Zero runtime deps (only `node:crypto`), so the handler is a plain function-URL handler; code is pushed via `aws lambda update-function-code` after CFN creates the function (no S3 artifact bucket needed).

## Decision — auth: HMAC on `/runtime`, open catalog

The Lambda verifies the `X-Portalai-*` signature (mirroring `mock-toolpack-server.ts`) on **`POST /runtime`** — the sensitive tool-invocation path — against **an allow-list of signing secrets** in `PORTALAI_SIGNING_SECRETS` (comma-separated), trying each with a timing-safe compare. `GET /schema` and `GET /metadata` are **served openly** (they are non-sensitive public tool catalogs). This is deliberate and required for registerability: the app fetches `/schema` **signed with a secret it only returns after registration succeeds**, so enforcing signatures on `/schema` would make registration impossible (chicken-and-egg). Enforcing on `/runtime` protects the actual action; leaving the catalog open lets any env register (and refresh) first, then have its returned `whsec_…` appended to the allow-list via `portalops vars set DEMO_TOOLPACK_SIGNING_SECRETS "<local>,<appdev>,<prod>"`. An **empty** allow-list → `/runtime` returns 401 (fail-closed): the protected path never accepts unsigned traffic. One shared endpoint accepts every env's secret because the list holds them all.

## Decision — tools: two deterministic, non-derivable answers

Both compute from a small internal hash of their inputs, so output is fixed and the runbook can state expected values, and neither is answerable from the loaded entities:

- **`quote_shipping_rate`** — `{ origin_site_id, dest_site_id, weight_kg }` → `{ distance_miles, quoted_rate_usd, transit_days, service }` (a pseudo-distance from the site-id pair × weight).
- **`credit_check`** — `{ customer_id }` → `{ credit_score (300–850), risk_band, approved, credit_limit_usd }` (a deterministic pseudo-score).

Both declare `capability` as a pure consumer (`pure:true`, empty reads/writes/locks, `costHint:"free"` advisory, `production:{kind:"value"}`), per the contract's capability subset.

## Plan — 4 slices

1. **Package `packages/demo-toolpack/`.** Leaf ts-jest-ESM package (mirrors `packages/cli-env`). `src/tools.ts` (schemas + deterministic dispatch), `src/signing.ts` (verify against allow-list, timing-safe), `src/handler.ts` (function-URL handler: route `GET /schema|/metadata`, `POST /runtime`; verify; dispatch; size/limit caps). **Tests** (`src/__tests__/`): tool determinism (fixed input → fixed output), signing verify (valid / missing / stale / invalid / wrong-secret / allow-list hit), handler routing (schema shape, 401 unsigned, 404 unknown tool, runtime happy path). `README.md` doubles as the integration worked example.
2. **Infra.** `infra/cloudformation/demo-toolpack.yml` (Lambda Node 20 + function URL `AuthType NONE` + basic execution role + `SigningSecrets` param → env). Deploy step in `deploy-prod.yml` (env-agnostic `portalai-demo-toolpack`) that builds+zips `packages/demo-toolpack` dist and `aws lambda update-function-code`. `secret("DEMO_TOOLPACK_SIGNING_SECRETS","demo-toolpack-signing-secrets")` in `catalog.ts`. *(Deploy itself is ops — unverifiable from here; marked in smoke.)*
3. **Docs.** Link the reference impl from `docs/CUSTOM_TOOLPACK_INTEGRATION.md`; document the registration payload (name, endpoints) in the package README so #509 registers it non-interactively. **`docs/DEMO_ORG.runbook.md` prompt 11** (the concrete `credit_check` call + `{credit_score:719,…}` expectation) is finalized at **epic integration** — that file is authored on #508's branch and is not on `epic/demo-org` until the dataset child merges, so editing it here isn't possible. The exact values live in `packages/demo-toolpack/README.md` meanwhile.
4. **Registration payload constant** for #509 to consume (name `demo_supply_tools`, the three endpoint URLs from config, no authHeaders — HMAC only).

## Smoke (manual, against your dev stack + ops)

1. `npm run --workspace @portalai/demo-toolpack test:unit` — tools deterministic, signing + routing correct. (**Agent-runnable here.**)
2. Invoke the built handler directly (unit/integration): `GET /schema` returns the two-tool catalog with no signature; `POST /runtime` with a valid signature returns the deterministic answer; unsigned/invalid `/runtime` → 401. (**Local/agent.**)
3. **Ops (human):** deploy the stack; `portalops vars set DEMO_TOOLPACK_SIGNING_SECRETS …`; `curl` the function URL with a valid signature → tool response; without → 401.
4. **Ops (human):** register via `RegisterToolpackDialog` on app-dev with the documented payload → succeeds first try, tools appear on the station.
5. Runbook prompt 11 on the seeded org calls the tool and the answer matches the documented expectation.

## Out of scope

- A toolpack SDK / template repo — one reference deployment is the deliverable.
- Charging for custom tools — never charged by design.
- Per-env duplicate deployments — one shared endpoint by epic decision.
- The `bounded`/`streaming` dataset-scaling tiers — the two tools are simple `value` producers; the mock server already references the scaling tiers for anyone who needs them.
