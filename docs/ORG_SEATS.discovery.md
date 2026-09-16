# Organization seats: invitations + member management (backend) — Discovery

**Issue:** [EnterpriseBT/portal-ai#584](https://github.com/EnterpriseBT/portal-ai/issues/584)

**Why this exists.** A Portal org is single-user today: #576 gave memberships a *role* and #583 guarantees every logged-in user resolves to an org, but there is still **no way to add a second person to an org**. This ticket adds the seats backend — invite (owner/admin), a full invitation lifecycle (pending → accepted, with expiry / revoke / resend), member list / re-role (owner-only) / remove, all server-authorized (#576) and audited (#575), with a tier-capped seat count. Identity comes from an **app-generated invite link + accept-on-login** (no Auth0 Management API). This is the backend that turns a single-owner org into a multi-seat tenant; the Members/Team UI is #585.

## The current shape

### Membership & roles (#576)
| Piece | Location | Note |
|---|---|---|
| `organization_users` table | `apps/api/src/db/schema/organization-users.table.ts:17` | `organizationId`, `userId`, `role` (`text` enum `ORG_ROLES` + CHECK, default `member`), nullable `lastLogin` |
| Role model | `packages/core/src/models/organization-user.model.ts:17` | `ORG_ROLES`/`OrgRole`; role required |
| Repository | `apps/api/src/db/repositories/organization-users.repository.ts:17` | `findByOrganizationId`, `findByUserId`, `findByOrganizationAndUser`, `exists` + base CRUD |
| Current-org select | `apps/api/src/services/application.service.ts:31` | `getCurrentOrganization` orders live memberships `last_login DESC NULLS LAST` |
| Member list | `application.service.ts:64` | `listUserMemberships` (per-user; **no per-org member list yet**) |
| Role-change endpoint | `apps/api/src/routes/organization.router.ts:400` | `PATCH /members/:userId/role` — the closest template: `PermissionService.check` + owner-gates admin mint/remove (:451) + audits `member.role.change` |

### Onboarding / provisioning (#583, merged)
`ApplicationService.ensureProvisioned` (`application.service.ts:150`) runs under `withProvisioningLock(sub)`: find-or-create user, then **provision a personal owner-org only if `getCurrentOrganization` is null** (:186). Request-path self-heal is `getApplicationMetadata` (`apps/api/src/middleware/metadata.middleware.ts:49`), calling `ensureProvisioned` whenever `!user || !orgResult`. `findOrCreateByAuth0Id` (`users.repository.ts:46`, race-safe on the partial unique index) maps a `sub` to a user. **This is the load-bearing interaction for #584 — see Decision 2.**

### RBAC (#576)
`apps/api/src/services/permission.service.ts`: `check(ctx, action, object?)` throws `ApiError(403, denyCode)`; closed `PermissionAction` union (:30) — `billing.manage`, `org.delete`, `org.audit.read`, `member.role.assign`, `resource.read/write`; `OWNER_ONLY` set (:46); `PermissionContext {userId, organizationId, role}` (:14) is what the metadata middleware attaches.

### Tier / quota (#172)
`apps/api/src/db/schema/tiers.table.ts:25` — nullable charge grid where **`NULL` = unlimited** (`tiers_charges_nonneg` :117); model `packages/core/src/models/tier.model.ts` (`AllocationSchema` :23, `TierPolicySchema` :81). **No `maxSeats` exists yet.** Atomic quota template: `UsageService.tryCharge` (`usage.service.ts:62`) → `UsageRepository.chargeConditional` (`usage.repository.ts:57`) — seed `INSERT … ON CONFLICT DO NOTHING`, then guarded `UPDATE … WHERE used + n <= allocation RETURNING`, null on deny.

### Audit (#575)
`AuditService.record(event)` (`apps/api/src/services/audit.service.ts:45`) — fail-open, post-commit; `auditContextFromRequest(req)` used at router :319. `AUDIT_ACTIONS` (`packages/core/src/models/audit-log.model.ts:23`) **already has `member.add`, `member.remove`, `member.role.change`** — but no invite/accept/revoke. The DB `action` column is `text` with no CHECK, so extending the union is the only change.

### Dual-schema + conventions
New table = core Zod model + drizzle table (`baseColumns`) + `createSelectSchema`/`createInsertSchema` in `db/schema/zod.ts` + `IsAssignable` guards in `type-checks.ts` + export in `index.ts` + migration. Best mirror: the audit-log table (`0094_add-audit-log-table.sql`); **next migration is `0097`**. Routes mount under `/api/organization` (`protected.router.ts:45`, behind `jwtCheck`), use `getApplicationMetadata`, `ApiError`/`ApiCode`, `HttpService.success`, `@openapi` blocks, contracts registered in `swagger.config.ts`. **No email infrastructure exists** (no nodemailer/SES/etc.) — the invite link must be **returned to the caller**, not emailed.

## The design space

### Decision 1 — Invite mechanism (settled at ticket time)
App-generated **invite link + accept-on-login**: store a pending invitation with a token, return the link to the caller; the invitee authenticates via the existing Auth0/Google flow and acceptance binds their user to the invited org. No Auth0 Management API (no M2M creds, fully testable locally); a seam is left for Management-API provisioning later.

**Lean: link + accept-on-login.** Already chosen in the PRD gate; the rest of discovery designs *how accept binds*.

### Decision 2 — Where invite consumption happens (the self-heal race)
A brand-new invitee logs in via the link → Auth0 mints an identity → the SPA's **first metadata-gated request** hits `getApplicationMetadata` → `ensureProvisioned` sees no membership and **provisions a personal org** — violating #583's "an invited user joins the invited org only." A backend ticket cannot rely on the SPA calling `/accept` first, so the guarantee must live server-side.

- **A — Explicit accept endpoint only.** `POST /invitations/:token/accept` (behind `jwtCheck`, not `getApplicationMetadata`): `findOrCreateByAuth0Id` → consume invite → insert membership. Simple, token-secured, but races the self-heal for a first-login invitee who hits any other route first.
- **B — Self-heal integrated only.** Teach `ensureProvisioned` to, before personal-org creation, accept any pending invitation matching the user's **verified email**, binding to the invited org(s) instead. Robust regardless of route order, but couples provisioning to invitations and keys on email, not the token.
- **C — Both (token endpoint + email-aware self-heal).** Explicit `POST /accept` for the in-app / existing-user path (token-secured); *and* the self-heal, on a no-membership first login, consumes pending invitations for the verified email instead of provisioning a personal org.

| | A explicit-only | B self-heal-only | C both |
|---|---|---|---|
| First-login invitee never gets a stray personal org | ✗ (race) | ✓ | ✓ |
| Token is the capability | ✓ | ✗ (email) | ✓ (endpoint) + email fallback |
| Couples provisioning ↔ invitations | no | yes | yes |
| Existing user accepts in-app | ✓ | n/a | ✓ |

**Lean: C.** The explicit token endpoint is the primary, secure accept path; the self-heal email-match is the backend safety net that makes "invited user joins invited org only" hold no matter which route the invitee hits first. Email is trustworthy here — it's a Google-verified email and the invite was addressed to it. The membership insert makes `getCurrentOrganization` non-null, so `ensureProvisioned`'s existing no-membership gate (:186) then no-ops for free.

### Decision 3 — Seat cap: location + atomic enforcement
- **A — `maxSeats` on `tiers`** (nullable, `null` = unlimited), mirroring the allocation grid. Per-tier, no per-org override.
- **B — `maxSeats` on `organizations`** (per-org override). More flexible, but a second source of truth vs. the tier policy.

Enforcement mirrors `tryCharge`: an **atomic conditional** that admits an invite/accept only when `(live members + pending non-expired invites) < maxSeats`, with `maxSeats IS NULL` skipping the guard. The count **includes pending invites** (an invite reserves a seat, per the PRD).

**Lean: A (`maxSeats` on `tiers`), atomic conditional counting members + pending.** Keeps the tier the single entitlement source (like allocations); per-org override is a later, additive change. Enforce at **invite** time (reserve) and re-check at **accept** (the reservation already counted it, so accept mainly guards the expired/over-cap edge).

### Decision 4 — Invitation table shape & token handling
Fields: `id`, `organizationId` (FK), `email` (normalized lower-case), `role` (`OrgRole`), `tokenHash` (sha256 of the returned token), `status` (`pending|accepted|revoked|expired`), `expiresAt` (bigint ms), `invitedByUserId`, `acceptedByUserId?`, `acceptedAt?`, `baseColumns`. Partial unique index on `(organizationId, email) WHERE status='pending' AND deleted IS NULL` so one live pending invite per email per org (resend rotates it). Token: **store only the hash**, return the plaintext link once — the token is a bearer capability.

**Lean: hashed token, status enum, `expiresAt` timestamp, one-pending-per-(org,email).** Expiry is **lazy** — checked at accept and excluded from the seat count via `expiresAt > now` — no background job required (an optional `maintenance`-queue purge can reap old rows later, mirroring the retention processors).

### Decision 5 — Actor authorization
Add `member.invite` and `member.remove` to `PermissionAction` (owner + admin — *not* in `OWNER_ONLY`); role changes stay `member.role.assign` (owner-only, already enforced). Service-level guard: **the last owner can never be removed or demoted** (count live owners before the mutation).

**Lean: two new non-owner-only actions + a last-owner invariant in the service.** Matches #576's split (admins operate members; only owners touch the owner tier).

### Decision 6 — Audit actions
Extend `AUDIT_ACTIONS` with `member.invite`, `member.invite.accept`, `member.invite.revoke`, `member.invite.resend`; reuse existing `member.remove` (removal) and `member.role.change` (re-role). Accept also implies a membership add — emit `member.invite.accept` (carrying the org + role), not `member.add`, so the audit trail distinguishes invited joins from provisioning.

**Lean: add the four invite.* actions; reuse remove/role.change.**

## Tradeoff comparison

| | D2: both (C) | D3: tiers.maxSeats atomic | D4: hashed token + lazy expiry | D5: invite/remove non-owner-only |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New migration | no | yes (tiers col) | yes (invitations table) | no |
| Couples to #583 | yes (self-heal) | no | no | no |

## Recommendation

1. **Invite mechanism:** app-generated link + accept-on-login; the invite link (plaintext token) is returned in the invite response (no email infra).
2. **Consumption (D2-C):** a dedicated authenticated `POST /api/organization/invitations/:token/accept` (behind `jwtCheck`, not `getApplicationMetadata`) *and* an email-aware branch in `ensureProvisioned` that accepts pending invitations for the verified email before creating a personal org.
3. **Seat cap:** nullable `maxSeats` on `tiers` (null = unlimited); atomic conditional admitting invites only while `live members + pending non-expired invites < maxSeats`; enforced at invite, re-checked at accept.
4. **Invitations table:** dual-schema new table with hashed token, `status` enum, `expiresAt`, one live pending invite per `(org, email)`; lazy expiry.
5. **Authz:** new `member.invite` + `member.remove` actions (owner + admin); role changes owner-only; last-owner-removal/demotion blocked in the service.
6. **Audit:** add `member.invite[.accept|.revoke|.resend]`; reuse `member.remove` / `member.role.change`. All mutations post-commit fail-open audited.
7. **Endpoints (all under `/api/organization`):** `POST /invitations` (invite), `GET /invitations` (list pending), `POST /invitations/:token/accept`, `POST /invitations/:id/revoke`, `POST /invitations/:id/resend`, `GET /members` (per-org member list), `DELETE /members/:userId` (remove). Role change already exists (`PATCH /members/:userId/role`).

## Open questions

1. **Self-heal consumes how many invites?** A first-login email may have pending invites to several orgs. **Lean: accept all pending non-expired invites for the verified email** (user joins every org they were invited to); no personal org is created if ≥1 exists. Current org = the most recently invited (highest `expiresAt`/`created`).
2. **Email trust for the self-heal branch.** Only match on a **verified** email (Google emails are verified); if the Auth0 profile email is absent/unverified, fall back to personal-org provisioning (the explicit token endpoint still works). **Lean: require verified email for the self-heal match.**
3. **Expiry TTL default.** **Lean: 7 days, env-configurable (`INVITATION_TTL_DAYS`).**
4. **Remove = soft or hard delete of the membership?** **Lean: soft-delete** (base-repo default; keeps audit/history and matches org-delete tombstoning #197).
5. **Re-invite when a pending invite exists for (org, email).** **Lean: `resend` rotates the token + extends `expiresAt` on the existing pending row** (the partial unique index enforces one); a fresh `POST /invitations` for an already-pending email 409s with a pointer to resend.
6. **Inviting an already-accepted member.** **Lean: 409 `MEMBER_ALREADY_EXISTS`.**
7. **Accept when the caller is already a member of that org.** **Lean: idempotent no-op success** (consume the invite, don't duplicate the membership).

## Enterprise-scale considerations

- **Concurrency & correctness.** Two invites racing the last seat, or two accepts of one token, must not both win. **Lean:** atomic conditional seat admission (mirror `chargeConditional`) + `UPDATE invitations SET status='accepted' WHERE token_hash=? AND status='pending' AND expires_at > now RETURNING` (single-winner consume). No advisory lock needed — the guarded UPDATE is the gate.
- **Accuracy & auditability.** Every mutation (invite/accept/revoke/resend/remove/role-change) emits an audit row (#575); the invitations table is itself the durable record of who invited whom and when.
- **Failure modes.** Seat cap **fail-closed** (deny the invite if the tier/seat count can't be resolved — a wrongly-granted seat is a billing leak). Audit stays fail-open (a missing audit row must not block the membership change). Invite token is a bearer capability → **stored hashed**, transmitted once.
- **Scale & unbounded growth.** Invitations grow with churn; index `(organizationId, status)` and rely on the seat cap to bound *pending* rows. Lazy expiry + an optional `maintenance`-queue purge (pattern: the retention processors) keep the tombstone/expired tail from accumulating.
- **Multi-tenancy.** Invitations and the seat cap are per-org; the cap is noisy-neighbour protection against one org over-provisioning. Accept binds to the invited org **only** (no cross-tenant leakage, no stray personal org).
- **Contract stability.** `maxSeats` nullable mirrors the allocation `null = unlimited` shape, so a future per-org override or a paid seat add-on plugs in without re-plumbing. Enterprise SSO (#577) invitees reuse the same accept/self-heal binding — the seam is identity-source-agnostic.
- **Data lifecycle.** Expiry is a **business window** (invite TTL), not an arbitrary technical one; expired invites free their reserved seat immediately (excluded from the count by `expires_at > now`) and are reaped later.

## What this doesn't decide

- **Members/Team UI** — #585 (this is backend + API only; endpoints return shapes the UI will consume).
- **Auth0 Management API provisioning** — deliberately deferred; the invite-link flow is self-contained (seam left).
- **Enterprise SSO on-first-token provisioning** — #577 (reuses the accept/self-heal binding).
- **Per-org `maxSeats` override & paid seat add-ons** — additive later; the tier column is the entitlement source for now.
- **Emailing the invite link** — no email infra exists; the link is returned to the caller. Wiring an email provider is its own ticket.

## Next step

`docs/ORG_SEATS.spec.md` pins the contract: the `invitations` table (dual-schema) + `maxSeats` tier column + migrations; the `InvitationsRepository` (atomic consume + seat-count helpers); `SeatService` (atomic cap enforcement mirroring `UsageService`); the `ensureProvisioned` email-aware branch; the new `PermissionAction`s + `ApiCode`s + `AUDIT_ACTIONS`; and the seven endpoints with `@openapi` shapes. `docs/ORG_SEATS.plan.md` then slices it: (1) invitations table + `maxSeats` column + migrations + repo; (2) `SeatService` + invite/list/revoke/resend endpoints + authz + audit; (3) accept endpoint + `ensureProvisioned` email-aware binding; (4) member list + remove (last-owner guard). Each a green, testable commit on `feat/org-seats` → PR into `epic/security-readiness`.
