# Invite links use the env's web origin — Condensed design (#889)

**Issue:** [EnterpriseBT/portal-ai#889](https://github.com/EnterpriseBT/portal-ai/issues/889) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every invite link app-dev and prod hand out reads `http://localhost:3000/invitations/accept?token=…`, so no invitee can join through it. The API builds the link from `WEB_APP_URL`, which defaults to localhost and which `backend.yml` never sets. The fix sets it from the origin each deploy already passes, refuses to build a localhost link in production, and adds a CI guard so it can't go missing again. Touches `infra/cloudformation/backend.yml`, `apps/api` and the devops-cli parity test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Link builder | `apps/api/src/services/seat.service.ts:928` | `${environment.WEB_APP_URL}/invitations/accept?token=…`, used by invite (`:142`) and resend (`:342`) |
| Default | `apps/api/src/environment.ts:115` | `process.env.WEB_APP_URL \|\| "http://localhost:3000"`, the same shape as `PUBLIC_API_BASE_URL` (`:111`) |
| API task env | `infra/cloudformation/backend.yml:594` | sets `PUBLIC_API_BASE_URL` from the stack's subdomain (after #382's identical localhost bug), never `WEB_APP_URL` |
| Web origin per env | `backend.yml:26` `FrontendOrigin`; `deploy-dev.yml:248`, `deploy-prod.yml:242` | already `https://app-dev.portalsai.io` / `https://app.portalsai.io`; today used only for upload-bucket CORS (`:236`) |
| Deploy-surface guard | `packages/devops-cli/src/__tests__/deploy-parity.test.ts` | parses `backend.yml`; checks secrets and parameters, not plain env |
| Helm | `deploy/helm/portalai/values.yaml:78` `config`, README `:64` | the operator sets env in `config`; the examples name `PUBLIC_API_BASE_URL`, not `WEB_APP_URL` |
| Tests | `seat.service.integration.test.ts:120`, `organization.router.invitations.integration.test.ts:116` | assert only `toContain("token=")`, so the host is unchecked |

## Decision — where the origin comes from, and what stops a recurrence

- **Source.** Set `WEB_APP_URL: !Ref FrontendOrigin` on the API container. It's per env, already passed by both deploys, and it's the same origin the app is served from. Two alternatives were rejected:
  - deriving it from `CORS_ORIGIN` (an SSM list, possibly several origins) couples two settings;
  - a new SSM parameter is one more thing to set per env.
- **Fail closed at use.** In production, `SeatService.inviteUrl` refuses when `WEB_APP_URL` is unset or a loopback host. It throws `503 INVITATION_LINK_UNCONFIGURED` ("Invitation links aren't configured on this server"), and the invite or resend writes nothing. A dead link handed to a customer is worse than a visible error. This is checked where the link is built, not at boot, so a misconfigured Helm install still serves everything else.
- **Guard in CI.** `deploy-parity.test.ts` asserts that the API container's environment sets both `WEB_APP_URL` and `PUBLIC_API_BASE_URL`, the two URL settings with localhost defaults. It's the same class of bug as #382.

## Plan — 1 slice

**Files**
- Edit: `infra/cloudformation/backend.yml`: `WEB_APP_URL` from `FrontendOrigin`, with a comment citing #889 beside `PUBLIC_API_BASE_URL`'s. Correct `FrontendOrigin`'s description (it's no longer CORS-only).
- New: `apps/api/src/utils/invite-link.util.ts`: `inviteLinkBase()` (the production loopback refusal) and `inviteUrl(token)`. A pure util, so it's unit-testable without the database.
- Edit: `apps/api/src/services/seat.service.ts`: invite and resend call `inviteLinkBase()` before writing; revoke doesn't (it builds no link).
- Edit: `apps/api/src/constants/api-codes.constants.ts`: `INVITATION_LINK_UNCONFIGURED`.
- Edit: `deploy/helm/portalai/values.yaml` + `README.md`: name `WEB_APP_URL` among the `config` examples.
- Edit: `apps/api/.env.example:142`: note that deployed envs get it from the stack.

**Tests** (`npm run test:unit` / `npm run test:integration`, from each package)
- New: `apps/api/src/__tests__/utils/invite-link.util.test.ts`: production + unset or `localhost` / `127.0.0.1` → `INVITATION_LINK_UNCONFIGURED`; production + `https://app.example` → `https://app.example/invitations/accept?token=…`; development + localhost → allowed.
- Edit: `seat.service.integration.test.ts`: the link starts with `environment.WEB_APP_URL`, not just `token=`. Also: in production, a refused invite leaves no row, a refused resend leaves the token and expiry as they were, and revoke still works.
- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts`: the API container sets `WEB_APP_URL` and `PUBLIC_API_BASE_URL`, and `WEB_APP_URL` is `!Ref FrontendOrigin`.

## Smoke (manual, against your dev stack)

1. Locally (`npm run dev`), as an owner, go to Settings → Members → Invite member: the link starts with `http://localhost:3000/invitations/accept?token=` (development still allows localhost).
2. Restart the API with `NODE_ENV=production` and no `WEB_APP_URL`, then invite: the dialog shows the `FormAlert` "Invitation links aren't configured on this server" (`INVITATION_LINK_UNCONFIGURED`), and `invitations` has no new row.
3. Same with `WEB_APP_URL=https://app.example`: the link starts with `https://app.example/invitations/accept?token=`.
4. After merge, once Deploy Dev is green — backend: the `portalai-dev` task's environment lists `WEB_APP_URL=https://app-dev.portalsai.io`.
5. On app-dev, as the QA owner (`playwright-app-dev`), invite a probe email: the link starts with `https://app-dev.portalsai.io/`. Then revoke the invite.
6. Prod after the next release (manual): the `portalai-api-prod` task lists `WEB_APP_URL=https://app.portalsai.io`.

## Out of scope

- **Re-sending invites already issued with localhost links.** The token is valid on the right host, and the owner can Resend. A sweep would need per-org outreach, so it's tracked on #854's release note, not code.
- **A boot-time validation framework for every production env var.** That's a new cross-cutting pattern, and per-setting guards at use are enough here.
