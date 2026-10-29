# Deployment Security Review

The residency counterpart to the SaaS security posture (the 🛡️ **Security & Compliance** artifact). A residency install runs on the **client's own infrastructure**, so before one ships, its data-egress vectors and deployment posture need an explicit, documented, signed-off decision with the client's security team. This is the review record for that.

**How to use it.** Copy sections 1–4 below into a per-engagement record and complete every field with the client; §5 lists the controls the application enforces itself, for reference. Sign it off before the install ships. Per-client signed records live **with the engagement, not in this repo** — the one exception is the **SaaS baseline** at the end, which is filled for our own deployment (the "client" is us) and doubles as the worked example.

**What this is not.** It is not the SaaS security posture itself (that is the Security & Compliance artifact + the Security & Enterprise Readiness epic #578 + least-privilege IAM #397), and it is not the customer-facing **subprocessor list / DPA** we publish to *our* SaaS customers (a commercial/legal artifact — we are the processor there).

The egress facts are code-derived and drift with the code; keep this doc in sync (the env vars and tools cited are the source of truth).

---

## 1 — Egress decision

Every network call a deployment makes to a host outside its own boundary, server side and in the user's browser. Record the decision per vector: **on** · **self-host / proxy** · **drop**. Most vectors are opt-in via an env var (an absent key disables the tool or connector) and the agent tools are additionally gated by toolpack/tier entitlement (`packages/core/src/registries/builtin-toolpacks.ts`, #214). The ones marked **always** have no switch today.

**Server side (the API container):**

| Vector | Control | Data sent | Provider (default) | Decision |
|---|---|---|---|---|
| LLM — agent loop | `ANTHROPIC_API_KEY`; `ANTHROPIC_BASE_URL` (`apps/api/src/services/ai.service.ts`, #567) — empty = Anthropic direct, set = self-hosted/proxied model | Everything the agent reads in a portal session: the prompt, station context and tool results, **including record values** (capped per result, #726) | Anthropic | `on / self-host / drop` |
| LLM — chart code generation (`visualize_d3`) | same | The result's column schema and **up to 10 sample rows** (`apps/api/src/tools/visualize-d3.tool.ts`) | Anthropic | `on / self-host / drop` |
| LLM — spreadsheet interpret (file upload, Google Sheets, Excel) | same, plus `INTERPRET_CLASSIFIER_MODEL` / `INTERPRET_AXIS_NAME_MODEL` (`apps/api/src/services/spreadsheet-parsing-llm.service.ts`) | Header labels and **sample cell values** per candidate column (`packages/spreadsheet-parsing/src/interpret/llm/prompt.ts`) | Anthropic | `on / self-host / drop` |
| LLM — REST column classifier | same (`apps/api/src/adapters/rest-api/classifier.haiku.ts`) | Field names, heuristic types and **truncated sample values** from the endpoint's response (`classifier.prompt.ts`) | Anthropic | `on / self-host / drop` |
| LLM — REST transform suggester | same (`apps/api/src/adapters/rest-api/jsonata-suggest.haiku.ts`) | **A sample of the endpoint's response body** and the author's description | Anthropic | `on / self-host / drop` |
| LLM — curated-view SQL filter suggester (#644) | same (`apps/api/src/services/curated-view-filter-suggest.haiku.ts`); reachable only on a tier with `advancedViewFilters` | Column keys and types, top-level key names of JSON columns (from up to 20 rows) and the author's description — **never a record value** | Anthropic | `on / self-host / drop` |
| Web search (`web_search`) | `TAVILY_API_KEY` (`apps/api/src/tools/web-search.tool.ts`) — absent = tool unavailable | The agent's search query | Tavily | `on / drop` |
| Geocoding (`geocode`, `reverse_geocode`, `bulk_geocode_records`) | `GEOCODING_API_KEY` (`apps/api/src/services/geocoding/mapbox.ts`) — absent = tools unavailable | Addresses / coordinates | Mapbox | `on / self-hosted geocoder / drop` |
| Google Sheets connector | `GOOGLE_OAUTH_*`, `GOOGLE_PICKER_API_KEY` (`google-auth.service.ts`, `google-sheets-connector.service.ts`) — absent = connector unavailable | OAuth tokens; reads the sheets the user picks | Google | `on / drop` |
| Excel (OneDrive) connector | `MICROSOFT_OAUTH_*` (`microsoft-auth.service.ts`, `microsoft-graph.service.ts`) — absent = connector unavailable | OAuth tokens; reads the workbooks the user picks | Microsoft | `on / drop` |
| REST API connector | Per connection: the customer configures the base URL (`apps/api/src/adapters/rest-api/fetch.util.ts`) | Whatever the connection's requests carry (auth headers, query params) to **a host the customer names** | Customer-chosen | `on / drop` (allow-list per connection) |
| Custom webhook toolpacks | Per registration: schema / runtime URLs, SSRF-checked (`apps/api/src/utils/url-safety.util.ts`, `toolpack-registration.service.ts`) | Tool input, and for bounded/streaming tools the records or a staged-read handle (`apps/api/src/tools/webhook.tool.ts`) to **a host the org registers** | Customer-chosen | `on / drop` |
| Entitlement — AWS Marketplace | `AWS_MARKETPLACE_PRODUCT_CODE` / `AWS_MARKETPLACE_REGION` (`apps/api/src/services/marketplace.service.ts`, #568); inbound SNS to `/api/webhooks/aws-marketplace`, whose signature check fetches AWS's signing certificate (`webhook.router.ts`) | Customer identifier → entitlement read. **The Entitlement Service is us-east-1 only**, so this is a cross-region call for an install in any other region | AWS | `on / drop` |
| Identity — Auth0 (SaaS) | `AUTH0_*` (`apps/api/src/services/auth0.service.ts`); a residency install validates the customer's own OIDC issuer instead (`OIDC_ISSUER`, #607) | Token validation, userinfo | Auth0 / customer IdP | `on` |
| Site rebuild trigger | `GITHUB_DISPATCH_TOKEN` (`apps/api/src/services/rebuild-dispatch.service.ts`) | A `repository_dispatch` with no customer data | GitHub | `on / drop` (SaaS only) |

**Browser side (the user's browser loading the web app):**

| Vector | Control | Data sent | Provider (default) | Decision |
|---|---|---|---|---|
| Map basemap tiles | **always** — hard-coded in `apps/web/src/modules/MapWidget/utils/map-config.util.ts`; no runtime override yet (**#910**) | The viewer's IP and map viewport; no records | CARTO, OpenStreetMap Foundation | `on` (until #910) |
| Sign-in | `VITE_AUTH0_*` (SaaS) or the residency runtime OIDC config (#607) | The sign-in flow | Auth0 / customer IdP | `on` |
| Google Picker | `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_PICKER_API_KEY` + `GOOGLE_CLOUD_PROJECT_NUMBER`, served to the browser by `/api/connector-config` (#580), which serves none of them unless all three are set; only when a user connects Google Sheets | The picker session | Google | `on / drop` |

> A residency install can withhold an entire toolpack (via tier entitlement) so its tools never appear, independent of the key. `apps/api/src/__tests__/subprocessor-egress-parity.test.ts` and `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts` fail CI on an env var or browser host that isn't classified, so a new vector forces this table to be revisited.

## 2 — Subprocessor DPA

Any provider above that is **enabled** processes data on the deployment's behalf and must be documented as a subprocessor, with its data-handling posture on record.

| Subprocessor | Engaged when | Data-handling posture to record |
|---|---|---|
| **Anthropic** | Any LLM vector on (always, unless a self-hosted model via `ANTHROPIC_BASE_URL`) — note that four of the six callers send record or sample values | No training on API data, retention per Anthropic's standard commercial API terms (there is **no** zero-data-retention agreement) — attach/cite the current DPA. |
| **Tavily** | `web_search` enabled | Query egress; cite Tavily's DPA/retention terms. |
| **Mapbox** | geocode tools enabled | Address/coordinate egress; cite Mapbox's DPA. |
| **Google** | Google Sheets connector enabled | OAuth + the sheets users connect; cite Google's DPA. |
| **Microsoft** | Excel (OneDrive) connector enabled | OAuth + the workbooks users connect; cite Microsoft's DPA. |
| **CARTO**, **OpenStreetMap Foundation** | Always (browser basemaps) until #910 | Viewer IP + viewport, no records; cite their terms. |
| **AWS (Marketplace)** | Marketplace entitlement enabled | Customer identifier only; covered by the AWS agreement. |
| Customer-chosen hosts (REST connections, webhook toolpacks) | Per connection / registration | Not our subprocessor — the customer names the host; record the allow-list. |
| Hosting/infra | always | The client's own cloud (residency) — not our subprocessor. |

> **The hosted service's public list** is `SUBPROCESSORS` in `packages/core/src/content/subprocessors.util.ts`, rendered on the marketing site's `/security/` and privacy pages (#613), and held to the code by the two parity tests above.

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
| Encryption in transit | Whether Postgres connections require TLS (the app does not force it — record the server-side setting); Redis over `rediss://` with the chart's `redis.external.tls.caSecret` for a private CA (#852); TLS at the ingress (`ingress.tls`). |
| Identity provider | Client OIDC/SSO issuer (residency runtime OIDC, #607) — issuer, audience, client id (`oidc.*` in the chart). |
| Network egress rules | Egress allow-list matching the §1 decision — server and browser rows separately (a browser allow-list is the customer's proxy, not the cluster's). Note the AWS Marketplace row is us-east-1 regardless of install region. |
| Least-privilege | Chart `podSecurityContext` (non-root), resource requests/limits, secrets via `existingSecret`, no cluster-admin. |
| Data residency | Confirm all bundled/external data deps (PostGIS, Redis, MinIO/S3) sit in the client's region/boundary, and which §1 vectors (if any) are allowed to leave it. |
| Image provenance | The API image is Trivy-gated, SBOM-attested and cosign-signed (`docs/SUPPLY_CHAIN.md`); verify the digest before mirroring. The web image is gated the same way, per platform (#909). |
| Agent SQL boundary | Agent-authored SQL (`sql_query`, `display_entity_records`, `visualize_*`, analytics pushdowns, map tiles/dissolve, `transform_entity_records` fragments) is gated by **Postgres's own parser** (`libpg-query`): a single `SELECT` over only the caller's granted curated views (+ `_meta_*`), allowlisted functions, no schema-qualified names, no role/GUC changes (#660). Behind the gate, Postgres enforces it: agent SQL runs under the **restricted reader role** (`PORTAL_SQL_READER_ROLE`, migration `0118`), which can read only the session's temp views (#660 PR 2). Record that the API logged `portal-sql.reader-role-ok` at boot; with the role missing or over-privileged the SQL tools refuse (`PORTAL_SQL_UNAVAILABLE`) rather than run with the app user's privileges. |

## 5 — Application-level controls (reference)

Controls the application enforces in code, the same on every deployment. Nothing to decide here; cite them in the client's record.

| Control | Enforced by |
|---|---|
| Every route authorizes server-side, including reads and SSE; an unreadable object answers 404 | `apps/api/src/__tests__/config/route-authorization.map.ts` (guard test fails CI on an unclassified route), `ObjectAccessService` (#685, #692, #713) |
| Objects-and-parts permissions: records and field mappings follow their entity's permission; per-object grants and sharing | `PermissionService`, `ObjectCapabilitiesService`, `ParentAccessService` (#598–#630, #829) |
| A 500 never returns the caught error's message | `HttpService.error` (#687) |
| SSE bearer tokens are kept out of request logs | #728 |
| Job errors record no SQL, params or row values; job payloads are returned only to their creator or a caller with job control | #719, `JobPayloadRedactionService` (#692) |
| No NUL characters reach storage: refused at the request boundary, stripped on ingest | `reject-nul.middleware.ts`, `stripNulDeep` (#805) |
| Request bodies are strict (unknown keys are a 400); non-JSON bodies are a 415 | `json-body-only.middleware.ts`, `invalidPayload` (#745, #775) |
| Agent SQL runs under the restricted reader role | `portal-sql-reader-role.service.ts` (#660) |
| Tool spend is server-enforced and refusals are typed results | `CostGateService` (#169, #811) |

## Sign-off

- [ ] Sections 1–4 completed with the client's security team
- [ ] Subprocessor postures attached/cited
- Reviewed by: `<client security contact>` · `<our contact>` · Date: `<date>`

---

## Completed record — SaaS baseline (`portalsai.io`, on our AWS)

Our own SaaS deployment run through the same review — the "client" is us. Doubles as the worked example. SaaS runs on **ECS/Fargate + RDS + S3** (not the Helm chart), so the least-privilege row maps to the ECS task role. Items not verifiable from the repo are marked `confirm`.

**§1 — Egress.**

| Vector | Decision | Basis |
|---|---|---|
| LLM (all six callers) | **On — Anthropic direct** (`ANTHROPIC_BASE_URL` unset in prod — `confirm` via `portalops vars get ANTHROPIC_BASE_URL --env prod`) | Agent loop, chart codegen, spreadsheet interpret, REST classifier and transform suggester (these send record or sample values), view-filter suggester (no values) |
| Web search | **On — Tavily** (`TAVILY_API_KEY` set — `confirm`) | `web_search` toolpack shipped |
| Geocoding | **On** (`GEOCODING_API_KEY` set — `confirm`) | GIS toolpack shipped |
| Google / Microsoft connectors | **On** | Shipped connectors; only for sources a customer connects |
| REST connections, webhook toolpacks | **On** — customer-named hosts | Webhook URLs SSRF-checked (`url-safety.util.ts`) |
| AWS Marketplace | **On** — same region (us-east-1) | Marketplace listing (#568) |
| Site rebuild trigger | **On** — GitHub `repository_dispatch` | No customer data |
| Browser basemaps | **On** — CARTO / OSM, no override (#910) | Viewer IP + viewport |

**§2 — Subprocessors:** the ten in `SUBPROCESSORS` (published at `/security/#subprocessors`): **AWS** (hosting — our own account), **Auth0** (identity), **Stripe** (billing), **Google** and **Microsoft** (only for sources a customer connects), **Anthropic** (LLM), **Tavily** (web search), **Mapbox** (geocoding), and two the viewer's **browser** reaches directly — **CARTO** (default map basemap tiles) and the **OpenStreetMap Foundation** (OSM basemap tiles), each receiving the viewer's IP and map viewport, no records. Anthropic: no training on API data, standard commercial API retention — **no** zero-data-retention agreement. `confirm current DPA on file` for each.

**§3 — Telemetry:** **None.** No third-party telemetry/analytics in the app (verified). App logs are Pino → CloudWatch within our account; no external analytics egress.

**§4 — Deployment checklist:**

| Control | SaaS baseline |
|---|---|
| Encryption at rest | **RDS `StorageEncrypted: true`** (`infra/cloudformation/database.yml`); **S3 `SSEAlgorithm: AES256`** on the upload/site/frontend buckets (`infra/cloudformation/{site,frontend,backend}.yml`); **ElastiCache `AtRestEncryptionEnabled: true`** on the encrypted replication group (`infra/cloudformation/cache.yml`, #852), the only cache the templates define (`portalai-${Environment}-tls`; #872 removed the plaintext one); app-level `ENCRYPTION_KEY` encrypts `connector_instances.credentials` + toolpack auth headers (`docs/PROD_PROVISIONING.runbook.md`). |
| Encryption in transit | **ElastiCache `TransitEncryptionMode: required`**, reached over `rediss://` (`infra/cloudformation/{cache,backend}.yml`, #852); CloudFront (`site.yml`, `frontend.yml`) and the ALB (`backend.yml`) redirect HTTP to HTTPS. Postgres TLS is not enforced by the templates or the client config — `confirm` the RDS parameter group. |
| Identity provider | **Auth0** — prod tenant, audience `https://api.portalsai.io` (`apps/api/src/environment.ts`, `docs/PROD_PROVISIONING.runbook.md`). |
| Network egress | Server: the §2 subprocessors' endpoints (Anthropic, Tavily, Mapbox, Auth0, Stripe, Google, Microsoft) plus customer-hosted webhook toolpack endpoints; no telemetry egress. Browser: Auth0, Google's picker, and CARTO / OpenStreetMap basemap tiles (or a basemap URL a map spec names). VPC/security-group egress allow-list — `confirm` against the prod VPC. |
| Least-privilege | ECS `TaskRole` (app perms) + `TaskExecutionRole` (pull/secrets), separate roles (`infra/cloudformation/backend.yml`). Container runs **non-root** (`USER node`, `apps/api/Dockerfile`; Helm `runAsNonRoot`) — shipped by #571. CI deploys through scoped GitHub-OIDC roles (`github-cicd-deploy-{dev,prod}`) with **no `AdministratorAccess`** (#397, #876); operators use assumed read/write roles, with prod write MFA-gated; the break-glass `Admin` group is MFA-required (#878). Defined in `infra/cloudformation/iam.yml`; runbook in `docs/AWS_CLI_OPS.md`. |
| Data residency | Single region: **us-east-1** (our AWS account). |
| Agent SQL boundary | **App-level AST gate on every agent SQL path** (#660 PR 1 — `apps/api/src/services/portal-sql-parse.util.ts`, `portal-sql-validation.util.ts`): caller's session views only, function allowlist, `DISCARD TEMP` per session, pinned map pipelines re-validated each run, transform fragments limited to the source row. **DB-level enforcement (#660 PR 2):** agent SQL, map tiles and dissolve run under the NOLOGIN reader role, granted SELECT on the session's temp views only (`portal-sql-reader-role.service.ts`); the SQL tools refuse (`PORTAL_SQL_UNAVAILABLE`) if the role is missing or over-privileged. Stored curated-view SQL filters (#644) go through the same AST gate on save and on every render, and run as the reader role on every read (agent session, records list, identity lookup, preview): the view is `security_invoker` over a server-built source view, and the reader holds column-level SELECT on that source only, so a fragment can't reach another relation even past the gate. Confirm `portal-sql.reader-role-ok` in the app-dev and prod API logs after deploy. Before #660 a member could read other orgs' physical tables through agent SQL; the read-only scan of pipelines stored before the gate (`apps/api/src/scripts/scan-pinned-pipelines.ts`, #665) ran against prod on 2026-10-26 and found no cross-org reads. |

**Sign-off (SaaS baseline):** reviewed by `<our security owner>` · Date `<date>` — the `confirm`/`in progress` items above are the open action list.
