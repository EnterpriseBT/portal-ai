# Deployment Security Review

The residency counterpart to the SaaS security posture (the 🛡️ **Security & Compliance** artifact). A residency install runs on the **client's own infrastructure**, so before one ships, its data-egress vectors and deployment posture need an explicit, documented, signed-off decision with the client's security team. This is the review record for that.

**How to use it.** Copy the four sections below into a per-engagement record and complete every field with the client. Sign it off before the install ships. Per-client signed records live **with the engagement, not in this repo** — the one exception is the **SaaS baseline** at the end, which is filled for our own deployment (the "client" is us) and doubles as the worked example.

**What this is not.** It is not the SaaS security posture itself (that is the Security & Compliance artifact + the Security & Enterprise Readiness epic #578 + least-privilege IAM #397), and it is not the customer-facing **subprocessor list / DPA** we publish to *our* SaaS customers (a commercial/legal artifact — we are the processor there).

The egress facts are code-derived and drift with the code; keep this doc in sync (the env vars and tools cited are the source of truth).

---

## 1 — Egress decision

Every third-party network call a deployment makes. Each is opt-in via an env var (an absent key disables the tool) and gated by toolpack/tier entitlement (`packages/core/src/registries/builtin-toolpacks.ts`, #214). Record the decision per vector: **on** · **self-host / proxy** · **drop**.

| Vector | Control | Provider (default) | Decision |
|---|---|---|---|
| LLM (agent) | `ANTHROPIC_BASE_URL` (`apps/api/src/environment.ts`) — empty = Anthropic direct; set = self-hosted/proxied model (#567) | Anthropic | `on / self-host / drop` |
| Web search (`web_search`) | `TAVILY_API_KEY` + `apps/api/src/tools/web-search.tool.ts` — absent = tool unavailable | Tavily | `on / drop` |
| Geocoding (`geocode`, `reverse_geocode`, `bulk_geocode_records`) | `GEOCODING_API_KEY` + `apps/api/src/tools/*geocode*.tool.ts` — absent = tools unavailable | (geocoding provider) | `on / self-hosted geocoder / drop` |

> A residency install can withhold an entire toolpack (via tier entitlement) so the tool never appears, independent of the key.

## 2 — Subprocessor DPA

Any provider above that is **enabled** processes data on the deployment's behalf and must be documented as a subprocessor, with its data-handling posture on record.

| Subprocessor | Engaged when | Data-handling posture to record |
|---|---|---|
| **Anthropic** | LLM egress on (always, unless a self-hosted model via `ANTHROPIC_BASE_URL`) | No-training + zero-retention posture per Anthropic's commercial terms — attach/cite the current DPA. |
| **Tavily** | `web_search` enabled | Query egress; cite Tavily's DPA/retention terms. |
| Geocoding provider | geocode tools enabled | Address/coordinate egress; cite the provider's DPA. |
| Hosting/infra | always | The client's own cloud (residency) — not our subprocessor. |

## 3 — Telemetry policy

The application ships **no third-party telemetry/analytics** by default (no PostHog/Sentry/etc.; verified in the codebase). Record: **none** — or, if the client enables an opt-in channel, pin exactly what it may carry (no record content, no PII; operational metrics only).

| Item | Decision |
|---|---|
| Telemetry channel | `none (default) / opt-in — scope: <what it may carry>` |

## 4 — Deployment security checklist

The client-owned controls around the install. The chart (`deploy/helm/portalai`) is the least-privilege surface they review.

| Control | Record |
|---|---|
| Encryption at rest | Client's KMS / disk encryption for the DB, object store, Redis. |
| Identity provider | Client OIDC/SSO issuer (residency runtime OIDC, #607) — issuer, audience, client id. |
| Network egress rules | Egress allow-list matching the §1 decision (Anthropic/Tavily/geocoder endpoints, or none). |
| Least-privilege | Chart `podSecurityContext` (non-root), resource requests/limits, secrets via `existingSecret`, no cluster-admin. |
| Data residency | Confirm all bundled/external data deps (PostGIS, Redis, MinIO/S3) sit in the client's region/boundary. |

## Sign-off

- [ ] All four sections completed with the client's security team
- [ ] Subprocessor postures attached/cited
- Reviewed by: `<client security contact>` · `<our contact>` · Date: `<date>`

---

## Completed record — SaaS baseline (`portalsai.io`, on our AWS)

Our own SaaS deployment run through the same review — the "client" is us. Doubles as the worked example. SaaS runs on **ECS/Fargate + RDS + S3** (not the Helm chart), so the least-privilege row maps to the ECS task role. Items not verifiable from the repo are marked `confirm`.

**§1 — Egress.**

| Vector | Decision | Basis |
|---|---|---|
| LLM | **On — Anthropic direct** (`ANTHROPIC_BASE_URL` unset in prod — `confirm` via `portalops vars get ANTHROPIC_BASE_URL --env prod`) | Core agent loop |
| Web search | **On — Tavily** (`TAVILY_API_KEY` set — `confirm`) | `web_search` toolpack shipped |
| Geocoding | **On** (`GEOCODING_API_KEY` set — `confirm`) | GIS toolpack shipped |

**§2 — Subprocessors:** Anthropic (LLM), Tavily (web search), the geocoding provider, and **AWS** (hosting — our own account). Anthropic no-training/zero-retention per commercial terms — `confirm current DPA on file`.

**§3 — Telemetry:** **None.** No third-party telemetry/analytics in the app (verified). App logs are Pino → CloudWatch within our account; no external analytics egress.

**§4 — Deployment checklist:**

| Control | SaaS baseline |
|---|---|
| Encryption at rest | **RDS `StorageEncrypted: true`** (`infra/cloudformation/database.yml`); **S3 `SSEAlgorithm: AES256`** on the upload/site/frontend buckets (`infra/cloudformation/{site,frontend,backend}.yml`); app-level `ENCRYPTION_KEY` encrypts `connector_instances.credentials` + toolpack auth headers (`docs/PROD_PROVISIONING.runbook.md`). |
| Identity provider | **Auth0** — prod tenant, audience `https://api.portalsai.io` (`apps/api/src/environment.ts`, `docs/PROD_PROVISIONING.runbook.md`). |
| Network egress | Anthropic + Tavily + geocoding endpoints; no telemetry egress. VPC/security-group egress allow-list — `confirm` against the prod VPC. |
| Least-privilege | ECS `TaskRole` (app perms) + `TaskExecutionRole` (pull/secrets), separate roles (`infra/cloudformation/backend.yml`). Container non-root is tracked in **#578/#571** (not yet on the SaaS image) — `in progress`. |
| Data residency | Single region (our AWS) — `confirm` region. |

**Sign-off (SaaS baseline):** reviewed by `<our security owner>` · Date `<date>` — the `confirm`/`in progress` items above are the open action list.
