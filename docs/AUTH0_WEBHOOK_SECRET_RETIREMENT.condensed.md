# Retire AUTH0_WEBHOOK_SECRET and the post-login Action — Condensed design (#873)

**Issue:** [EnterpriseBT/portal-ai#873](https://github.com/EnterpriseBT/portal-ai/issues/873) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #577 removed `POST /api/webhooks/auth0/sync`, and the API no longer reads `AUTH0_WEBHOOK_SECRET`. The deployment still wires the secret in, though: `backend.yml` takes its ARN, grants the execution role access to it, and injects it into the container. That means it can't be deleted first, because ECS won't start a task whose secret is missing. The runbooks still tell operators to create the post-login Action, and prod's leftover Action looped every login after v1.1.0 until it was removed on 2026-10-25. This change touches `infra/`, `.github/`, `packages/devops-cli`, the Helm chart's docs, `apps/api` (a test setup line, comments, README) and durable docs.

## Current shape

| Piece | Location | Note |
|---|---|---|
| ARN parameter | `infra/cloudformation/backend.yml:80-82` | `SecretArnAuth0WebhookSecret` |
| Execution-role grant | `backend.yml:331` | `secretsmanager:GetSecretValue` resource |
| Container secret | `backend.yml:646-647` | `AUTH0_WEBHOOK_SECRET` `ValueFrom` |
| Deploy inputs | `deploy-dev.yml:253`, `deploy-prod.yml:248` | `*_SECRET_ARN_AUTH0_WEBHOOK_SECRET` |
| Catalog | `packages/devops-cli/src/catalog.ts:47`, `__tests__/catalog.test.ts:15` | `deploy-parity.test.ts` holds catalog ⊇ task-def secrets |
| Test env | `apps/api/src/__tests__/setup.ts:16` | sets a value nothing reads |
| Provisioning runbook | `docs/PROD_PROVISIONING.runbook.md` §1 (54, 60), §2 (84-115), §11 (334), verify (360), key table (375) | generates the secret, creates the Action |
| Teardown runbook | `docs/ENTERPRISE_SSO.runbook.md:14-21` | step 3 deletes the secret with no template step |
| Other prose | `apps/api/README.md` (399, 449, 952-966), root `README.md:157`, `DB_RESET.md:74`, `DEMO_ORG.runbook.md:44`, `AUTH0_CLI_OPS.md:112`, Helm `values.yaml:81` + `README.md:65`, comments `create-org.ts:4`, `application.service.ts:140` | describe the webhook as live |

## Decision — remove it from the template first, delete it after the deploy

1. **In code (this PR):** remove the parameter and the container secret from `backend.yml`. The execution-role grant stays one release longer, by name, because the deployment circuit breaker can roll the service back to the previous task definition mid-update, and that one still injects the secret (code review). It goes once the secret is deleted on both envs. In the same commit, stop both workflows from passing the ARN. `aws cloudformation deploy` would silently drop the override, so this is cleanup rather than a deploy fix, and it leaves the repo secrets with no reader. Drop the catalog entry and its test line. The parity test still holds, since both sides lose it together.
2. **After the deploy, on each env (#854 lines):** `aws secretsmanager delete-secret --secret-id portalai/<env>/auth0-webhook-secret --recovery-window-in-days 7`, and delete the `DEV_`/`PROD_SECRET_ARN_AUTH0_WEBHOOK_SECRET` repo secrets only after that window has passed. The window is the rollback: a pre-#873 release needs both the secret (`aws secretsmanager restore-secret`) and the repo secret its workflow passes. `portalops` has no delete verb and doesn't get one for a single use.
3. **Docs:** PROD_PROVISIONING §2 replaces the Action step with a ⚠️ step: create **no** post-login Action that calls the API, because provisioning happens on the first authenticated request and an Action calling a missing route loops every login. §1, §11, verify and the key table drop the secret (§11 goes from twelve ARNs to eleven). ENTERPRISE_SSO step 3 adds the template-first ordering. The API README's troubleshooting entry becomes "login loops back to sign-in → a stale post-login Action", with the 401/404 log signature we saw. Its 28P01 subsection stays as its own entry.

## Plan — 1 slice

**Files:** `infra/cloudformation/backend.yml`, `.github/workflows/deploy-{dev,prod}.yml`, `packages/devops-cli/src/catalog.ts` + `__tests__/catalog.test.ts`, `apps/api/src/__tests__/setup.ts`, the comments and docs in the table above.

**Tests:**
- `cd packages/devops-cli && npm run test:unit` (catalog + deploy-parity; parity asserts no workflow or template names `SecretArnAuth0WebhookSecret`);
- `cd apps/api && npm run test:unit -- --testPathPattern environment`;
- `aws cloudformation validate-template` on `backend.yml`;
- root `lint:doc-pointers`.

## Smoke (manual, against the deployed envs)

1. After merge, Deploy Dev is green. `aws ecs describe-task-definition --task-definition portalai-api-dev` lists no `AUTH0_WEBHOOK_SECRET` among the secrets, the service runs 1/1, and login at `app-dev.portalsai.io` works.
2. Delete the app-dev secret (Decision step 2). `aws ecs update-service --cluster portalai-dev --service portalai-api-dev --force-new-deployment` brings a new task up healthy, and login still works.
3. After the prod release: the same task-def check on `portalai-api-prod`, login works, then delete the prod secret (Decision step 2) and force a new deployment. Both tasks come up and `/api/health/ready` returns 200.

## Out of scope

- Any post-login Action (provisioning stays on the request path).
- The Redis cleanup (#872), which ships in the same release.
