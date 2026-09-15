# onboarding-provisioning — Smoke Suite

Manual smoke test for [#583](https://github.com/EnterpriseBT/portal-ai/issues/583) — first-login provisioning is now a guaranteed invariant on the **live JWT request path** (self-heal in `getApplicationMetadata`), shared with the Auth0 webhook via `ApplicationService.ensureProvisioned`, backed by a `users.auth0_id` unique index + advisory lock. **Branch under test:** `feat/onboarding-provisioning` (PR [#601](https://github.com/EnterpriseBT/portal-ai/pull/601) → `epic/security-readiness`).

**Nature of this suite:** #583 is **API-only** (no `apps/web` diff), so there is **no browser surface** — `/smoke-walk` (Playwright) does not apply. Steps are `curl` against the running API + DB inspection (`db:studio` or `psql`), runnable against your dev stack. Steps that need a real second Google identity, a valid webhook signature, or an engineered Auth0-userinfo failure are tagged **— manual** (and note where the behavior is already proven by the green unit/integration suites).

## Preflight

### Environment

- [x] `git checkout feat/onboarding-provisioning && git pull --ff-only`
- [x] `npm install`
- [x] **Apply migration 0096** — `cd apps/api && npm run db:migrate` (adds `users_auth0_id_unique`; `npm run dev` seeds but does **not** migrate, so this is required or every authed request 500s).
- [x] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [x] You are logged into the web app as whatever local identity your DB carries (an e2e-reseeded stack has `admin@portalsai.io` / `qa@portalsai.io`, not `bbgrabbag@gmail.com`) with a provisioned org + owner membership (the normal state).
- [x] A **valid access token** for that session, exported as `$SMOKE_TOK` — copy the raw JWT from a DevTools request to `/api/…` (the `authorization` value **without** `Bearer `). A truncated paste makes `jwtCheck` return **400**, not 401 — grab it cleanly. **— manual** (token is a per-session secret; do not commit it).
- [x] `psql "$DATABASE_URL"` works from your shell. The walkthrough derives your user from the **token's `sub`** (no hardcoded email), so it targets whoever the token authenticates as.

### Reset between runs

- [x] §2 and §4 create **extra** orgs/memberships for your dev user. After the run, drop them:
  `delete from organization_users where user_id = '<your-user-id>' and organization_id <> '<your-original-org-id>';`
  then `delete from organizations where owner_user_id = '<your-user-id>' and id <> '<your-original-org-id>';`
  (or re-seed your org). §1/§3/§5 are read-only or use throwaway subs.

## §1 — Migration & unique index (AC: idempotency guard)

- [x] **Index exists, partial on the soft-delete guard.** `psql "$DATABASE_URL" -c "\d+ users"` (or `select indexdef from pg_indexes where indexname='users_auth0_id_unique';`).
  Expected: `CREATE UNIQUE INDEX users_auth0_id_unique ON public.users USING btree (auth0_id) WHERE (deleted IS NULL)`.
- [x] **It rejects a duplicate live `auth0_id`.** With `$SUB` = your dev user's `auth0_id`:
  `psql "$DATABASE_URL" -c "insert into users (id, auth0_id, created, created_by) values (gen_random_uuid(), '$SUB', 0, 'SMOKE');"`
  Expected: error `duplicate key value violates unique constraint "users_auth0_id_unique"`. (Nothing inserted.)

## §2 — Request-path self-heal (AC1, AC5)

- [x] **Happy path is unchanged and cheap.** Hit a **metadata-gated** route — `curl -s localhost:3001/api/stations -H "Authorization: Bearer $SMOKE_TOK"` → `200`. (Note: `/api/organization/current` is **not** metadata-gated — it does its own lookup and 404s on a miss — so it does *not* exercise the self-heal; use a route mounted behind `getApplicationMetadata`, e.g. `/api/stations`.) Happy path incurs no provisioning work (case 11).
- [x] **Self-heal re-provisions on a missing membership.** Simulate "the webhook never provisioned this user": delete your live membership(s) —
  `psql "$DATABASE_URL" -c "delete from organization_users where user_id = '<your-user-id>';"` —
  then hit `GET /api/stations` again. Expected: `200` (**not** 404 `METADATA_ORGANIZATION_NOT_FOUND`); a **new** org + **owner** membership now exist:
  `select o.id, ou.role from organizations o join organization_users ou on ou.organization_id = o.id where o.owner_user_id = '<your-user-id>';` → a row with `role = owner`. (The `smoke-manual.sh` helper does this and auto-restores your original memberships.)
- [x] **Audit rows were emitted for the self-heal.** `select action from audit_log where user_id = '<your-user-id>' order by created desc limit 5;` → includes `org.create` and `auth.login`.
- [x] **True brand-new user via the request path (no webhook).** With the Auth0 post-login Action disabled/not firing, sign in with a **fresh** Google account and hit any authed view. Expected: you land in the app with a provisioned org + owner role — no lockout. **— manual** (needs a second real Google identity; the request-path path is otherwise proven by the green `ensure-provisioned` + `metadata.middleware` suites).

## §3 — Webhook parity (AC3)

- [x] **Webhook provisions a brand-new user identically.** `POST /api/webhooks/auth0/sync` with a valid signature and a throwaway sub, e.g. body `{"user_id":"auth0|smoke-<rand>","email":"smoke@example.com","name":"Smoke","ip":"203.0.113.9","user_agent":"smoke"}`. Expected: `200 {"action":"created", ...}`; then in DB, one `users` row for that sub, one `organizations` owned by it, one `organization_users` with `role = owner`, and `audit_log` rows `org.create` + `auth.login{firstLogin:true}` for that user — **the same shape §2 produced.** **— manual** (requires a valid `verifyWebhookSignature` HMAC; parity is also asserted by `webhook.service.integration`).
- [x] **Webhook re-delivery is idempotent.** Re-POST the identical body. Expected: no second `users`/`organizations` row for that sub (action `updated`, one org). **— manual** (signature).

## §4 — Idempotency & concurrency (AC2)

- [x] **Re-login is a no-op.** Repeat the §2 happy-path `curl` twice. Expected: same `organization.id` both times; no new org row appears; no new `org.create` audit row.
- [x] **Concurrent first-logins converge on one org.** Fire two parallel requests for the same freshly-unprovisioned user:
  after deleting memberships (as in §2), `curl … /api/organization/current -H "Authorization: Bearer $TOKEN" & curl … & wait`. Expected: exactly **one** new org + membership created (not two) — the advisory lock + unique index serialize it. (Hard to force a true race by hand; definitively proven by `ensure-provisioned` case 7 and the `sync-lock` provisioning-lock tests.)

## §5 — Error & edge: fail-closed (AC4)

- [x] **Auth0 profile-fetch failure leaves no partial user.** On the miss branch, if the Auth0 `/userinfo` fetch fails, the request returns **500 `METADATA_FETCH_FAILED`** and **no** `users` row is created for that sub. **— manual / test-covered:** engineering a valid JWT whose userinfo fetch fails is impractical by hand; asserted by `metadata.middleware.test` case 12 (fetch throws → 500, `req.application` never set) and by `ensureProvisioned` resolving the profile *before* any insert. Spot-check: after any failed first-login attempt, `select count(*) from users where auth0_id = '<that sub>';` → `0`.
- [x] **Static checks clean.** `cd apps/api && npm run type-check && npm run lint` → both pass (AC5).

## Sign-off

- [x] Every section above verified (or its manual/test-covered note accepted)
- [x] 2026-09-15 — Ben Turner — confirmed against my own running stack (§2/§4 walked manually as `admin@portalsai.io`; §1/§3/§5 agent-run via curl+psql; §5 fail-closed + concurrency accepted as test-covered)

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (user id / org id / auth0 sub / audit action):
