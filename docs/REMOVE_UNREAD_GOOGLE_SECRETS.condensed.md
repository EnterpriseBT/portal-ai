# Remove the unread VITE_GOOGLE_* secrets — Condensed design (#915)

**Issue:** [EnterpriseBT/portal-ai#915](https://github.com/EnterpriseBT/portal-ai/issues/915) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Since #580 the web app reads the Google Picker config (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`) at runtime from `GET /api/connector-config`, sourced from SSM. Yet both deploy workflows still pass `VITE_GOOGLE_*` values into the web build, which nothing reads. Dead secrets invite someone to "fix" the picker by rotating the wrong value. This removes them from the workflows and the docs; deleting the six repository secrets follows once a deploy has run without them. Only workflows and docs change; no app code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Dev web build env | `.github/workflows/deploy-dev.yml:336-338` | `VITE_GOOGLE_{PICKER_API_KEY,OAUTH_CLIENT_ID,CLOUD_PROJECT_NUMBER}` from `secrets.DEV_VITE_GOOGLE_*` |
| Prod web build env | `.github/workflows/deploy-prod.yml:317-319` | Same, from `secrets.PROD_VITE_GOOGLE_*` |
| Runtime source (keep) | `apps/api/src/environment.ts:138-140`, `packages/core/src/contracts/connector-config.contract.ts`, `apps/web/src/workflows/GoogleSheetsConnector/utils/google-picker.util.ts:291` | Comments here mention `VITE_GOOGLE_*` only as history; they stay |
| Browser egress guard | `apps/web/src/__tests__/subprocessor-browser-egress.guard.test.ts` | Classifies `VITE_*` vars the web *code* reads; it has no `VITE_GOOGLE_*` entry, since the code reads none |
| Docs naming the dead secrets | `README.md:173`, `docs/PROD_DEPLOY.runbook.md:36`, `docs/PROD_PROVISIONING.runbook.md:169`, `docs/DEPLOYMENT_SECURITY_REVIEW.md:43` | The first three say "still passed but no longer read"; the security review's Google Picker row still names `VITE_GOOGLE_*` as the control |

## Decision — remove in code now, delete the secrets after one clean deploy

Remove the six `env` lines from both workflows, and correct the four docs to name the real runtime keys. The repository secrets are deleted **after** the first `deploy-dev` that runs without them has succeeded and the picker still opens on app-dev. Deleting first would turn a mistaken assumption into a failed build; deleting after costs nothing. Prod's secrets go once the next prod release has run clean. Secret deletion is an operator action (`gh secret delete`), not a code change, so it sits outside the PR.

## Plan — 1 slice

- **Files:**
  - `.github/workflows/deploy-dev.yml` and `deploy-prod.yml`: drop the three `VITE_GOOGLE_*` env lines from each web build step.
  - `README.md`, `docs/PROD_DEPLOY.runbook.md`, `docs/PROD_PROVISIONING.runbook.md`: drop the "still passed but no longer read" notes.
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1: the Google Picker row's control becomes `GOOGLE_PICKER_API_KEY` / `GOOGLE_CLOUD_PROJECT_NUMBER`, served by `/api/connector-config`.
- **Tests:**
  - `grep -rn VITE_GOOGLE .github` is empty.
  - `npm run lint:ci-cache` and `npm run lint:doc-pointers` pass.
  - `npm run build` (the web build itself never read the vars) and the web `subprocessor-browser-egress.guard` test pass.

## Smoke (manual, against your dev stack)

1. `grep -rn VITE_GOOGLE .github` returns nothing.
2. Local: in the app, Connectors → Catalog → Google Sheets → start the flow. The picker step loads its config from `/api/connector-config` (network panel: `200` with `google.pickerApiKey` present when the local API has the key set). No build-time value is involved.
3. After merge: the `deploy-dev` run's frontend build succeeds. On app-dev, starting the Google Sheets flow shows the picker, not the "not configured" message.
4. Then delete the dev secrets: `gh secret delete DEV_VITE_GOOGLE_PICKER_API_KEY` (and `…_OAUTH_CLIENT_ID`, `…_CLOUD_PROJECT_NUMBER`) `--repo EnterpriseBT/portal-ai`. After the next prod release succeeds and the prod picker opens, do the same for the `PROD_` three.

## Out of scope

- Rewording the historical comments in `environment.ts`, `connector-config.contract.ts`, `google-picker.util.ts`, `catalog.ts` and `apps/api/.env.example`. They describe #580's move accurately.
- Any change to how the picker config is served.
