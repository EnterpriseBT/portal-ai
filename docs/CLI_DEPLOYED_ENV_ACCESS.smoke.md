# CLI deployed-environment access — Manual smoke checklist (#194)

Walk these against your own environments (they exercise the live paths CI can't: your AWS account, the app-dev bastion, the Auth0 tenant, a real browser). Prereqs: `aws sso login` done; AWS CLI v2 + session-manager-plugin installed; the per-env provisioning from `packages/cli-env/README.md` completed (Auth0 CLI app + `auth0-cli-client-id`).

Run snippets from the repo root with `npx tsx`, e.g.:

```ts
// smoke.ts — adjust per step
import { resolveEnvConnection, login, getToken } from "@portalai/cli-env";
```

## 1 — Local: zero-setup path

- [ ] With only `apps/api/.env` present (no AWS creds needed): `resolveEnvConnection("local").db()` returns the `.env` `DATABASE_URL` instantly; `psql` connects with it.
- [ ] Unset `DATABASE_URL` → `db()` throws `ENV_NOT_CONFIGURED` (typed, names the missing var).

## 2 — app-dev: IAM path + live tunnel

- [ ] `resolveEnvConnection("app-dev")` returns instantly (no I/O before `db()`).
- [ ] `await conn.db()` opens the SSM tunnel (watch for the session in the AWS console) and returns a `localhost:15432` connection string; `psql "<connectionString>" -c 'select 1'` works.
- [ ] Second `conn.db()` does **not** open a second session.
- [ ] `await conn.dispose()` → `ps aux | grep session-manager-plugin` shows **no orphaned plugin**; the SSM session closes in the console.
- [ ] Kill the CLI process mid-session (Ctrl+C a script holding a tunnel) → no orphaned plugin remains (the exit hook).
- [ ] With expired AWS SSO (`aws sso logout`): `db()` throws `ENV_NOT_AUTHORIZED` (not a raw SDK error).

## 3 — app-dev: device-flow login + session

- [ ] `login("app-dev", { onUserCode: (uri, code) => console.log(uri, code) })` prints the activation URL; confirming in the browser completes the call.
- [ ] `~/.portalai/credentials.json` exists with mode `0600` and an `app-dev` entry.
- [ ] `getToken("app-dev")` returns silently (no browser). Decode the JWT: `iss` is the env's tenant, `aud` the env's audience, `sub` is **you**.
- [ ] Call a protected endpoint with it: `curl -H "Authorization: Bearer <token>" https://api-dev.portalsai.io/api/organization/current` → 200.
- [ ] Edit the cache entry's `expiresAt` to the past → `getToken` transparently refreshes (new token, file rewritten, still 0600).
- [ ] `logout("app-dev")` clears the entry; `getToken` now throws `ENV_NOT_AUTHORIZED` pointing at login.

## 4 — Guards & audit

- [ ] `assertOperationAllowed(app-dev, { destructive: true, confirmed: false, … })` throws `ENV_CONFIRMATION_REQUIRED`; with `confirmed: true` it passes (staging).
- [ ] Against a `kind: "production"` definition, a destructive op throws `ENV_DESTRUCTIVE_BLOCKED` even with every flag set.
- [ ] `recordAudit(...)` appends a timestamped JSONL line to `~/.portalai/audit.log`.

## 5 — Override registry

- [ ] Add a `~/.portalai/environments.json` entry claiming `"kind": "production"` → `loadEnvironments()` returns it as `development` (forced); an entry named `app-dev` throws.

Sign-off: all boxes checked against app-dev on ____________ by ____________.
