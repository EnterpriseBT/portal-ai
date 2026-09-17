# Portability adapter seams — Condensed design (#567)

**Issue:** [EnterpriseBT/portal-ai#567](https://github.com/EnterpriseBT/portal-ai/issues/567) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The app is already ~95% cloud-agnostic — it reads plain env vars, and the process never calls AWS on its hot path. Three single-seam changes in `apps/api` close the remaining gap so the same image runs off-AWS and on-prem, which the Helm-packaged install (#566) and any non-AWS cluster need: (1) point object storage at an S3-compatible endpoint (MinIO/Ceph/R2), (2) point the Anthropic client at a proxy/gateway base URL, (3) drop a dead AWS dependency. All three are **additive and default-off** — unset leaves today's SaaS-on-AWS behavior byte-identical. Backend-only; no schema, no frontend, no new pattern.

**PRD gate.** The PRD dimensions (actors/roles, surfaces & placement, standard-vs-bespoke paths, lifecycle, states/edge) are **N/A** — this is an internal infra change with no user-facing surface; the deploying operator is the only actor and the ticket's deliverables + acceptance criteria are unambiguous.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Single `S3Client` | `apps/api/src/services/s3.service.ts:17–20` | constructed with `region` + `requestChecksumCalculation: "WHEN_REQUIRED"` (the MinIO-presign fix, already present). No `endpoint`/`forcePathStyle`. |
| Single Anthropic client | `apps/api/src/services/ai.service.ts:20–24` (`getAnthropic`) | lazily memoized (#579); `createAnthropic({ apiKey })`. `AnthropicProviderSettings.baseURL?: string` is supported by the pinned SDK. |
| Dead dep | `apps/api/package.json:48` (`@aws-sdk/client-ssm`) | no `src/` references; only a stale `dist/business-config.service.js` still imports it. Source was removed. |
| Env schema | `apps/api/src/environment.ts:55` (ANTHROPIC), `:204–211` (UPLOAD_S3_*) | plain `process.env` reads. |
| Env-parity guard | `apps/api/src/__tests__/env-example-parity.test.ts` | every `process.env.X` in `src/` must be declared in `.env.example`; `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are in `READ_BY_OTHERS` (asserted **not** read by our source). |

## Decision — credentials stay in the ambient AWS SDK chain

The ticket lists "(and explicit credentials when not on AWS)". Two ways to feed MinIO credentials:

- **A — read them in our code** (`credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, … }`). Rejected: it moves `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` out of `READ_BY_OTHERS` and **breaks the parity guard** (which asserts our source does *not* read them), and duplicates what the SDK already does.
- **B — rely on the AWS SDK default credential chain** (chosen). `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are already documented in `.env.example:172–173` and are resolved by the SDK first in the chain — so a MinIO deployment that sets them works with **no code reading them**, and setting them short-circuits the chain before it probes IMDS (no hang on a non-AWS box). Our code adds only `endpoint` + `forcePathStyle`.

**Decision: B.** Add only the two non-credential seams to the client; credentials flow through the existing env vars + SDK chain, keeping the parity invariant intact.

## Decision — extract pure config builders for testability

`s3Client` is a module-const and `getAnthropic` memoizes, so neither is directly assertable. Extract two small **exported pure functions** that build the config object from an env-shaped arg, and construct the clients from them. This lets a unit test assert "endpoint present iff `UPLOAD_S3_ENDPOINT` set" without mocking the SDK — no behavior change.

## Plan — one slice

**Files**
- Edit `apps/api/src/environment.ts` — add `UPLOAD_S3_ENDPOINT` (string, `|| ""`), `UPLOAD_S3_FORCE_PATH_STYLE` (`=== "true"`, default false) near `:204`; add `ANTHROPIC_BASE_URL` (string, `|| ""`) near `:55`.
- Edit `apps/api/src/services/s3.service.ts` — export `buildS3ClientConfig(env)` returning `{ region, requestChecksumCalculation, ...(endpoint ? { endpoint, forcePathStyle } : {}) }`; construct `s3Client` from it.
- Edit `apps/api/src/services/ai.service.ts` — export `buildAnthropicSettings(env)` returning `{ apiKey, ...(baseURL ? { baseURL } : {}) }`; `getAnthropic` uses it.
- Edit `apps/api/package.json` — remove `@aws-sdk/client-ssm`; refresh `package-lock.json`.
- Edit `apps/api/.env.example` — add commented `# UPLOAD_S3_ENDPOINT=` + `# UPLOAD_S3_FORCE_PATH_STYLE=false` under the S3 block (note MinIO/Ceph/R2 + path-style), and `# ANTHROPIC_BASE_URL=` under the Anthropic key (proxy/gateway seam).

**Tests** (npm scripts, never raw jest)
- New `apps/api/src/__tests__/services/s3.service.test.ts` — `buildS3ClientConfig`: unset endpoint ⇒ no `endpoint`/`forcePathStyle` keys (region-only); set endpoint + force-path-style ⇒ both present, values passed through.
- Edit `apps/api/src/__tests__/services/ai.service.test.ts` — `buildAnthropicSettings`: unset ⇒ no `baseURL` key (byte-identical to today); set ⇒ `baseURL` passed through, `apiKey` retained.
- Env-parity: the three new reads are declared (commented) in `.env.example`, so `env-example-parity.test.ts` stays green.
- `npm run test:unit`, `npm run type-check`, `npm run lint`, `npm run build` (all from `apps/api` / workspace scripts).

## Smoke (manual, against your dev stack)
1. **Baseline unchanged (defaults).** With `UPLOAD_S3_ENDPOINT`/`ANTHROPIC_BASE_URL` unset, run the existing file-upload flow (presign → PUT → parse) against your normal S3, and run one agent turn → both work exactly as before.
2. **MinIO object storage.** Run a local MinIO (`docker run … minio`), set `UPLOAD_S3_ENDPOINT=http://localhost:9000`, `UPLOAD_S3_FORCE_PATH_STYLE=true`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` to the MinIO root creds, `UPLOAD_S3_BUCKET` to a created bucket → upload a CSV end-to-end (presign → PUT → parse) and confirm the object lands in MinIO and the parse succeeds.
3. **Anthropic base URL.** Set `ANTHROPIC_BASE_URL` to a proxy/gateway (or a request-logging stand-in) → an agent turn routes through it; unset it → traffic returns to `api.anthropic.com`.
4. **Dead dep gone.** `npm run build` + `npm run type-check` green with `@aws-sdk/client-ssm` removed; `grep -r client-ssm apps/api/src` finds nothing.

## Out of scope
- Fully native GCS / Azure Blob providers (the browser presigned-PUT provider-awareness refactor) — S3-compatible/MinIO only here.
- IdP repoint / enterprise SSO — separate child (#577).
- The Helm chart itself (#566) and marketplace listing (#568) — this only supplies the seams they lean on.
