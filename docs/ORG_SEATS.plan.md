# Organization seats: invitations + member management (backend) — Plan

**TDD-sequenced: schema + repo foundations → `SeatService` + invite lifecycle endpoints → accept flow + the `ensureProvisioned` verified-email seam → member remove + last-owner guard.**

Spec: `docs/ORG_SEATS.spec.md`. Discovery: `docs/ORG_SEATS.discovery.md`. Issue: #584 (epic #578). Builds on shipped #576 (roles + `PermissionService`), #583 (`ensureProvisioned`), #172 (tier/quota pattern), #575 (audit).

Four slices, each behind a green suite and each leaving the tree compilable + the webhook and #583 self-heal working. They land as **commits on `feat/org-seats`** (PR #602 → `epic/security-readiness`) — one feature, one PR.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit && npm run test:integration
cd packages/core && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — leaf data/model first (nothing references it yet), then the service + its low-risk invite endpoints, then the cross-cutting accept/self-heal seam (the one slice that touches #583's just-merged code), and finally the guarded member-remove. Slice 4 depends only on slice 1 (membership repo) so it could swap with slice 3, but accept is the higher-value path and lands first.

---

## Slice 1 — Schema, models & repository foundations

The dual-schema `invitations` table, the `tiers.max_seats` entitlement, and the repository — unreferenced by any live path yet.

**Files**

- New: `packages/core/src/models/invitation.model.ts` — `INVITATION_STATUSES`, `InvitationStatusSchema`, `InvitationSchema` (+ `InvitationModel`/`InvitationModelFactory`); export from `models/index.ts`.
- Edit: `packages/core/src/models/audit-log.model.ts` — add the four `member.invite[.accept|.revoke|.resend]` actions to `AUDIT_ACTIONS`.
- Edit: `packages/core/src/models/tier.model.ts` — add nullable `maxSeats` to `TierSchema`.
- New: `packages/core/src/contracts/invitation.contract.ts` — `InviteCreateRequest` (role ≠ owner, email), `AcceptInvitationRequest` (`{token}`), `InvitationResponse` (no `tokenHash`; optional `inviteUrl`), `InvitationListResponse`, `Member`/`MemberListResponse`, `AcceptInvitationResponse`; export from `contracts/index.ts`.
- New: `apps/api/src/db/schema/invitations.table.ts` — table + indexes (mirror `audit-log.table.ts`).
- Edit: `apps/api/src/db/schema/tiers.table.ts` — `max_seats` integer + CHECK; `db/schema/{zod,type-checks,index}.ts` for both.
- New: migration `0097_add_org_seats.sql` (`npm run db:generate -- --name add_org_seats`).
- New: `apps/api/src/db/repositories/invitations.repository.ts`.
- Tests: `packages/core` — `invitation.model.test.ts` + contract test + `audit-log.model` action pin (Layer 5, minus the webhook bit); `apps/api` — `invitations.repository.integration.test.ts` (Layer 1).

**Steps**

1. **Tests (spec Layer 1 + Layer 5 model/contract cases).** Repo: findByTokenHash / findPendingByOrgEmail / countPendingActive (excludes expired+revoked) / `consumeByTokenHash` single-winner under two concurrent calls / partial-unique rejects 2nd live pending per (org,email) / `tiers.max_seats` CHECK rejects 0. Core: model round-trip + status enum; `InviteCreateRequest` rejects `role:"owner"` + bad email; the 4 audit actions present. Run; fail.
2. **Implement** the models, contracts, table, migration, repo. Green.
3. Lint + type-check (both packages). Commit migration `.sql` + journal + snapshot together (`project_drizzle_journal_must_be_committed`).

**Done when:** Layer 1 + the model/contract half of Layer 5 pass; nothing live references the table/repo yet; `type-checks.ts` guards compile.

**Risk:** dual-schema drift — the `IsAssignable` guards fail the build if model/table diverge (intended). `max_seats` NULL default keeps existing tiers unlimited.

---

## Slice 2 — `SeatService` + invite-lifecycle endpoints

The seats service and the low-risk invite/list/revoke/resend surface. The eager/self-heal provisioning paths are untouched.

**Files**

- Edit: `apps/api/src/services/sync-lock.service.ts` — `SEAT_LOCK_NAMESPACE = 0x53_45_41_54` ("SEAT").
- New: `apps/api/src/services/seat.service.ts` — `invite`, `listInvitations`, `listMembers`, `revoke`, `resend`, private `admit` + `tierMaxSeatsFor`; each cap-mutating op inside `withAdvisoryLock(SEAT_LOCK_NAMESPACE, orgId, …)`.
- Edit: `apps/api/src/services/permission.service.ts` — add `member.invite` to `PermissionAction` (owner+admin).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `MEMBER_ALREADY_EXISTS`, `SEAT_LIMIT_EXCEEDED`, `INVITATION_NOT_FOUND` (revoke/resend lookups).
- Edit: `apps/api/src/routes/organization.router.ts` — `POST /invitations`, `GET /invitations`, `POST /invitations/:id/revoke`, `POST /invitations/:id/resend`, `GET /members` (each `getApplicationMetadata` + `member.invite`, `@openapi`).
- Edit: `apps/api/src/config/swagger.config.ts` — register the invitation/member components.
- Tests: `apps/api` — `seat.service.integration.test.ts` (Layer 2, minus accept/remove) + the invite/list/revoke/resend/members rows of `organization.router.invitations.integration.test.ts` (Layer 4).

**Steps**

1. **Tests (spec Layer 2 invite/cap/concurrency/revoke/resend + Layer 4 invite routes).** invite reserves a seat + returns `inviteUrl` + stores only the hash; cap denies the 3rd of `maxSeats=2`; `null` never denies; **two parallel invites racing the last seat → exactly one wins**; revoke frees a seat; resend rotates token + extends expiry; `MEMBER_ALREADY_EXISTS`; audit rows emitted; member denied invite (403), admin allowed. Run; fail.
2. **Implement** `SEAT_LOCK_NAMESPACE`, `SeatService` (the five methods + `admit`), the action, the codes, the endpoints + swagger. Green.
3. Lint + type-check.

**Done when:** invite/list/revoke/resend/members work end-to-end with the cap enforced under concurrency; accept + remove not yet present; webhook + self-heal unchanged.

**Risk:** the advisory lock wraps a multi-statement check-then-insert — follow the reserved-connection pattern; the seat count query must run **inside** the lock (the concurrency test is the proof).

---

## Slice 3 — Accept flow + `ensureProvisioned` verified-email seam

The invitee-binding path — token endpoint plus the #583 self-heal branch (Decision 2-C). This is the one slice touching just-merged #583 code.

**Files**

- Edit: `apps/api/src/services/seat.service.ts` — add `acceptByToken(user, token, auditCtx)` + `acceptPendingForEmail(user, email, auditCtx)`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `INVITATION_EXPIRED`, `INVITATION_ALREADY_ACCEPTED`.
- Edit: `apps/api/src/routes/organization.router.ts` — `POST /invitations/accept` (`jwtCheck` **only**, token in body; `findOrCreateByAuth0Id` on the caller sub; `@openapi`).
- Edit: `apps/api/src/services/application.service.ts` — extend `resolveProfile` return with `emailVerified`; add the verified-email invite branch in the **user-just-created** path (before personal-org provisioning).
- Edit: `apps/api/src/middleware/metadata.middleware.ts` — pass `emailVerified: profile.email_verified ?? false`.
- Edit: `apps/api/src/services/webhook.service.ts` — pass `emailVerified` from the payload.
- Edit: `packages/core/src/contracts/webhook.contract.ts` — optional `email_verified` on the payload.
- Tests: `apps/api` — extend `ensure-provisioned.integration.test.ts` (Layer 3) + the accept rows of the routes suite; `packages/core` — webhook.contract accepts `email_verified` (Layer 5 remainder).

**Steps**

1. **Tests (spec Layer 3 + accept route + Layer 5 webhook).** `acceptByToken` binds membership with role, idempotent on re-accept, 404/410 on unknown/expired; accept endpoint works with **no prior current org**. ensureProvisioned: verified-email + pending invite → joins **invited** org, **no personal org**, `created:true`; unverified → personal org; no invite → personal org; **existing-user-no-membership → personal org (case 6 preserved)**. Run; fail.
2. **Implement** the accept methods, endpoint, the `resolveProfile`/branch change, both callers, the webhook contract field. Green — including the **existing** #583 ensure-provisioned cases (extend, don't break).
3. Lint + type-check.

**Done when:** Layer 3 + accept route + webhook-contract cases pass; a first-login invitee joins the invited org only; #583's suite stays green.

**Risk:** the `resolveProfile` signature change ripples to both callers + #583 tests — update them in this slice (type-check catches misses). The branch runs **only** when `profile` is in hand (user just created), so the existing-user path is provably unchanged.

---

## Slice 4 — Member removal + last-owner guard

The guarded destructive path.

**Files**

- Edit: `apps/api/src/services/seat.service.ts` — `removeMember(caller, targetUserId, auditCtx)` (last-owner refusal).
- Edit: `apps/api/src/services/permission.service.ts` — add `member.remove` (owner+admin).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `LAST_OWNER_REMOVAL`.
- Edit: `apps/api/src/routes/organization.router.ts` — `DELETE /members/:userId` (`getApplicationMetadata` + `member.remove`, `@openapi`).
- Tests: `apps/api` — remove cases in `seat.service.integration.test.ts` + the remove row of the routes suite.

**Steps**

1. **Tests (spec Layer 2 remove + Layer 4 remove route).** removeMember soft-deletes the membership + audits `member.remove`; refuses the **last live owner** (`LAST_OWNER_REMOVAL`); member denied (403), admin allowed; removing a non-existent membership 404s. Run; fail.
2. **Implement** `removeMember` + action + code + endpoint. Green.
3. Lint + type-check.

**Done when:** remove works with the last-owner invariant enforced server-side; full feature complete.

**Risk:** the last-owner check must count **live** owners atomically with the delete — do it inside a transaction (or the seat lock) so a concurrent demotion can't strand an ownerless org.

---

## Sequence summary

| Slice | Lands | Spec layers | Tests |
|---|---|---|---|
| 1 | invitations table + `tiers.max_seats` + migration + repo + core models/contracts | L1, L5 (models) | core unit + api integration |
| 2 | `SeatService` + `SEAT_LOCK_NAMESPACE` + invite/list/revoke/resend/members endpoints + authz + audit | L2 (minus accept/remove), L4 (invite routes) | api integration |
| 3 | accept endpoint + `ensureProvisioned` verified-email branch + `emailVerified` plumbing | L3, L4 (accept), L5 (webhook) | api integration + core unit |
| 4 | member remove + last-owner guard | L2 (remove), L4 (remove route) | api integration |

Total ≈ **42 cases**. One migration (slice 1). Commits on `feat/org-seats` → PR #602.

## Cross-slice notes

- **Migration hygiene:** slice 1 commits `0097_add_org_seats.sql` + journal + snapshot together; after merge run `cd apps/api && npm run db:migrate` on any dev DB (`project_dev_seeds_not_migrates`).
- **#583 seam (slice 3):** extending `resolveProfile` with `emailVerified` changes `ensureProvisioned`'s signature — both callers and the `ensure-provisioned` + `metadata.middleware` suites update in slice 3. The invite branch is gated on `profile?.emailVerified`, so the existing-user-no-membership path (case 6) is untouched.
- **Ops follow-up (not code):** for the **webhook** path to email-match invites, the Auth0 post-login Action must forward `event.user.email_verified`. Until it does, the webhook path treats invitees as unverified → personal org, but the **request path** (metadata self-heal) still binds them correctly. Note this in the PR body / smoke as a deploy-config item; it does not block the ticket.
- **Concurrency proofs:** slice 2's parallel-invite test and slice 1's `consumeByTokenHash` single-winner test are the two that prove the cap + accept are race-safe; keep them.
- **Docs-in-sync:** endpoints carry `@openapi` blocks + swagger components (in-PR); new `ApiCode`s are self-documenting. No user-facing Help/README/CLAUDE.md convention changes (backend-only; the UI is #585).
- **Seat-count semantics** are shared across slices 2–4: `live members + pending-active invites`; accepted invites stop counting as pending but the new membership counts as a member (net-neutral); revoked/expired free the seat. Every slice that touches the count uses `InvitationsRepository.countPendingActive` — never re-derives it.

## Next step

Implement slice 1 first (tests-first), one commit per slice — only after discovery + spec + plan are reviewed and confirmed. Each slice green and independent; the webhook and #583 self-heal stay functional throughout, and the invitee-binding invariant lands in slice 3.
