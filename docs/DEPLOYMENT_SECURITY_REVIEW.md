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
| LLM (agent, and the curated-view SQL filter suggester) | `ANTHROPIC_BASE_URL` (`apps/api/src/environment.ts`) — empty = Anthropic direct; set = self-hosted/proxied model (#567). The filter suggester (#644, `apps/api/src/services/curated-view-filter-suggest.haiku.ts`) sends an entity's column keys and types, the top-level key names of its JSON columns (from up to 20 rows) and the author's description, never a record value; it is only reachable on a tier with `advancedViewFilters` | Anthropic | `on / self-host / drop` |
| Web search (`web_search`) | `TAVILY_API_KEY` + `apps/api/src/tools/web-search.tool.ts` — absent = tool unavailable | Tavily | `on / drop` |
| Geocoding (`geocode`, `reverse_geocode`, `bulk_geocode_records`) | `GEOCODING_API_KEY` + `apps/api/src/tools/*geocode*.tool.ts` (`apps/api/src/services/geocoding/mapbox.ts`) — absent = tools unavailable | Mapbox | `on / self-hosted geocoder / drop` |

> A residency install can withhold an entire toolpack (via tier entitlement) so the tool never appears, independent of the key.

## 2 — Subprocessor DPA

Any provider above that is **enabled** processes data on the deployment's behalf and must be documented as a subprocessor, with its data-handling posture on record.

| Subprocessor | Engaged when | Data-handling posture to record |
|---|---|---|
| **Anthropic** | LLM egress on (always, unless a self-hosted model via `ANTHROPIC_BASE_URL`) | No training on API data, retention per Anthropic's standard commercial API terms (there is **no** zero-data-retention agreement) — attach/cite the current DPA. |
| **Tavily** | `web_search` enabled | Query egress; cite Tavily's DPA/retention terms. |
| **Mapbox** | geocode tools enabled | Address/coordinate egress; cite Mapbox's DPA. |
| Hosting/infra | always | The client's own cloud (residency) — not our subprocessor. |

> **The hosted service's public list** is `SUBPROCESSORS` in `packages/core/src/content/subprocessors.util.ts`, rendered on the marketing site's `/security/` and privacy pages (#613). `apps/api/src/__tests__/subprocessor-egress-parity.test.ts` fails CI on any env var the API reads that isn't classified against it, and `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts` on any external host or `VITE_*` var the browser app uses, so it can't silently fall behind the code the way this section once did.

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
| Agent SQL boundary | Agent-authored SQL (`sql_query`, `display_entity_records`, `visualize_*`, analytics pushdowns, map tiles/dissolve, `transform_entity_records` fragments) is gated by **Postgres's own parser** (`libpg-query`): a single `SELECT` over only the caller's granted curated views (+ `_meta_*`), allowlisted functions, no schema-qualified names, no role/GUC changes (#660). Behind the gate, Postgres enforces it: agent SQL runs under the **restricted reader role** (`PORTAL_SQL_READER_ROLE`, migration `0118`), which can read only the session's temp views (#660 PR 2). Record that the API logged `portal-sql.reader-role-ok` at boot; with the role missing or over-privileged the SQL tools refuse (`PORTAL_SQL_UNAVAILABLE`) rather than run with the app user's privileges. |

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
| LLM | **On — Anthropic direct** (`ANTHROPIC_BASE_URL` unset in prod — `confirm` via `portalops vars get ANTHROPIC_BASE_URL --env prod`) | Core agent loop; the view-filter suggester (#644: column keys, types and JSON key names, no values) |
| Web search | **On — Tavily** (`TAVILY_API_KEY` set — `confirm`) | `web_search` toolpack shipped |
| Geocoding | **On** (`GEOCODING_API_KEY` set — `confirm`) | GIS toolpack shipped |

**§2 — Subprocessors:** the ten in `SUBPROCESSORS` (published at `/security/#subprocessors`): **AWS** (hosting — our own account), **Auth0** (identity), **Stripe** (billing), **Google** and **Microsoft** (only for sources a customer connects), **Anthropic** (LLM), **Tavily** (web search), **Mapbox** (geocoding), and two the viewer's **browser** reaches directly — **CARTO** (default map basemap tiles) and the **OpenStreetMap Foundation** (OSM basemap tiles), each receiving the viewer's IP and map viewport, no records. Anthropic: no training on API data, standard commercial API retention — **no** zero-data-retention agreement. `confirm current DPA on file` for each.

**§3 — Telemetry:** **None.** No third-party telemetry/analytics in the app (verified). App logs are Pino → CloudWatch within our account; no external analytics egress.

**§4 — Deployment checklist:**

| Control | SaaS baseline |
|---|---|
| Encryption at rest | **RDS `StorageEncrypted: true`** (`infra/cloudformation/database.yml`); **S3 `SSEAlgorithm: AES256`** on the upload/site/frontend buckets (`infra/cloudformation/{site,frontend,backend}.yml`); **ElastiCache `AtRestEncryptionEnabled: true`** on the encrypted replication group (`infra/cloudformation/cache.yml`, #852), which is also transit-encrypted with `TransitEncryptionMode: required` and reached over `rediss://` (`backend.yml`). `confirm` with `portalops cache status` that only the `-tls` group is listed (#872 removed the plaintext one from the templates); app-level `ENCRYPTION_KEY` encrypts `connector_instances.credentials` + toolpack auth headers (`docs/PROD_PROVISIONING.runbook.md`). |
| Identity provider | **Auth0** — prod tenant, audience `https://api.portalsai.io` (`apps/api/src/environment.ts`, `docs/PROD_PROVISIONING.runbook.md`). |
| Network egress | Server: the §2 subprocessors' endpoints (Anthropic, Tavily, Mapbox, Auth0, Stripe, Google, Microsoft) plus customer-hosted webhook toolpack endpoints; no telemetry egress. Browser: Auth0, Google's picker, and CARTO / OpenStreetMap basemap tiles (or a basemap URL a map spec names). VPC/security-group egress allow-list — `confirm` against the prod VPC. |
| Least-privilege | ECS `TaskRole` (app perms) + `TaskExecutionRole` (pull/secrets), separate roles (`infra/cloudformation/backend.yml`). Container runs **non-root** (`USER node`, `apps/api/Dockerfile`; Helm `runAsNonRoot`) — shipped by #571. |
| Data residency | Single region (our AWS) — `confirm` region. |
| Agent SQL boundary | **App-level AST gate on every agent SQL path** (#660 PR 1 — `apps/api/src/services/portal-sql-parse.util.ts`, `portal-sql-validation.util.ts`): caller's session views only, function allowlist, `DISCARD TEMP` per session, pinned map pipelines re-validated each run, transform fragments limited to the source row. **DB-level enforcement (#660 PR 2):** agent SQL, map tiles and dissolve run under the NOLOGIN reader role, granted SELECT on the session's temp views only (`portal-sql-reader-role.service.ts`); the SQL tools refuse (`PORTAL_SQL_UNAVAILABLE`) if the role is missing or over-privileged. Stored curated-view SQL filters (#644) go through the same AST gate on save and on every render, and run as the reader role on every read (agent session, records list, identity lookup, preview): the view is `security_invoker` over a server-built source view, and the reader holds column-level SELECT on that source only, so a fragment can't reach another relation even past the gate. Confirm `portal-sql.reader-role-ok` in the app-dev and prod API logs after deploy. Before #660 a member could read other orgs' physical tables through agent SQL; the post-deploy pin scan (discovery OQ5) is the open incident item. |

**Sign-off (SaaS baseline):** reviewed by `<our security owner>` · Date `<date>` — the `confirm`/`in progress` items above are the open action list.
