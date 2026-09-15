# org-seats — Smoke Suite

Manual smoke test for [#584](https://github.com/EnterpriseBT/portal-ai/issues/584) — organization seats: app-generated invite-link + accept-on-login, full invitation lifecycle (pending → accepted, expiry, revoke, resend), per-org member list/remove/re-role, and a tier-capped seat count. **Branch under test:** `feat/org-seats` (PR [#602](https://github.com/EnterpriseBT/portal-ai/pull/602) → `epic/security-readiness`).

**Nature of this suite:** #584 is **API-only** (no `apps/web` diff), so there is **no browser surface** — `/smoke-walk` (Playwright) does not apply. Steps are `curl` against the API + DB inspection (`psql`), runnable against your dev stack. Steps that need a genuinely fresh Google identity, or a true concurrency race, are tagged **— manual** / **test-covered** (with the green suite that proves them).

## Preflight

### Environment

- [x] `git checkout feat/org-seats && git pull --ff-only`
- [x] `npm install`
- [x] **Apply migration 0097** — `cd apps/api && npm run db:migrate` (adds the `invitations` table + `tiers.max_seats`; `npm run dev` seeds but does **not** migrate, so this is required).
- [x] `npm run dev` boots cleanly (API :3001, web :3000).

### Fixtures

- [x] Export env for `psql` + the API: `cd apps/api && set -a; . <(grep -E '^DATABASE_URL=' .env); set +a; export LC_ALL=C`.
- [x] An **owner** access token exported as `$TOK` (raw JWT, no `Bearer`) for your logged-in dev identity — copy from DevTools → Network → any `/api/…` request. Confirm the caller + org:
  `curl -s localhost:3001/api/organization/current -H "Authorization: Bearer $TOK" | jq '{org: .payload.organization.id, role: .payload.role}'` → `role: "owner"`.
- [x] Note your user id + org id: `psql "$DATABASE_URL" -tAc "select ou.user_id, ou.organization_id from organization_users ou join users u on u.id=ou.user_id where u.auth0_id = (select auth0_id from users u2 join organization_users o2 on o2.user_id=u2.id limit 1);"` (or read them from `/current` + the owner membership).

### Reset between runs

- [x] The steps create invitations + (on accept) memberships/orgs. Clean up afterward: `psql "$DATABASE_URL" -c "delete from invitations where email like 'smoke+%';"` and remove any extra memberships/orgs the accept steps created (see §3). The seat-cap step mutates a tier — reset it: `psql "$DATABASE_URL" -c "update tiers set max_seats = null where slug = (select tier from organizations where id='<your-org-id>');"` (or your intended cap).

## §1 — Migration & schema (AC: seat cap backing)

- [x] **`invitations` table + indexes exist.** `psql "$DATABASE_URL" -c "\d+ invitations"` → columns incl. `token_hash`, `status`, `expires_at`, `role`; indexes `invitations_org_email_pending_unique` (partial `WHERE status='pending' AND deleted IS NULL`), `invitations_token_hash_unique`, `invitations_org_status_idx`.
- [x] **`tiers.max_seats` exists with the CHECK.** `psql "$DATABASE_URL" -c "\d+ tiers" | grep -i max_seats` → `max_seats integer`; and `insert`/`update` of `max_seats = 0` is rejected by `tiers_max_seats_nonneg`.

## §2 — Invite lifecycle (AC: invite/list/revoke/resend + audit)

- [x] **Invite returns an inviteUrl and stores only the hash.** `curl -s -X POST localhost:3001/api/organization/invitations -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"email":"smoke+a@example.com","role":"member"}' | jq '{status:.payload.status, url:.payload.inviteUrl, hash:.payload.tokenHash}'` → `status "pending"`, `url` contains `token=`, `hash` is **null/absent**. In DB: `psql "$DATABASE_URL" -c "select token_hash, status from invitations where email='smoke+a@example.com';"` → a hash present (not the plaintext token).
- [x] **List shows the pending invite.** `curl -s localhost:3001/api/organization/invitations -H "Authorization: Bearer $TOK" | jq '.payload.invitations | length'` → `>= 1`.
- [x] **Resend rotates the token.** `curl -s -X POST localhost:3001/api/organization/invitations/<id>/resend -H "Authorization: Bearer $TOK" | jq .payload.inviteUrl` → a **different** `token=` than the invite step; the old token no longer accepts (see §3).
- [x] **Revoke.** `curl -s -X POST localhost:3001/api/organization/invitations/<id>/revoke -H "Authorization: Bearer $TOK" | jq .payload.status` → `"revoked"`.
- [x] **Member cannot invite (authz).** With a **member**-role token (or temporarily set your membership role to `member` via psql, then reset), `POST /invitations` → `403` with code `INSUFFICIENT_ROLE`. **— manual** (needs a second identity or a role flip + reset).

## §3 — Accept flow (AC1: invited org only)

- [x] **Accept by token binds to the invited org.** Invite `smoke+b@example.com` (as in §2), grab the `token` from `inviteUrl`. As a **different** authenticated user (`$TOK2`, a second identity), `curl -s -X POST localhost:3001/api/organization/invitations/accept -H "Authorization: Bearer $TOK2" -H 'Content-Type: application/json' -d '{"token":"<token>"}' | jq '{org:.payload.organization.id, role:.payload.role}'` → the **inviter's** org id + `role: "member"`. In DB the invite row is `status='accepted'`, and the accepter has an `organization_users` row in that org. **— manual** (needs a second real identity/token).
- [x] **First-login invitee joins the invited org, not a personal org (AC1 core).** Invite a **brand-new** email; have that person sign in for the first time (verified Google email). They land in the **invited** org with the invited role — **no** personal org is provisioned. **✅ verified live 2026-09-15:** invited `benjamin.turner@claritysecurity.com` (brand-new), first Google login → exactly one membership in the inviter's org `1206fcce` (role `member`), **zero** owned orgs, invitation `accepted`, `member.invite.accept` audit row. (Locally the Auth0 webhook can't reach `localhost`, so this exercised the request-path self-heal.)
- [x] **Expired invite → 410.** Invite `smoke+exp@example.com`, then `psql "$DATABASE_URL" -c "update invitations set expires_at = 1 where email='smoke+exp@example.com';"`, then accept its token → `410 INVITATION_EXPIRED`.
- [x] **Unknown token → 404.** `POST /invitations/accept -d '{"token":"nope"}'` → `404 INVITATION_NOT_FOUND`.

## §4 — Seat cap (AC: server-side, counts members + pending)

- [x] **Cap counts members + pending; blocks over-invite.** Set your org's tier cap to `2`: `psql "$DATABASE_URL" -c "update tiers set max_seats = 2 where slug = (select tier from organizations where id='<your-org-id>');"`. With 1 owner member, one invite reserves the 2nd seat (`200`); a second distinct-email invite → `409 SEAT_LIMIT_EXCEEDED`.
- [x] **Revoke frees a seat.** Revoke the pending invite from the previous step, then invite again → `200`.
- [x] **`maxSeats = null` is unlimited.** Reset `max_seats = null`; multiple invites all `200`.
- [x] **Concurrent invites can't overshoot the cap.** **— test-covered:** two parallel invites racing the last seat yield exactly one success + one `SEAT_LIMIT_EXCEEDED` — proven by `seat.service.integration` ("concurrent invites racing the last seat: exactly one wins") under the per-org advisory lock; not reproducible by hand.

## §5 — Members (AC2: list / remove / last-owner guard)

- [x] **List members.** `curl -s localhost:3001/api/organization/members -H "Authorization: Bearer $TOK" | jq '.payload.members'` → includes you as `owner` with `email`/`name`/`joinedAt`.
- [x] **Remove a member.** After an accept (§3) added a member, `curl -s -o /dev/null -w "%{http_code}\n" -X DELETE localhost:3001/api/organization/members/<memberUserId> -H "Authorization: Bearer $TOK"` → `204`; the membership is soft-deleted (gone from `GET /members`).
- [x] **Last owner cannot be removed.** `DELETE /members/<your-own-userId>` (you are the sole owner) → `409 LAST_OWNER_REMOVAL`.

## §6 — Audit (AC: every mutation audited)

- [x] After the above, `psql "$DATABASE_URL" -c "select action, count(*) from audit_log where organization_id='<your-org-id>' and action like 'member.%' group by action;"` → rows for `member.invite`, `member.invite.revoke`, `member.invite.resend`, `member.invite.accept`, `member.remove` (as exercised).

## §7 — Static checks (AC: lint/type-check/suites)

- [x] `cd apps/api && npm run type-check && npm run lint` → both pass; `npm run test:unit` and `npm run test:integration` green (CI covers these; the integration suite needs `STRIPE_WEBHOOK_SECRET`/`STRIPE_SECRET_KEY` exported in this sandbox — see the memory note).

## Sign-off

- [x] Every section above verified (or its manual/test-covered note accepted)
- [x] 2026-09-15 — Ben Turner — confirmed against my own running stack. §1 agent-run (psql); §2/§4/§5/§6 + §3 (404/410) owner-token script run; §3 first-login-invitee **verified live** with benjamin.turner@claritysecurity.com; accept-by-token-as-different-user, member-cannot-invite (403), successful member remove (204), and concurrency accepted as **test-covered** (seat.service / ensure-provisioned / route suites, all green).

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org id / user id / invitation id / token / audit action):
