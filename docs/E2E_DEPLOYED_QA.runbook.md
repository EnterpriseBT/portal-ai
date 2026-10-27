# Deployed QA identities runbook — app-dev and prod

How to set up, verify and maintain the QA identities that browser verification uses against deployed environments (#489):

- **Post-deploy login check.** `verify-login`, the last job of `deploy-dev.yml` / `deploy-prod.yml`, signs in to the environment just deployed as its **QA owner**. If that fails the run goes red, with screenshots and video. Nothing rolls back.
- **Agent sessions.** The `playwright-app-dev` / `playwright-prod` MCP servers (`.mcp.json`) let an in-container Claude session walk the deployed app as the QA **owner, admin or member**.

Both sign in through the **QA sign-in** (`/login?qa=1` → "QA sign-in"), which a build renders only when it bakes `VITE_AUTH0_QA_CONNECTION`. Normal users never see it: `/login` still shows only the Google button.

The PR-time walk (`E2E Tests`, `e2e-test.yml`) uses the **local/dev** tenant instead; its setup is at the end.

> **This is a durable reference** (unsuffixed). It is maintained as the setup evolves, not swept like a phase doc.

## The isolation model

Every QA identity in an environment is a member of **exactly one org, the QA org**. That's the whole boundary, and it's server-enforced: every other org is unreadable to them, so it answers 404 (#692). The agent's conduct rules (`packages/e2e/README.md`) and the MCP server's `--allowed-origins` keep a walk on track, but neither is a boundary. `--allowed-origins` doesn't even cover redirects.

So the invariant (one membership, and it is the QA org) is checked on every post-deploy run (for the owner) and in this runbook (for all three). A fourth member in the QA org, or a second membership for any QA user, is an incident: see "Rotation and incidents".

## Per environment: scripted setup

`packages/e2e/scripts/setup-qa-auth0.sh` does the next two sections in one pass: the Auth0 connection and users, the Secrets Manager entries and the repo secret. It also reports the tenant's MFA settings. The passwords are generated and piped straight to `portalops`, so they're never printed or written to disk. Re-running is safe: it reuses the connection and leaves existing users and their stored values alone.

```bash
auth0 login --domain portalsai-staging.us.auth0.com \
  --scopes create:connections,read:connections,update:connections,read:clients,read:users,create:users,read:actions,read:guardian_factors,read:mfa_policies
aws login --remote && eval "$(aws configure export-credentials --format env)"
npm run build --workspace @portalai/devops-cli
npm run --workspace @portalai/e2e e2e:qa:setup -- app-dev
```

For prod, sign in with `--domain portalsai.us.auth0.com` and pass `prod`; the script adds `--confirm-prod` itself. If the tenant has more than one SPA app, it stops and asks for `--spa-client-id <id>`. It warns that each secret is new ("add its ARN to the deploy workflow"). That doesn't apply here: only the API's secrets go in `backend.yml`, and the deploy role reads `portalai/<env>/*`.

The manual steps below are what it does, for when the script can't be used.

## Per environment: Auth0 tenant

Tenants: **app-dev** is `portalsai-staging.us.auth0.com`, **prod** is `portalsai.us.auth0.com`. Do prod before the release that first carries `verify-login`, or that release's deploy goes red (the #873 lesson: vendor steps go on the release checklist, #854).

1. **Database connection.** Authentication → Database → Create, named e.g. `qa-users`.
   - **Disable Sign Ups** on it. This is what keeps the QA sign-in from being a way in for anyone else.
   - On its Applications tab, enable **only** the web SPA application.
2. **Three users** on that connection, with strong generated passwords:
   - `qa+<env>@portalsai.io` (owner),
   - `qa+<env>-admin@portalsai.io`,
   - `qa+<env>-member@portalsai.io`.
3. **MFA.** If the tenant enforces MFA through an Action, exempt the QA connection there by connection name (`event.connection.name === "qa-users"`). Never turn MFA off tenant-wide.
4. **Attack protection.** Check that brute-force protection is on (Security → Attack Protection).

## Per environment: secrets

1. **The QA credentials**, in that env's Secrets Manager (`portalai/<dev|prod>/qa-auth0-*`). Add `--confirm-prod` on prod.
   ```bash
   npm run build --workspace @portalai/devops-cli
   for k in QA_AUTH0_USERNAME QA_AUTH0_PASSWORD \
            QA_AUTH0_USERNAME_ADMIN QA_AUTH0_PASSWORD_ADMIN \
            QA_AUTH0_USERNAME_MEMBER QA_AUTH0_PASSWORD_MEMBER; do
     read -rsp "$k: " v; echo
     printf '%s' "$v" | npx portalops vars set "$k" - --env app-dev --yes
   done
   ```
   The API never reads them, so they aren't in `backend.yml`. The deploy role already reads `portalai/<env>/*`.
2. **The connection name**, as a repo secret the S3 web build bakes:
   ```bash
   printf '%s' 'qa-users' | gh secret set DEV_VITE_AUTH0_QA_CONNECTION --repo EnterpriseBT/portal-ai
   # prod: PROD_VITE_AUTH0_QA_CONNECTION
   ```
   The chart/ECS web image never sets it, so customer installs have no QA sign-in.
3. **Deploy** (a push to `main`, or a release for prod), so the web build carries the QA sign-in. The first such deploy's `verify-login` goes red reading `qa-org-id`, because the QA org doesn't exist yet. That's expected: provision the org (next section), set `QA_ORG_ID`, then re-run the failed `verify-login` job.

## Per environment: the QA org

Run these from the devcontainer with AWS credentials (`docs/LOCAL_DEVELOPMENT.md`), after the deploy above.

1. **The owner's first sign-in** provisions its org:
   ```bash
   npm run --workspace @portalai/e2e e2e:auth:app-dev     # or e2e:auth:prod
   ```
   This writes `packages/e2e/.auth/<env>/owner.storageState.json` (mode 0600), and makes it the env's active session.
2. **Name it and grant a tier.** Use a tier with no Stripe subscription and at least three seats. `set-tier` refuses an org with a live subscription.
   ```bash
   npx portalai login --env app-dev
   npx portalai user get qa+app-dev@portalsai.io --env app-dev --json   # note its org
   npx portalai org update <orgId> --name "QA (app-dev)" --env app-dev --yes
   npx portalai org set-tier <orgId> <tierSlug> --env app-dev --yes
   ```
3. **Record the org's id** as `QA_ORG_ID`. The login check requires each QA identity's one membership to be this org: counting alone would pass for a QA user who was removed and self-provisioned a new org on sign-in. Until it's set, `verify-login` fails reading it.
   ```bash
   printf '%s' '<orgId>' | npx portalops vars set QA_ORG_ID - --env app-dev --yes
   ```
4. **Invite the admin and the member.** Restart the MCP session, then in `playwright-app-dev` (signed in as the owner) go to Settings → Members → Invite member, once as `admin` and once as `member`. Copy each one-time link.
5. **Each role's first sign-in goes through its link.** Otherwise the first login provisions a personal org and breaks the invariant.
   ```bash
   npm run --workspace @portalai/e2e e2e:auth -- --env app-dev --identity admin  --invite '<admin link>'
   npm run --workspace @portalai/e2e e2e:auth -- --env app-dev --identity member --invite '<member link>'
   ```
   `--invite` accepts only an `/invitations/accept` link on that env's own app. If a role ever lands in a personal org, delete that org (`portalai org delete`, app-dev only) or file it for prod, then re-invite.
6. **Verify** that each identity has exactly one membership, the QA org (the check reads `qa-org-id`):
   ```bash
   for id in owner admin member; do
     E2E_TARGET=app-dev E2E_IDENTITY=$id \
       npm run --workspace @portalai/e2e test:e2e -- --project=login
   done
   npx portalai user list --env app-dev --org <orgId>   # exactly the three QA users
   ```

After that, later sign-ins need no link: `e2e:auth:<env>`, `e2e:auth:<env>:admin`, `e2e:auth:<env>:member`.

## Using a deployed session

- **Sign in or refresh** an identity: `e2e:auth:<env>[:admin|:member]`. Signing in the owner also makes it the active session.
- **Switch** identity: `npm run --workspace @portalai/e2e e2e:use -- member --env app-dev`, then restart the MCP session.
- **Walk** with `mcp__playwright-app-dev__*` / `mcp__playwright-prod__*`. Screenshots land in `packages/e2e/test-results/<env>/` (git-ignored).
- **Conduct**: `packages/e2e/README.md` → "Deployed environments".

## When `verify-login` goes red

The artifact `verify-login-<env>-<run id>` holds the screenshot and video, and nothing else. A trace, an HTML report or Playwright's `error-context.md` page snapshot would each carry the typed QA password, and this repo's artifacts are public. So none is recorded or uploaded. For more detail, reproduce locally with `E2E_TARGET=<env>` and `--project=login`.

| Symptom | Likely cause |
|---|---|
| Stuck on `/login`, no "QA sign-in" button | the build didn't bake the connection: `<ENV>_VITE_AUTH0_QA_CONNECTION` missing or empty |
| Auth0 says the connection is disabled or the user is wrong | the connection isn't enabled on the SPA app, or the password was rotated without `vars set` |
| Back on the app, then bounced to sign-in | a login loop on the API side, like #873's leftover post-login Action |
| `organization/current` not 200 | the API is unhealthy, or an `AUTH0_*` setting drifted |
| "memberships … toHaveLength(1)" | the QA owner gained a second org: an incident (below) |
| "the signed-in identity's only org is the QA org" | the QA owner lost its QA membership and sign-in provisioned a new org, or `QA_ORG_ID` is wrong: an incident (below) |

The deploy itself is already live when this runs. Rolling back is a human decision: re-run the previous successful deploy run.

## Rotation and incidents

- **Rotate** a QA password in Auth0, then `vars set` the new value. Rotation also revokes refresh tokens, so every captured `storageState` stops working; re-run `e2e:auth:<env>*`.
- **A leaked `storageState`** reaches only the QA org. Rotate that identity's password. If it was the owner's or admin's, also check the QA org's members and pending invitations: either role can invite.
- **An extra membership or member:** remove it (`portalai member remove`), find out how it happened, and rotate.
- **A QA identity outside the QA org** (the check names a different org): delete the org its sign-in provisioned (app-dev; file it for prod), re-invite it to the QA org through a fresh link, and find out how it lost its membership.

## Analytics

QA identities show up in product metrics as one small org with three users. Filter by the QA org's id when that skews a number. Nothing excludes them automatically.

## PR-time walk: local/dev tenant

`E2E Tests` boots its own stack and signs in through the QA sign-in against the **local/dev** tenant (`dev-ow7j1wh6zixlfcp1.us.auth0.com`). It reuses the `packages/e2e/.env` owner, admin and member users (`packages/e2e/README.md`) on its `Username-Password-Authentication` connection, which must stay enabled on the dev SPA app.

The repo needs:
- `E2E_CI_AUTH0_USERNAME` / `E2E_CI_AUTH0_PASSWORD`, plus the `_ADMIN` / `_MEMBER` pairs;
- `E2E_CI_VITE_AUTH0_DOMAIN`, `E2E_CI_VITE_AUTH0_CLIENT_ID`, `E2E_CI_VITE_AUTH0_AUDIENCE`, `E2E_CI_AUTH0_DOMAIN` and `E2E_CI_AUTH0_AUDIENCE`, the dev tenant's settings;
- the repo variable `E2E_QA_CONNECTION=Username-Password-Authentication`.

Without them, the workflow skips with a notice rather than failing. Rotating a dev-tenant e2e password means updating both `packages/e2e/.env` and the matching `E2E_CI_*` secret.
