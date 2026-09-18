# Deployment security review — Condensed design (#582)

**Issue:** [EnterpriseBT/portal-ai#582](https://github.com/EnterpriseBT/portal-ai/issues/582) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic [#569](https://github.com/EnterpriseBT/portal-ai/issues/569).

**Why.** A residency install runs on the *client's* own infrastructure, so before one ships, three data-egress vectors and the deployment posture need an explicit, documented, signed-off decision with the client's security team. Today there is **no in-repo review-record artifact** for this — the SaaS security posture lives only in the external 🛡️ Security & Compliance artifact. This ticket ships the residency counterpart: a durable **review-record template** an operator completes per client engagement, **plus one filled SaaS baseline** for our own deployment (the "client" is us) so "SaaS is just another deployment" is concrete and we've run the same rigor on ourselves. It is docs only — no code. *(There is deliberately no separate SaaS review doc: the SaaS posture is the Security & Compliance artifact + epics #578/#397; the SaaS-specific customer subprocessor list/DPA is a separate commercial artifact, out of scope here.)*

## Current shape

| Piece | Location | Note |
|---|---|---|
| LLM egress | `apps/api/src/environment.ts:65` (`ANTHROPIC_BASE_URL`) | Empty → Anthropic direct; set → self-hosted/proxied model (#567). Anthropic is a subprocessor when direct. |
| Web-search egress | `apps/api/src/environment.ts:76` (`TAVILY_API_KEY`) + `apps/api/src/tools/web-search.tool.ts` | Absent key → `web_search` unavailable. Tavily is a subprocessor when enabled. |
| Geocoding egress | `apps/api/src/environment.ts:77` (`GEOCODING_API_KEY`) + `apps/api/src/tools/{geocode,reverse-geocode,bulk-geocode-records}.tool.ts` | Absent key → GIS geocode tools unavailable. |
| Tool availability gate | `packages/core/src/registries/builtin-toolpacks.ts` + tier entitlements (#214) | Egress tools are toolpack/tier-gated; a residency install can withhold a pack entirely. |
| Telemetry | — (none) | No third-party telemetry/analytics egress exists (`posthog`/`sentry`/etc. absent). "None by default" is the current truth, not an aspiration. |
| Deploy-mode + least-privilege | `apps/api/src/config/deploy-mode.ts`; `deploy/helm/portalai/values.yaml` (non-root `podSecurityContext`, #571) | Residency runs as `residency` mode; the chart's requests/security context is the least-privilege surface a client reviews. |
| Existing security docs | `docs/PROD_DEPLOY.runbook.md`, `docs/CUSTOM_TOOLPACK_INTEGRATION.md` | No dedicated security-review/subprocessor doc — this creates the first. |

## Decision — a durable per-client review-record template in `docs/`

The deliverable is `docs/DEPLOYMENT_SECURITY_REVIEW.md` — a **durable** (unsuffixed, maintained) template an operator copies and completes per client engagement, plus a **completed "SaaS baseline" record** appended for our own deployment (which doubles as the worked example, showing an operator how each field is filled), mirroring the runbook/charter convention. Options weighed: (a) a durable in-repo template — chosen; (b) an external-only doc like the Security & Compliance artifact — rejected, because the egress/subprocessor facts it records are code-derived (the env vars + tools above) and drift with the code, so it belongs where the drift is visible and `lint:doc-pointers` can gate its citations; (c) a `.condensed`/phase doc — rejected, it would be swept. The completed *records* (per signed engagement) live with the client engagement, not in the repo. The template's four sections map 1:1 to the ticket's scope: **egress decision** (Anthropic on / Tavily opt-in / geocoder opt-in-or-self-host / drop), **subprocessor DPA** (Anthropic no-training + zero-retention posture recorded; Tavily/geocoder if enabled), **telemetry policy** (none by default; pin exactly what the opt-in channel may carry if a client enables one), **deployment security checklist** (client KMS/encryption-at-rest, their IdP, network egress rules, the chart's least-privilege).

## Plan — 1 slice

- **Files.** New: `docs/DEPLOYMENT_SECURITY_REVIEW.md` — (a) the template: four fill-in sections + a per-engagement sign-off block + a one-line pointer to the external 🛡️ Security & Compliance artifact for the SaaS posture; (b) a completed **SaaS baseline** record filled for our own AWS deployment (Anthropic direct, Tavily + geocoder per the live env, telemetry none, our KMS/Auth0/network/least-privilege), doubling as the worked example. Edit: `docs/CLI_OPERATIONS_CHARTER.md` — a one-line pointer so a residency operator finds the template. Edit: `CLAUDE.md` "Detailed Documentation"/durable-docs mention if the durable set is enumerated there.
- **Tests.** None (docs-only). `npm run lint:doc-pointers` covers any `docs/*.md` citation added in source/comments; the template carries none by design.

## Smoke (manual, against the review process)

1. Open `docs/DEPLOYMENT_SECURITY_REVIEW.md`; confirm all four scope sections are present and each has a decision field + a place to record the resolution (scope / self-host via `ANTHROPIC_BASE_URL` / self-hosted geocoder / drop).
2. Confirm the subprocessor section names **Anthropic** (with the no-training / zero-retention posture line) and conditionally **Tavily** + the **geocoder**, keyed to whether `TAVILY_API_KEY` / `GEOCODING_API_KEY` are set.
3. Confirm the telemetry section states "none by default" and has a field to pin the opt-in channel's contents if a client enables it.
4. Confirm the checklist covers client KMS/encryption-at-rest, their IdP, network egress rules, and the chart's least-privilege.
5. Confirm the **SaaS baseline** record is filled for our own deployment and is internally accurate — each egress line matches whether the corresponding env var is set in prod, telemetry says none, and the checklist names our real KMS/IdP/network/least-privilege posture. It doubles as the worked example a residency operator copies.
6. Dry-run: copy the template for a hypothetical *residency* client (Anthropic direct, Tavily off, self-hosted geocoder) and confirm every decision has an unambiguous home. No code runs; this is a documentation review.
7. Confirm the template is reachable from a durable doc (the charter pointer resolves).

## Out of scope

- **Completing a review for a real *residency* client** — that is per-engagement, and the signed record lives with the engagement, not in the repo. (The **SaaS baseline** is the one filled record that *does* live in-repo, because the "client" is us.)
- **A separate SaaS review document, or the customer-facing subprocessor list / DPA** — the SaaS posture is the Security & Compliance artifact + #578/#397; the subprocessor list (where we are the processor) is a commercial/legal artifact for its own ticket.
- **The SaaS security posture itself** — owned by the 🛡️ Security & Compliance artifact and the Security & Enterprise Readiness epic (#578); this is the residency-deployment counterpart only.
- **Compliance automation / SOC 2 evidence collection** — #397 (least-privilege IAM) and #578 cover the control-side; this is a documented human review, not tooling.
- **Enforcing egress in code** — the env-var/toolpack gates already exist; this ticket documents the decision, it does not add new enforcement.
