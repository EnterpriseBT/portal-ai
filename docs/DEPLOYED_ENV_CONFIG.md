# Deployed-environment config surface — Condensed design (#382)

**Issue:** [EnterpriseBT/portal-ai#382](https://github.com/EnterpriseBT/portal-ai/issues/382) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Four config defects, one root cause: the API's environment surface is declared in five places that nothing keeps in step. Three are live bugs today (a `localhost` webhook callback in every deployed environment, OAuth callbacks that bake the env name into the subdomain, and a vendor secret missing from the CLI catalog); the fourth is that 26 of the 58 variables the API reads are undocumented, and two that *are* documented no longer exist. This lands on `main` ahead of epic #83 so the production standup inherits proven templates instead of debugging them live. Touches `infra/`, `packages/devops-cli/` and `apps/api/`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Runtime env object | `apps/api/src/environment.ts` | plain object literal, 53 keys — declares, never validates or documents |
| Direct `process.env` reads | 58 distinct keys under `apps/api/src` | 5 read outside `environment.ts` entirely |
| Developer inventory | `apps/api/.env.example` | 37 keys; **26 reads missing, 2 dead names** |
| Operator catalog | `packages/devops-cli/src/catalog.ts` | 23 keys — the Secrets Manager + SSM subset `portalops vars` manages |
| Deployed runtime | `infra/cloudformation/backend.yml` | 13 plain `Environment` + 20 `Secrets` entries |
| CI wiring | `.github/workflows/deploy-dev.yml:155-171` | passes each `SecretArn*` parameter from a `DEV_SECRET_ARN_*` repo secret |
| Parity-guard precedent | `packages/devops-cli/src/__tests__/tables-parity.test.ts` | a cross-repo, test-only import asserting a **subset** relation — the shape to copy |

`apps/web` is the counter-example: `vite-env.d.ts`, `apps/web/.env.example` and the `deploy-dev.yml` build block declare the same eight `VITE_*` keys with zero drift.

The four defects:

1. `PUBLIC_API_BASE_URL` (`environment.ts:65`) is set by **no** template or workflow, so `webhook.tool.ts:233,303` hands third-party toolpack runtimes `http://localhost:3001/api/webhook/handle/<id>`.
2. `backend.yml:502-505` builds both connector callbacks from `api-${Environment}` instead of the `Subdomain` + `DomainName` parameters that already drive the Route 53 record.
3. `GEOCODING_API_KEY` is in `backend.yml:62,524`, `deploy-dev.yml:164` and `.env.example:118` — but not in `catalog.ts`. It is the **only** `backend.yml` secret missing.
4. `ANTHROPIC_API_KEY` / `TAVILY_API_KEY` are undocumented; `.env.example:83,86` declare `UPLOAD_MAX_FILE_SIZE_MB` and `UPLOAD_MAX_FILES`, which nothing reads (the code reads `UPLOAD_MAX_FILE_SIZE_BYTES` / `UPLOAD_MAX_FILES_PER_SESSION`).

## Decision 1 — two guards, both one-directional

Equality between any two of these sets is wrong: `catalog.ts` legitimately holds four keys `backend.yml` never consumes (`SUPPORT_EMAIL` / `SALES_EMAIL` / `ADMIN_EMAIL` are build-time; `AUTH0_CLI_CLIENT_ID` is read only by `portalai login`), and `.env.example` legitimately holds keys our code never reads (`AWS_ACCESS_KEY_ID`, `NGROK_AUTHTOKEN` — read by the AWS SDK and ngrok themselves).

**Decision: subset assertions with an explicit allow-list**, following `tables-parity.test.ts`.

- **Deploy parity** (`packages/devops-cli`): every `Name:` under `backend.yml`'s `Secrets:` block is in `CATALOG`; and every `SecretArn*` parameter `backend.yml` declares is passed by `deploy-dev.yml`. Parse the YAML with the `yaml` package (already in the lockfile) as a devDependency — not a regex.
- **Developer parity** (`apps/api`): every `process.env.X` read under `apps/api/src` (excluding `__tests__` / `__integration__`) appears in `.env.example` as `X=` or `# X=`, **or** on an exported allow-list with a one-line reason.

The allow-list is what keeps the guard honest — an undocumented variable becomes a reviewed decision rather than an accident. It starts with `NODE_ENV` alone (set by the runtime and by `backend.yml`, never by a developer).

**The catalog's membership rule, stated so the next omission is obvious:** a variable belongs in `catalog.ts` **iff** it is an operator-settable per-environment value stored in Secrets Manager or SSM. Template-computed values (`REDIS_URL`, `UPLOAD_S3_*`, the redirect URIs) and local tunables are correctly absent. `GEOCODING_API_KEY` meets the rule and was simply missed.

## Decision 2 — `.env.example` tiers, not a flat append

Appending 26 lines would bury the two keys that actually stop the app from working. **Decision: four labelled sections**, each variable placed by what a developer must do about it.

| Tier | Shape | Members |
|---|---|---|
| **Required** | uncommented, placeholder value | `DATABASE_URL`, `ANTHROPIC_API_KEY`, Auth0, `ENCRYPTION_KEY`, … |
| **Capability keys** | present, empty — the feature degrades if unset | `TAVILY_API_KEY`, `GEOCODING_API_KEY`, `STRIPE_*`, `GITHUB_DISPATCH_TOKEN` |
| **Tunables** | commented, showing the real default | `FILE_UPLOAD_*`, `TOOLPACK_*`, `REQUEST_JSON_LIMIT_BYTES`, `PUBLIC_SITE_RATE_LIMIT_PER_MIN`, `SQL_QUERY_JOB_COST_THRESHOLD`, `INTERPRET_*_MODEL` |
| **Test / CI only** | commented, in a marked trailing section | `INTEGRATION_TEST_DATABASE_URL`, `RUN_SLOW_TESTS`, `MOCK_TOOLPACK_*` |

The two dead names are **renamed, not removed** — `UPLOAD_MAX_FILE_SIZE_MB` → `UPLOAD_MAX_FILE_SIZE_BYTES` and `UPLOAD_MAX_FILES` → `UPLOAD_MAX_FILES_PER_SESSION`, with the byte-valued default written out — because a developer copying the old line today gets silence, not an error.

## Plan — 3 slices

**Slice 1 — the template fixes (dev-affecting).**
- Edit `infra/cloudformation/backend.yml`: `PUBLIC_API_BASE_URL` added to the container `Environment` block as `!Sub "https://${Subdomain}.${DomainName}"`; the two callback URLs at `:502-505` rebuilt from the same parameters.
- Edit `apps/api/.env.example`: add `PUBLIC_API_BASE_URL` (it belongs to the capability tier — the local default is correct for local, but a developer running a webhook toolpack against a tunnel must know it exists).
- **No unit test** — CloudFormation has none. Verified by the app-dev deploy and by rendering: dev's values are byte-identical afterwards (`Subdomain` defaults to `api-dev`), so the callback change is a no-op in content.

**Slice 2 — the catalog entry and the deploy-parity guard.**
- Edit `packages/devops-cli/src/catalog.ts`: `secret("GEOCODING_API_KEY", "geocoding-api-key")` beside `TAVILY_API_KEY`.
- New `packages/devops-cli/src/__tests__/deploy-parity.test.ts`: the two subset assertions from Decision 1; add `yaml` to the package's devDependencies.
- Tests: `npm run test:unit -w @portalai/devops-cli`. **Write the test first** — it must fail on the missing `GEOCODING_API_KEY` before the catalog line lands.

**Slice 3 — the `.env.example` reconciliation, its guard, and the README.**
- Edit `apps/api/.env.example`: retiered per Decision 2; 26 additions, 2 renames.
- New `apps/api/src/__tests__/env-example-parity.test.ts`: the developer-parity assertion plus the allow-list.
- Edit `apps/api/README.md`: name `.env.example` as the authoritative inventory and explain the four tiers and the catalog membership rule.
- Tests: `npm run test:unit -w @portalai/api`, then `npm run lint`, `npm run format:check`, `npm run type-check` at the root.

## Smoke (manual, against your dev stack)

1. **Webhook callback (the live bug).** With the API running, register a custom webhook toolpack whose tool declares a `streaming` grant, invoke it, and inspect the payload handed to the runtime → `readUrl` / `writeUrl` point at your `PUBLIC_API_BASE_URL`, not `http://localhost:3001` when that variable is set. Unset it and confirm the local default still applies.
2. **Guards fail when they should.** Delete the `GEOCODING_API_KEY` line from `catalog.ts` → `npm run test:unit -w @portalai/devops-cli` goes red naming the key. Restore it. Add `process.env.NONSENSE_VAR` to any file under `apps/api/src` → `npm run test:unit -w @portalai/api` goes red. Remove it.
3. **`portalops` sees the key.** `npx portalops vars describe --env local` lists `GEOCODING_API_KEY`; `portalops vars template --env app-dev` includes it. (Rebuild `dist/` first — the CLI runs built output, not `src`.)
4. **Fresh-clone read-through.** Open `apps/api/.env.example` as if new to the repo: every variable needed to boot is in the Required tier, and nothing in it is a name the code no longer reads.
5. **Dev deploy is unchanged.** After merge, the app-dev deploy is green, and the ECS task's rendered `GOOGLE_OAUTH_REDIRECT_URI` / `MICROSOFT_OAUTH_REDIRECT_URI` are byte-identical to before.

## Out of scope

- **Validating the environment surface** (a Zod schema over `environment.ts`, fail-fast on a missing required key). A real improvement and a genuinely different change — this ticket makes the surface *discoverable*, not *enforced*. File separately if wanted.
- **Provisioning any prod value** — epic #83's children own that; this only fixes the templates and catalog they will consume.
- **Creating `DEV_SECRET_ARN_GITHUB_DISPATCH_TOKEN`** — the missing repo secret that leaves the site-rebuild dispatch loop unexercised. It is a GitHub-side provisioning act, tracked on #386, not a code change.
- **The `deploy-prod.yml` half of the deploy-parity guard** — the test asserts against whichever deploy workflows exist; #383 adds the prod one and the guard picks it up.
