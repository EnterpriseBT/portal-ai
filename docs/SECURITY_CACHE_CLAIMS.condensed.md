# Widen /security/ encryption claims to the cache — Condensed design (#858)

**Issue:** [EnterpriseBT/portal-ai#858](https://github.com/EnterpriseBT/portal-ai/issues/858) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #613 kept the cache out of the public encryption claims until it was encrypted everywhere (its Decision 5: claim only what holds in every environment). #852 shipped the encrypted ElastiCache group. app-dev switched on 2026-10-23, and prod switched on 2026-10-24 with v1.1.0. Both `cache status` reports now show `endpointSource: encrypted`, with the TLS group encrypted at rest and in transit, mode `required`. The claim is now true, so it widens. Touches `apps/site` and one durable doc.

## Current shape

| Piece | Location | Note |
|---|---|---|
| In-transit claim | `apps/site/src/lib/security-controls.ts` `encryption-in-transit` | edge only (CloudFront, ALB, HSTS) |
| At-rest claim | same file, `encryption-at-rest` | "database, file storage and logs" |
| Forbidden phrases | same file, `FORBIDDEN_CLAIMS` | includes `Redis` |
| Privacy Security sentence | `apps/site/src/pages/privacy.astro:87` | "database, file storage, and logs" |
| Claim guards | `apps/site/src/lib/__tests__/security-controls.test.ts` | evidence paths, forbidden phrases, privacy pins |
| SaaS baseline | `docs/DEPLOYMENT_SECURITY_REVIEW.md` §4 Encryption at rest | RDS + S3 + app-level only |
| The settings | `infra/cloudformation/cache.yml:158-160`, `infra/cloudformation/backend.yml:620` | `AtRestEncryptionEnabled`, `TransitEncryptionEnabled`, `TransitEncryptionMode: required`; `rediss://` URL |

## Decision — name "the cache", with evidence that survives cleanup

The claims say "cache" rather than "Redis": the page describes what a customer's data passes through, not our vendor, and the other stores are named the same way. The in-transit claim adds one sentence, saying the API reaches its cache over TLS and the cache refuses unencrypted connections. Mode `required` is what makes the second half true.

Evidence cites only the encrypted group's settings and the `rediss://` URL. The cleanup release removes the legacy group and the phase parameters, but not these, so nothing has to change when it lands.

`Redis` stays in `FORBIDDEN_CLAIMS`, though the issue asked to remove it (code review on #871). The copy says "cache", and keeping the vendor name forbidden still blocks claims the settings can't back, such as customer-managed keys. The privacy test that blocked "encryption in transit and at rest" stays: naming the stores is still better than a blanket claim. Its #852 rationale goes. A new pin requires privacy's at-rest list to match `/security/`'s, so the two pages can't drift apart.

The prod legacy group (`portalai-prod`, plaintext) still exists until the cleanup release, but nothing reads or writes it: the API switched, and it held only finished-job queue entries. The claim describes the cache the Service uses.

## Plan — 1 slice

**Files:** `apps/site/src/lib/security-controls.ts`, `apps/site/src/lib/__tests__/security-controls.test.ts`, `apps/site/src/pages/privacy.astro`, `docs/DEPLOYMENT_SECURITY_REVIEW.md`.

**Tests:** `cd apps/site && npm run test:unit`. The evidence-path cases now include the four cache settings; the new privacy-parity case passes.

## Smoke (manual, against the deployed sites)

1. After merge and Deploy Dev: `https://site-dev.portalsai.io/security/` shows "Our database, cache, file storage and logs are encrypted at rest." and the in-transit sentence about the cache over TLS.
2. `https://site-dev.portalsai.io/privacy/` Security section says "database, cache, file storage, and logs are encrypted at rest".
3. Prod: the same two checks on `www.portalsai.io` after the next prod site build, which is a release or the monthly run.

## Out of scope

- Any infra or client change (#852), and removing the prod legacy group (the cleanup release).
- Multi-AZ / DR claims (`multi-AZ` stays forbidden).
