# Local dev uploads to s3mock — Condensed design (#974)

**Issue:** [EnterpriseBT/portal-ai#974](https://github.com/EnterpriseBT/portal-ai/issues/974) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Local uploads sign their S3 links with the `Admin` user's static keys, and `portalai-admin-require-mfa` denies those, so every local upload gets a 403. Local dev should store uploads in a local S3 stand-in, the way the e2e stack already does, with real S3 kept as an opt-in. Touches `docker-compose.yml`, `.devcontainer/devcontainer.json`, `apps/api/.env.example` and `docs/LOCAL_DEVELOPMENT.md`. No application code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| S3-compatible endpoint | `apps/api/src/services/s3.service.ts` `buildS3ClientConfig` | `UPLOAD_S3_ENDPOINT` + `UPLOAD_S3_FORCE_PATH_STYLE`; one client signs upload links and reads objects |
| Presigned PUT | `s3.service.ts` `createPresignedPutUrl`, from `file-upload-session.service.ts:232` | the browser PUTs to the signed URL; the host is part of the signature |
| `s3mock` | `docker-compose.yml` (`profiles: ["e2e"]`, `9090:9090`, bucket `portalai-uploads-e2e`) | no volume; accepts presigned PUTs, CORS for any origin |
| e2e stack | `packages/e2e/scripts/e2e-stack.sh` | in the devcontainer uses `http://s3mock:9090`; `down` stops `s3mock`; CI starts it with no `dev` service |
| Devcontainer | `.devcontainer/devcontainer.json` → compose service `dev` | publishes 3000–3002 and 7006–7007 to the host; the API and the agent's Playwright browser run inside it |
| Env template | `apps/api/.env.example` (AWS S3 block) | blank AWS keys and bucket; the endpoint lines are commented out |

Verified against `adobe/s3mock:4.7.0`: `COM_ADOBE_TESTING_S3MOCK_HTTP_PORT` moves the listener, and with `…_STORE_ROOT` on a named volume plus `…_STORE_RETAIN_FILES_ON_EXIT=true`, an object PUT before a restart is served after it ("Loading existing bucket"). It ignores signatures, so any placeholder keys sign.

## Decision — one address for the API, the in-container browser and the host browser

A presigned URL names one host, and three clients must reach it: the API (in `dev`), the agent's Playwright browser (in `dev`) and your browser on the host.

- **A. A separate public signing endpoint** (new `UPLOAD_S3_PUBLIC_ENDPOINT`; sign for `localhost:9090`, read over `s3mock:9090`). Needs code and a new env var, and `localhost:9090` inside `dev` isn't s3mock, so agent walks still can't upload.
- **B. s3mock shares the devcontainer's network** (`network_mode: service:dev`), and `dev` publishes its port. `http://localhost:9092` is then the same s3mock for all three: inside `dev` it's local, and on the host it's the published port. No code, no new variable.
- **C. A TCP forwarder inside `dev`** (`localhost` → `s3mock`). Works, but adds a process to start and keep alive.

**Chosen: B**, as a **separate `s3mock-dev` service** rather than reusing the e2e one. The e2e `s3mock` must keep working on CI, where there is no `dev` service, and `e2e:stack:down` stops it. Separate, the two never interfere.
- `s3mock-dev`: `adobe/s3mock:4.7.0`, no profile (it starts with the devcontainer), `network_mode: service:dev`, HTTP port **9092** (9090 is the e2e one's host port), initial bucket `portalai-uploads-local`, and store root `/data` on a new `s3mock-data` volume with retain-on-exit.
- `dev` publishes `9092:9092`; `devcontainer.json` adds 9092 to `forwardPorts` with a label.
- `.env.example`: `UPLOAD_S3_ENDPOINT=http://localhost:9092`, `UPLOAD_S3_FORCE_PATH_STYLE=true`, `UPLOAD_S3_BUCKET=portalai-uploads-local`, placeholder keys `AWS_ACCESS_KEY_ID=local` / `AWS_SECRET_ACCESS_KEY=local`. The comment explains the real-S3 opt-in: endpoint and path-style unset, a real bucket, and working credentials (an `aws login` profile; the `Admin` user's static keys no longer work).
- `LOCAL_DEVELOPMENT.md`: the setup; switching an existing `.env`; the real-S3 opt-in; troubleshooting for "S3 PUT failed … 403" (still on the old keys) and a connection failure (s3mock-dev not running: `docker compose up -d s3mock-dev`, or rebuild).

## Plan — 1 slice

**Files:** edit `docker-compose.yml` (`s3mock-dev`, `dev` port, `s3mock-data` volume), `.devcontainer/devcontainer.json`, `apps/api/.env.example`, `docs/LOCAL_DEVELOPMENT.md`.

**Tests:** no application code changes. `npm run lint` (with `lint:doc-pointers`) and `npm run test:unit -w @portalai/api -- --testPathPattern 'env-example-parity|subprocessor-egress'`, since `.env.example` changes. `docker compose config --quiet` validates the file, and `docker compose --profile e2e config` confirms the e2e services still resolve. The Smoke below is the gate.

## Smoke (manual, against your dev stack)

1. Recreate the stack (`docker compose up -d s3mock-dev dev`, or Rebuild Container). `curl http://localhost:9092/` inside the devcontainer lists `portalai-uploads-local`. The same URL works from the host.
2. With `.env` switched as documented (no AWS credentials), restart the API. A CSV upload from your **host browser** reaches Draw regions and commits.
3. The same upload from the agent's in-container Playwright browser works (`/smoke-walk`).
4. Rebuild the devcontainer, then re-open step 2's connector. Its upload's file is still served (the API reads it; nothing 404s).
5. `npm run e2e:stack:up` then `e2e:stack:down`. Both succeed, and a local upload afterwards still works.
6. Stop `s3mock-dev` and upload. The dialog shows the S3 PUT failure. Then `docker compose up -d s3mock-dev` brings uploads back.
7. Real-S3 opt-in (`— manual`, needs an MFA-backed `aws login`): unset the endpoint, set a real bucket and profile; the upload lands in AWS.

## Out of scope

- Deployed environments and residency installs (helm already handles its object store).
- Removing or rotating the `Admin` user's static keys (do it regardless; outside this repo).
- Copying objects from the AWS dev bucket; local rows that point at them can be re-uploaded.
- Running the dev stack outside the devcontainer.
