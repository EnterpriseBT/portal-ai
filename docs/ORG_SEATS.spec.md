# Organization seats: invitations + member management (backend) — Spec

**Issue:** [EnterpriseBT/portal-ai#584](https://github.com/EnterpriseBT/portal-ai/issues/584) · **Epic:** #578 · **Discovery:** `docs/ORG_SEATS.discovery.md`

Pins the contract for #584: an `invitations` table + a nullable `maxSeats` tier entitlement, a `SeatService` that atomically enforces the cap (accepted members + pending invites) under a per-org advisory lock, an app-generated **invite-link + accept-on-login** flow whose acceptance binds an invitee to the invited org **only** — both via a token-secured `POST /accept` endpoint and an email-verified branch in #583's `ensureProvisioned` (Decision 2-C) — plus per-org member list / remove (owner+admin) / re-role (owner-only), all authorized (#576) and audited (#575).

## Key decisions (from resolved discovery)

1. **Consumption = Decision 2-C.** Token-secured `POST /api/organization/invitations/:token/accept` **and** an email-verified branch in `ensureProvisioned` (user-just-created path only) that accepts pending invites instead of provisioning a personal org. Existing-user-no-membership self-heal is **unchanged** (#583 case 6 still provisions a personal org — an existing user accepts via the endpoint).
2. **Seat cap is a tier entitlement.** Nullable `maxSeats` on `tiers` (null = unlimited), mirroring the allocation grid. No per-org override (additive later).
3. **Atomic enforcement via a per-org advisory lock** (new `SEAT_LOCK_NAMESPACE`), not the lock-free `chargeConditional` — seat mutations are low-frequency and span two tables (members + invitations), so the check-then-write runs inside `withAdvisoryLock(SEAT_NS, orgId, …)`. Fail-**closed** (a seat that can't be verified is denied).
4. **Invite-link, no email.** The plaintext token is returned in the invite response; only its **sha256 hash** is stored. No email infra.
5. **Lifecycle:** `pending → accepted`, plus expiry (`expiresAt`, lazy), revoke, resend (rotates token + extends expiry on the one live pending row per `(org,email)`).
6. **Authz:** new `member.invite` + `member.remove` actions (owner + admin); role change stays `member.role.assign` (owner-only). Last owner can never be removed or demoted.

## Scope

### In scope
1. `invitations` table (dual-schema) + `maxSeats` column on `tiers` + migration(s).
2. `InvitationsRepository` (atomic consume + pending-count helpers).
3. `SeatService` — cap math + atomic admission + the invite/list/revoke/resend/accept/list-members/remove-member orchestration.
4. `ensureProvisioned` email-verified invite-accept branch + `resolveProfile` gains `emailVerified`; webhook payload gains `email_verified`.
5. New `PermissionAction`s, `ApiCode`s, `AUDIT_ACTIONS`; core contracts + swagger components.
6. Seven `/api/organization` endpoints (below). Role-change endpoint (#576) unchanged.

### Out of scope
- Members/Team UI (#585); Auth0 Management provisioning; SSO first-token (#577); per-org `maxSeats` override; emailing the link.

## Surface

### Migration — `invitations` table + `tiers.max_seats`

**File: `apps/api/src/db/schema/invitations.table.ts`** (new, mirrors `audit-log.table.ts` — `baseColumns` + FK + indexes):

```ts
export const invitations = pgTable("invitations", {
  ...baseColumns,
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),                       // normalized lower-case
  role: text("role", { enum: ORG_ROLES }).notNull(),    // invited role
  tokenHash: text("token_hash").notNull(),              // sha256(plaintext token)
  status: text("status", { enum: INVITATION_STATUSES }).notNull().default("pending"),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  invitedByUserId: text("invited_by_user_id").notNull().references(() => users.id),
  acceptedByUserId: text("accepted_by_user_id").references(() => users.id),
  acceptedAt: bigint("accepted_at", { mode: "number" }),
}, (t) => [
  uniqueIndex("invitations_org_email_pending_unique").on(t.organizationId, t.email)
    .where(sql`${t.status} = 'pending' AND ${t.deleted} IS NULL`),
  uniqueIndex("invitations_token_hash_unique").on(t.tokenHash).where(sql`${t.deleted} IS NULL`),
  index("invitations_org_status_idx").on(t.organizationId, t.status),
]);
```

**Edit `apps/api/src/db/schema/tiers.table.ts`** — add `maxSeats: integer("max_seats")` (nullable; null = unlimited) + a `check("tiers_max_seats_nonneg", sql\`max_seats IS NULL OR max_seats >= 1\`)`.

Generated migration `0097_add_org_seats.sql` (`npm run db:generate -- --name add_org_seats`): CREATE the `invitations` table + indexes, ADD `max_seats` to `tiers`. No backfill (existing tiers → `max_seats` NULL = unlimited, safe default). Commit `.sql` + `meta/_journal.json` + snapshot together.

### Core models + contracts (`packages/core`)

- **`models/invitation.model.ts`** (new) — `INVITATION_STATUSES = ["pending","accepted","revoked","expired"] as const`; `InvitationStatusSchema`; `InvitationSchema = CoreSchema.extend({ organizationId, email, role: OrgRoleSchema, tokenHash, status, expiresAt: z.number(), invitedByUserId, acceptedByUserId: nullable, acceptedAt: nullable })`; `InvitationModel`/`InvitationModelFactory` (layered pattern).
- **`models/audit-log.model.ts`** — extend `AUDIT_ACTIONS` with `"member.invite"`, `"member.invite.accept"`, `"member.invite.revoke"`, `"member.invite.resend"` (reuse `member.remove`, `member.role.change`).
- **`models/tier.model.ts`** — add `maxSeats: z.number().int().min(1).nullable()` to `TierSchema` (+ `TierPolicySchema` if it mirrors columns).
- **`contracts/invitation.contract.ts`** (new):
  - `InviteCreateRequestSchema = { email: z.string().email(), role: OrgRoleSchema }` (role refine: not `"owner"` — you invite members/admins, ownership transfer is out of scope).
  - `InvitationResponseSchema` — the row **minus `tokenHash`**, plus (invite/resend responses only) a transient `inviteUrl: string` carrying the plaintext token once.
  - `InvitationListResponseSchema = { invitations: InvitationResponse[] }`.
  - `MemberSchema = { userId, email, name, role, isCurrent? , joinedAt }`; `MemberListResponseSchema = { members: Member[] }`.
  - `AcceptInvitationRequestSchema = { token: z.string().min(1) }` — the token travels in the **body**, never the URL (a bearer capability must not land in access/proxy logs or history).
  - `AcceptInvitationResponseSchema = { organization, role }` (same shape as `OrganizationGetResponse`).
- Register each as swagger components in `apps/api/src/config/swagger.config.ts` via `z.toJSONSchema`.

### `apps/api` — schema plumbing
- `db/schema/zod.ts` — `createSelectSchema`/`createInsertSchema` → `InvitationSelect`/`InvitationInsert`; `TierSelect`/`TierInsert` pick up `maxSeats` automatically.
- `db/schema/type-checks.ts` — bidirectional `IsAssignable` guards for invitations ↔ `InvitationSelect`, and re-verify tiers.
- `db/schema/index.ts` — export `invitations`.

### `InvitationsRepository` (`apps/api/src/db/repositories/invitations.repository.ts`, new)
Extends `Repository<typeof invitations, InvitationSelect, InvitationInsert>`:
- `findByTokenHash(hash, client?)` — live row by token hash.
- `findPendingByOrgEmail(orgId, email, client?)` — the one live pending row (or undefined).
- `listByOrg(orgId, { status? }, client?)` — pending list for the org.
- `countPendingActive(orgId, client?)` — `count WHERE status='pending' AND expires_at > now AND deleted IS NULL`.
- `findPendingActiveByEmail(email, client?)` — all live, non-expired pending invites across orgs (for the self-heal branch).
- `consumeByTokenHash(hash, acceptedByUserId, now, client)` — atomic single-winner: `UPDATE … SET status='accepted', acceptedByUserId, acceptedAt=now WHERE token_hash=? AND status='pending' AND expires_at > now AND deleted IS NULL RETURNING *` (null if already consumed/expired/revoked).

### `SeatService` (`apps/api/src/services/seat.service.ts`, new — static methods)
The seats domain service. Every cap-mutating op runs inside `SyncLockService.withAdvisoryLock(SEAT_LOCK_NAMESPACE, organizationId, fn)`:

- `static async invite(caller: PermissionContext, req: { email; role }, auditCtx): Promise<InvitationResponse & { inviteUrl }>` — `PermissionService.check(caller, "member.invite")`; normalize email; 409 `MEMBER_ALREADY_EXISTS` if a live membership for that email exists; under the seat lock: `admit(orgId)` (below) else 409 `SEAT_LIMIT_EXCEEDED`; upsert the one pending row per `(org,email)` (resend if exists) with a fresh token (`crypto.randomBytes(32).hex`), store `sha256(token)`, `expiresAt = now + TTL`; audit `member.invite`; return the row + `inviteUrl`.
- `static async listInvitations(caller, orgId): InvitationResponse[]` — `member.invite` (owner+admin) to view; live pending rows.
- `static async listMembers(caller, orgId): Member[]` — owner+admin (via `member.invite` or a read gate); join `organization_users` → `users`, flag `isCurrent`.
- `static async revoke(caller, invitationId, auditCtx)` — `member.invite`; set `status='revoked'`; audit `member.invite.revoke`; frees the reserved seat (excluded from count).
- `static async resend(caller, invitationId, auditCtx): { inviteUrl }` — `member.invite`; rotate token + extend `expiresAt`; audit `member.invite.resend`.
- `static async acceptByToken(user: UserSelect, token: string, auditCtx): AcceptInvitationResponse` — under the invited org's seat lock: `consumeByTokenHash(sha256(token), user.id, now)`; null → 404 `INVITATION_NOT_FOUND` / 410 `INVITATION_EXPIRED`; if the user already has a live membership in that org → idempotent success (still consume); else insert `organization_users {role, lastLogin: now}` (pending already counted the seat → no re-admit); audit `member.invite.accept`; return `{organization, role}`.
- `static async acceptPendingForEmail(user: UserSelect, email: string, auditCtx): { organization, organizationUser } | null` — the self-heal branch: for each `findPendingActiveByEmail(email)`, consume + insert membership (seat already counted); return the current org (highest expiresAt) or null when none. Called by `ensureProvisioned`.
- `static async removeMember(caller, targetUserId, auditCtx)` — `PermissionService.check(caller, "member.remove")`; **guard: refuse if the target is the last live owner** (409 `LAST_OWNER_REMOVAL`); soft-delete the membership; audit `member.remove`.
- `private static async admit(orgId, client): boolean` — `maxSeats = tierMaxSeatsFor(orgId)`; `null` → true; else `(liveMembers + countPendingActive) < maxSeats`. Called **inside** the seat lock, so no overshoot.

### `SyncLockService` — add `SEAT_LOCK_NAMESPACE`
**File: `apps/api/src/services/sync-lock.service.ts`** — `export const SEAT_LOCK_NAMESPACE = 0x53_45_41_54; // "SEAT"`, keyed by `organizationId`, used via the existing `withAdvisoryLock`.

### `ensureProvisioned` — email-verified invite branch (#583 seam)
**File: `apps/api/src/services/application.service.ts:150`** — extend `resolveProfile`'s return to `{ email, name, picture, emailVerified: boolean }`. In the **user-just-created** branch only (profile in hand), before the personal-org path:

```ts
if (profile?.emailVerified && profile.email) {
  const joined = await SeatService.acceptPendingForEmail(user, profile.email, auditCtx);
  if (joined) return { user, organization: joined.organization, organizationUser: joined.organizationUser, created: true };
}
```

Existing-user branch (no profile) is unchanged — falls through to personal-org provisioning (#583 case 6 preserved). Callers updated to supply `emailVerified`:
- `metadata.middleware.ts` — `emailVerified: profile.email_verified ?? false`.
- `webhook.service.ts` — from the payload's new `email_verified`.

### Webhook payload — `email_verified`
**File: `packages/core/src/contracts/webhook.contract.ts`** — add optional `email_verified: z.boolean().optional()` to `Auth0PostLoginWebhookPayloadSchema` (the Auth0 post-login Action forwards `event.user.email_verified`).

### `PermissionService` — new actions
**File: `apps/api/src/services/permission.service.ts:30`** — extend `PermissionAction` with `"member.invite"` and `"member.remove"`. Neither is in `OWNER_ONLY` (owner + admin allowed; member denied by the default). `denyCode` default `INSUFFICIENT_ROLE` covers both.

### `ApiCode` additions
**File: `apps/api/src/constants/api-codes.constants.ts`**: `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_ACCEPTED`, `MEMBER_ALREADY_EXISTS`, `SEAT_LIMIT_EXCEEDED`, `LAST_OWNER_REMOVAL`.

### Endpoints (`apps/api/src/routes/organization.router.ts`, all `@openapi`-annotated)
| Method + path | Middleware | Authz | Body/response |
|---|---|---|---|
| `POST /invitations` | `getApplicationMetadata` | `member.invite` | `InviteCreateRequest` → `InvitationResponse` + `inviteUrl` |
| `GET /invitations` | `getApplicationMetadata` | `member.invite` | → `InvitationListResponse` |
| `POST /invitations/:id/revoke` | `getApplicationMetadata` | `member.invite` | → `InvitationResponse` |
| `POST /invitations/:id/resend` | `getApplicationMetadata` | `member.invite` | → `InvitationResponse` + `inviteUrl` |
| `POST /invitations/accept` | `jwtCheck` **only** (no `getApplicationMetadata`) | any authed user | `AcceptInvitationRequest` (`{token}` in body) → `AcceptInvitationResponse` |
| `GET /members` | `getApplicationMetadata` | `member.invite` | → `MemberListResponse` |
| `DELETE /members/:userId` | `getApplicationMetadata` | `member.remove` | → `204` |

Accept is intentionally **not** behind `getApplicationMetadata` — the accepter may have no current org yet, and the handler establishes membership first (`findOrCreateByAuth0Id` on `req.auth.payload.sub`), stamping `lastLogin: now` so the invited org becomes current.

## TDD test plan

Run via `cd apps/api && npm run test:unit` / `npm run test:integration`; core via `cd packages/core && npm run test:unit`.

### Layer 1 — schema + repo (api integration)
`invitations.repository.integration.test.ts`: findByTokenHash / findPendingByOrgEmail / countPendingActive (excludes expired + revoked); `consumeByTokenHash` single-winner under two concurrent calls (exactly one non-null); partial unique index rejects a 2nd live pending row for `(org,email)`; expired row not returned by pending-active. `tiers` `max_seats` CHECK rejects 0/negative. (~8)

### Layer 2 — SeatService (api integration)
`seat.service.integration.test.ts`: invite creates a pending row + returns `inviteUrl`, stores only the hash; **seat cap** — with `maxSeats=2` and 1 member, a 2nd invite reserves the last seat and a 3rd is denied `SEAT_LIMIT_EXCEEDED`; `maxSeats=null` never denies; **concurrency** — two parallel invites racing the last seat → exactly one succeeds (advisory lock); revoke frees a seat (next invite admitted); resend rotates the token + extends expiry (old token no longer accepts); `acceptByToken` binds membership with role, idempotent on re-accept, 404/410 on unknown/expired; `removeMember` soft-deletes and refuses the **last owner** (`LAST_OWNER_REMOVAL`); `MEMBER_ALREADY_EXISTS` on inviting a current member. Audit rows emitted for invite/accept/revoke/resend/remove. (~14)

### Layer 3 — ensureProvisioned invite branch (api integration)
`ensure-provisioned.integration.test.ts` (extend): a brand-new user whose **verified** email has a pending invite → joins the **invited** org, **no personal org**, `created:true`; unverified email → personal org (invite untouched); no pending invite → personal org (unchanged); existing-user-no-membership → personal org (case 6 preserved, invite branch not consulted). (~4)

### Layer 4 — routes (api integration)
`organization.router.invitations.integration.test.ts`: each endpoint happy path + authz (member denied invite/remove `403 INSUFFICIENT_ROLE`; admin allowed invite/remove; role-change still owner-only); accept endpoint works without a prior current org; `GET /members` shape. (~10)

### Layer 5 — core (unit)
`invitation.model.test.ts` (+ contract test): schema/factory round-trip, status enum, `InviteCreateRequest` rejects `role:"owner"` + bad email; `audit-log.model` pins the 4 new actions; `webhook.contract` accepts `email_verified`. (~6)

**Totals ≈ 42 cases.** Migration verified by the index/CHECK cases in Layer 1 (no separate migration test).

## Acceptance criteria

- [ ] An owner or admin can `POST /invitations` and receive an `inviteUrl`; the invitee accepts (token endpoint **or** first-login via a verified email) and joins the **invited org only** with the invited role — never a stray personal org.
- [ ] Members can be listed (`GET /members`), re-roled (owner-only, existing endpoint), and removed (owner/admin); the **last owner cannot be removed**.
- [ ] Invitations can be revoked and resent; an expired invite cannot be accepted (`410`).
- [ ] The seat cap is enforced **server-side**, counts **accepted members + pending invites**, holds under concurrent invites, and treats `maxSeats=null` as unlimited.
- [ ] Every mutation (invite/accept/revoke/resend/remove/role-change) emits an audit row.
- [ ] `npm run lint`, `type-check`, and both suites pass.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Concurrent invites overshoot the cap. | Per-org advisory lock around check-then-insert (Layer 2 concurrency case). |
| Two accepts of one token double-join. | `consumeByTokenHash` single-winner UPDATE (Layer 1 case). |
| First-login invitee gets a personal org (invariant break). | `ensureProvisioned` verified-email branch consumes invites before personal-org path (Layer 3). Both webhook + request path supply `emailVerified`. |
| Invite token leak. | Stored **hashed** (sha256); plaintext returned once, never persisted or logged. |
| Seat cap can't be resolved. | **Fail-closed** — deny the invite (a wrongly-granted seat is a billing leak). |
| Unverified email hijacks an invite. | Self-heal branch requires `email_verified`; otherwise the token endpoint (capability) is the only path. |

**Rollback:** revert the migration (drop `invitations`, drop `tiers.max_seats`) + `git revert`. `SeatService` + the endpoints are additive; the `ensureProvisioned` branch is guarded (no invite → prior behavior).

## Files touched

**New:** `db/schema/invitations.table.ts`, `db/repositories/invitations.repository.ts`, `services/seat.service.ts`, `packages/core/src/models/invitation.model.ts`, `packages/core/src/contracts/invitation.contract.ts`, migration `0097_add_org_seats.sql`. **Edit:** `db/schema/tiers.table.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `db/schema/index.ts`, `services/sync-lock.service.ts`, `services/application.service.ts`, `services/webhook.service.ts`, `middleware/metadata.middleware.ts`, `services/permission.service.ts`, `constants/api-codes.constants.ts`, `routes/organization.router.ts`, `config/swagger.config.ts`, `packages/core/src/models/{audit-log,tier}.model.ts`, `packages/core/src/contracts/webhook.contract.ts`, `packages/core/src/models/index.ts` + `contracts/index.ts`.

## Next step

`docs/ORG_SEATS.plan.md` slices this into ~4 TDD commits on `feat/org-seats`: (1) `invitations` table + `tiers.max_seats` + migration + `InvitationsRepository`; (2) `SeatService` + `SEAT_LOCK_NAMESPACE` + invite/list/revoke/resend endpoints + authz + audit; (3) accept endpoint + `ensureProvisioned` verified-email branch + `resolveProfile`/webhook `emailVerified`; (4) `GET /members` + `DELETE /members/:userId` (last-owner guard). Each green + compilable; the webhook and #583 self-heal keep working throughout.
