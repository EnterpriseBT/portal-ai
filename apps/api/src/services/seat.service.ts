import crypto from "crypto";
import { eq, and, isNull, inArray } from "drizzle-orm";

import {
  InvitationModelFactory,
  OrganizationUserModelFactory,
  UserModelFactory,
  highestRole,
  type OrgRole,
} from "@portalai/core/models";
import type {
  InviteCreateRequest,
  InvitationResponse,
  AcceptInvitationResponse,
  Member,
} from "@portalai/core/contracts";
import type {
  OrganizationSelect,
  OrganizationUserSelect,
  UserSelect,
  InvitationSelect,
} from "../db/schema/zod.js";

import { db } from "../db/client.js";
import { organizationUsers } from "../db/schema/organization-users.table.js";
import { users } from "../db/schema/users.table.js";
import { userRole } from "../db/schema/user-role.table.js";
import { roles } from "../db/schema/roles.table.js";
import { userGroup } from "../db/schema/user-group.table.js";
import { DbService } from "./db.service.js";
import { AuditService } from "./audit.service.js";
import { Auth0Service } from "./auth0.service.js";
import { SyncLockService } from "./sync-lock.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "seat" });

/** Post-commit audit context supplied by the route (`ip` / `user-agent`). */
export interface SeatAuditContext {
  sourceIp: string | null;
  userAgent: string | null;
}

/**
 * Org seats domain service (#584) — invitations + membership management, with
 * the tier seat cap enforced atomically under a per-org advisory lock.
 *
 * The seat count is `live members + pending-active invitations`; an invite
 * reserves a seat (pending counts), acceptance is seat-neutral (a pending
 * invite becomes a membership), and revoke/expiry free the seat. `maxSeats`
 * is the org's tier entitlement (null = unlimited). Cap enforcement is
 * **fail-closed**: an unresolvable tier denies the invite rather than granting
 * a free seat.
 */
export class SeatService {
  /** Invite an email to the caller's org at a role. Owner + admin only. */
  static async invite(
    caller: PermissionContext,
    req: InviteCreateRequest,
    auditCtx: SeatAuditContext
  ): Promise<InvitationResponse> {
    await PermissionService.check(caller, "member.invite");
    const orgId = caller.organizationId;
    const email = req.email.trim().toLowerCase();

    // Already a live member? (An invitee may have no user row yet — only check
    // when a user with that email exists.)
    const existingUser = await DbService.repository.users.findByEmail(email);
    if (existingUser) {
      const membership =
        await DbService.repository.organizationUsers.findByOrganizationAndUser(
          orgId,
          existingUser.id
        );
      if (membership) {
        throw new ApiError(
          409,
          ApiCode.MEMBER_ALREADY_EXISTS,
          "That user is already a member of this organization"
        );
      }
    }

    return SyncLockService.withSeatLock(orgId, async () => {
      const existingPending =
        await DbService.repository.invitations.findPendingByOrgEmail(
          orgId,
          email
        );
      if (existingPending) {
        throw new ApiError(
          409,
          ApiCode.INVITATION_ALREADY_PENDING,
          "A pending invitation for that email already exists — resend it instead"
        );
      }

      const now = SystemUtilities.utc.now().getTime();
      if (!(await SeatService.admit(orgId, now))) {
        throw new ApiError(
          409,
          ApiCode.SEAT_LIMIT_EXCEEDED,
          "This organization has reached its seat limit"
        );
      }

      const token = crypto.randomBytes(32).toString("hex");
      const model = new InvitationModelFactory().create(caller.userId).update({
        organizationId: orgId,
        email,
        role: req.role,
        tokenHash: SeatService.hashToken(token),
        status: "pending",
        expiresAt: now + SeatService.ttlMs(),
        invitedByUserId: caller.userId,
        acceptedByUserId: null,
        acceptedAt: null,
      });
      const created = await DbService.repository.invitations.create(
        model.parse()
      );

      void AuditService.record({
        organizationId: orgId,
        userId: caller.userId,
        action: "member.invite",
        targetType: "user",
        targetId: email,
        sourceIp: auditCtx.sourceIp,
        userAgent: auditCtx.userAgent,
        metadata: { role: req.role },
      });

      return SeatService.toResponse(created, SeatService.inviteUrl(token));
    });
  }

  /** The caller org's live pending invitations. Owner + admin only. */
  static async listInvitations(
    caller: PermissionContext
  ): Promise<InvitationResponse[]> {
    await PermissionService.check(caller, "member.invite");
    const rows = await DbService.repository.invitations.listByOrg(
      caller.organizationId,
      { status: "pending" }
    );
    return rows.map((r) => SeatService.toResponse(r));
  }

  /** The caller org's members (membership joined to user). Owner + admin only. */
  static async listMembers(caller: PermissionContext): Promise<Member[]> {
    // #621 (Finding B): reading the roster requires only org membership — every
    // member can see who else is in the org (the ShareDialog's grantee picker
    // depends on this, and it's the "actions vs viewing are separate surfaces"
    // rule: invite/remove/role changes stay capability-gated on their own
    // routes). `getApplicationMetadata` already proved the caller belongs to
    // `caller.organizationId`, which is the boundary here.
    const rows = await (db as typeof db)
      .select({
        userId: organizationUsers.userId,
        email: users.email,
        name: users.name,
        role: organizationUsers.role,
        joinedAt: organizationUsers.created,
      })
      .from(organizationUsers)
      .innerJoin(users, eq(users.id, organizationUsers.userId))
      .where(
        and(
          eq(organizationUsers.organizationId, caller.organizationId),
          // Raw join, so guard soft-deletes on both sides explicitly.
          isNull(organizationUsers.deleted),
          isNull(users.deleted)
        )
      );

    // #620/#622: batch-load each member's roles from the user_role join (one
    // query) — the system role names (display + owner logic) and every role's
    // slug (the complete assignment set the Members-tab multiselect edits).
    const userIds = rows.map((r) => r.userId);
    const roleRows = userIds.length
      ? await (db as typeof db)
          .select({
            userId: userRole.userId,
            name: roles.name,
            slug: roles.slug,
            kind: roles.kind,
          })
          .from(userRole)
          .innerJoin(roles, eq(userRole.roleId, roles.id))
          .where(
            and(
              eq(userRole.organizationId, caller.organizationId),
              inArray(userRole.userId, userIds),
              isNull(userRole.deleted),
              isNull(roles.deleted)
            )
          )
      : [];
    const rolesByUser = new Map<string, OrgRole[]>();
    const roleSlugsByUser = new Map<string, string[]>();
    for (const rr of roleRows) {
      if (rr.kind === "system") {
        const list = rolesByUser.get(rr.userId) ?? [];
        list.push(rr.name as OrgRole);
        rolesByUser.set(rr.userId, list);
      }
      const slugs = roleSlugsByUser.get(rr.userId) ?? [];
      slugs.push(rr.slug);
      roleSlugsByUser.set(rr.userId, slugs);
    }
    // #622: batch-load each member's custom-group ids from the user_group join
    // (one query) so the Members tab can offer member-centric group assignment.
    const groupRows = userIds.length
      ? await (db as typeof db)
          .select({ userId: userGroup.userId, groupId: userGroup.groupId })
          .from(userGroup)
          .where(
            and(
              eq(userGroup.organizationId, caller.organizationId),
              inArray(userGroup.userId, userIds),
              isNull(userGroup.deleted)
            )
          )
      : [];
    const groupsByUser = new Map<string, string[]>();
    for (const gr of groupRows) {
      const list = groupsByUser.get(gr.userId) ?? [];
      list.push(gr.groupId);
      groupsByUser.set(gr.userId, list);
    }
    // #620: the member's roles come from user_role; the enum is dropped from
    // the response (kept only as an internal fallback for a membership that
    // predates the write cutover, until the enum is retired).
    return rows.map(({ role, ...rest }) => ({
      ...rest,
      roles: rolesByUser.get(rest.userId) ?? (role ? [role as OrgRole] : []),
      roleSlugs: roleSlugsByUser.get(rest.userId) ?? (role ? [role] : []),
      groupIds: groupsByUser.get(rest.userId) ?? [],
    })) as Member[];
  }

  /**
   * The roles the caller may assign here (#622) — the Members-tab role
   * multiselect's options. Every org's three system roles, plus any custom roles
   * the org authored; `slug` is the stable assignment key. Readable by any
   * member (role names aren't sensitive); the multiselect only renders for a
   * caller with `member.role.assign`.
   */
  static async assignableRoles(
    caller: PermissionContext
  ): Promise<{ slug: string; name: string; kind: "system" | "custom" }[]> {
    const orgRoles = await DbService.repository.roles.findByOrganizationId(
      caller.organizationId
    );
    return orgRoles.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind }));
  }

  /**
   * Seat usage for display (#585): `used` = live members + pending-active
   * invites; `max` = the org's tier cap, or **null** (unlimited) when the tier
   * has no cap OR can't be resolved. Deliberately **non-throwing** — a display
   * value must never block the members list; the cap is *enforced* on invite by
   * `admit` (which fail-closes). Readable by any org member — it rides the
   * members-list response, which is now a roster read for everyone (#621
   * Finding B); the cap is only *enforced* on the capability-gated invite path.
   */
  static async seatUsage(
    caller: PermissionContext
  ): Promise<{ used: number; max: number | null }> {
    const orgId = caller.organizationId;
    const now = SystemUtilities.utc.now().getTime();
    const members = await DbService.repository.organizationUsers.count(
      eq(organizationUsers.organizationId, orgId)
    );
    const pending = await DbService.repository.invitations.countPendingActive(
      orgId,
      now
    );
    let max: number | null = null;
    const org = await DbService.repository.organizations.findById(orgId);
    if (org?.tier) {
      const tier = await DbService.repository.tiers.findBySlug(org.tier);
      max = tier?.maxSeats ?? null;
    }
    return { used: members + pending, max };
  }

  /** Revoke a pending invitation. Owner + admin only. */
  static async revoke(
    caller: PermissionContext,
    invitationId: string,
    auditCtx: SeatAuditContext
  ): Promise<InvitationResponse> {
    await PermissionService.check(caller, "member.invite");
    const inv = await SeatService.requirePending(caller, invitationId);
    const updated = await DbService.repository.invitations.update(inv.id, {
      status: "revoked",
    });
    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "member.invite.revoke",
      targetType: "invitation",
      targetId: inv.id,
      sourceIp: auditCtx.sourceIp,
      userAgent: auditCtx.userAgent,
    });
    return SeatService.toResponse(updated ?? { ...inv, status: "revoked" });
  }

  /** Rotate the token + extend expiry on a pending invitation. Owner + admin. */
  static async resend(
    caller: PermissionContext,
    invitationId: string,
    auditCtx: SeatAuditContext
  ): Promise<InvitationResponse> {
    await PermissionService.check(caller, "member.invite");
    const inv = await SeatService.requirePending(caller, invitationId);
    const token = crypto.randomBytes(32).toString("hex");
    const updated = await DbService.repository.invitations.update(inv.id, {
      tokenHash: SeatService.hashToken(token),
      expiresAt: SystemUtilities.utc.now().getTime() + SeatService.ttlMs(),
    });
    void AuditService.record({
      organizationId: caller.organizationId,
      userId: caller.userId,
      action: "member.invite.resend",
      targetType: "invitation",
      targetId: inv.id,
      sourceIp: auditCtx.sourceIp,
      userAgent: auditCtx.userAgent,
    });
    return SeatService.toResponse(updated ?? inv, SeatService.inviteUrl(token));
  }

  /**
   * Accept a pending invitation by its plaintext token — the explicit accept
   * path (any authenticated user). Consumes the invite atomically (single
   * winner), then binds the user to the invited org with the invited role.
   * Seat-neutral (the pending seat was already reserved), so no cap re-check.
   * Idempotent when the user is already a member of that org.
   */
  static async acceptByToken(
    auth0Sub: string,
    authorizationHeader: string | undefined,
    token: string,
    auditCtx: SeatAuditContext
  ): Promise<AcceptInvitationResponse> {
    // Resolve or create the caller's user — a brand-new invitee may accept
    // before any other authed request has provisioned them.
    const user = await SeatService.resolveCaller(auth0Sub, authorizationHeader);

    const now = SystemUtilities.utc.now().getTime();
    const tokenHash = SeatService.hashToken(token);
    const consumed = await DbService.repository.invitations.consumeByTokenHash(
      tokenHash,
      user.id,
      now
    );
    if (!consumed) {
      const existing =
        await DbService.repository.invitations.findByTokenHash(tokenHash);
      if (
        existing &&
        existing.status === "pending" &&
        existing.expiresAt <= now
      ) {
        throw new ApiError(
          410,
          ApiCode.INVITATION_EXPIRED,
          "This invitation has expired"
        );
      }
      throw new ApiError(
        404,
        ApiCode.INVITATION_NOT_FOUND,
        "No valid invitation for that token"
      );
    }

    const orgUser = await SeatService.attachMembership(
      user.id,
      consumed.organizationId,
      consumed.role,
      now
    );
    void AuditService.record({
      organizationId: consumed.organizationId,
      userId: user.id,
      action: "member.invite.accept",
      targetType: "invitation",
      targetId: consumed.id,
      sourceIp: auditCtx.sourceIp,
      userAgent: auditCtx.userAgent,
      metadata: { role: consumed.role },
    });

    const organization = await SeatService.requireOrg(consumed.organizationId);
    return { organization, role: orgUser.role };
  }

  /**
   * The first-login self-heal branch (#583/#584): accept every live, unexpired
   * pending invitation for a **verified** email, binding the user to each
   * invited org — instead of provisioning a personal org. Returns the current
   * org (the most recently-invited) or null when the email has no pending
   * invites. Seat-neutral; called by `ApplicationService.ensureProvisioned`.
   */
  static async acceptPendingForEmail(
    user: UserSelect,
    email: string,
    auditCtx: SeatAuditContext
  ): Promise<{
    organization: OrganizationSelect;
    organizationUser: OrganizationUserSelect;
  } | null> {
    const now = SystemUtilities.utc.now().getTime();
    const pendings =
      await DbService.repository.invitations.findPendingActiveByEmail(
        email.trim().toLowerCase(),
        now
      );
    if (!pendings.length) return null;

    let current: {
      organization: OrganizationSelect;
      organizationUser: OrganizationUserSelect;
    } | null = null;

    // Ordered expiresAt desc, so index 0 is the most recent — give it the
    // highest lastLogin so it becomes the user's current org.
    for (let i = 0; i < pendings.length; i++) {
      const inv = pendings[i];
      const consumed =
        await DbService.repository.invitations.consumeByTokenHash(
          inv.tokenHash,
          user.id,
          now
        );
      if (!consumed) continue; // raced with another accept; skip
      const orgUser = await SeatService.attachMembership(
        user.id,
        inv.organizationId,
        inv.role,
        now - i
      );
      void AuditService.record({
        organizationId: inv.organizationId,
        userId: user.id,
        action: "member.invite.accept",
        targetType: "invitation",
        targetId: inv.id,
        sourceIp: auditCtx.sourceIp,
        userAgent: auditCtx.userAgent,
        metadata: { role: inv.role, viaEmail: true },
      });
      if (!current) {
        current = {
          organization: await SeatService.requireOrg(inv.organizationId),
          organizationUser: orgUser,
        };
      }
    }
    return current;
  }

  /**
   * Remove a member from the caller's org (owner + admin). Soft-deletes the
   * membership. Refuses to remove the **last live owner** — that would strand
   * the org ownerless. The owner-count check + delete run under the seat lock
   * so two concurrent removals of two different owners can't both slip past the
   * "more than one owner" check and leave zero.
   */
  static async removeMember(
    caller: PermissionContext,
    targetUserId: string,
    auditCtx: SeatAuditContext
  ): Promise<void> {
    await PermissionService.check(caller, "member.remove");
    const orgId = caller.organizationId;

    await SyncLockService.withSeatLock(orgId, async () => {
      const target =
        await DbService.repository.organizationUsers.findByOrganizationAndUser(
          orgId,
          targetUserId
        );
      if (!target) {
        throw new ApiError(
          404,
          ApiCode.ORGANIZATION_USER_NOT_FOUND,
          "Member not found in this organization"
        );
      }
      if (target.role === "owner") {
        // #620: owner-ness lives in user_role now — heal the target's enum then
        // count owners there so a co-owner added via set-roles is seen.
        await DbService.repository.userRole.materializeFromEnum(
          target.userId,
          orgId,
          target.role,
          caller.userId
        );
        const owners = await DbService.repository.userRole.countUsersWithRole(
          orgId,
          "owner"
        );
        if (owners <= 1) {
          throw new ApiError(
            409,
            ApiCode.LAST_OWNER_REMOVAL,
            "Cannot remove the last owner of the organization"
          );
        }
      }
      await DbService.repository.organizationUsers.softDelete(
        target.id,
        caller.userId
      );
      // #620: tombstone the member's role assignments along with the membership.
      await DbService.repository.userRole.removeAllForUser(
        target.userId,
        orgId,
        caller.userId
      );
      // #621: revoke every object grant naming the removed member (their
      // shares no longer resolve to a member).
      await DbService.repository.permissionGrants.hardDeleteByPrincipal(
        orgId,
        "user",
        target.userId
      );
      void AuditService.record({
        organizationId: orgId,
        userId: caller.userId,
        action: "member.remove",
        targetType: "user",
        targetId: targetUserId,
        sourceIp: auditCtx.sourceIp,
        userAgent: auditCtx.userAgent,
        metadata: { role: target.role },
      });
    });
  }

  /**
   * Set the **complete** role set for a member (#620, extended #622) — the
   * multi-role successor to the single-role PATCH, addressed by **slug** so
   * custom roles assign through the same path as the system ones. Diffs the
   * desired set against the member's current roles (by role id) and adds/removes
   * to match. Rules preserved from #576: assigning any role requires
   * `member.role.assign`; adding or removing the system `owner`/`admin` role
   * additionally requires the caller to be an owner (OQ2). Guards: ≥1 **system**
   * role (`MEMBER_MIN_ONE_ROLE` — every member keeps a base org role, so the
   * `organization_users.role` enum mirror stays defined) and last-owner
   * (`LAST_OWNER_ROLE_REMOVAL`), both re-checked under the seat lock. Custom
   * roles are free additive grants. Audits `member.role.add` /
   * `member.role.remove` per change (post-commit, fail-open).
   */
  static async setMemberRoles(
    caller: PermissionContext,
    targetUserId: string,
    desiredSlugs: string[],
    auditCtx: SeatAuditContext
  ): Promise<{ userId: string; roles: OrgRole[]; roleSlugs: string[] }> {
    await PermissionService.check(caller, "member.role.assign");
    const orgId = caller.organizationId;
    const desiredSlugSet = [...new Set(desiredSlugs)];
    if (desiredSlugSet.length === 0) {
      throw new ApiError(
        409,
        ApiCode.MEMBER_MIN_ONE_ROLE,
        "A member must have at least one role"
      );
    }

    return SyncLockService.withSeatLock(orgId, async () => {
      const target =
        await DbService.repository.organizationUsers.findByOrganizationAndUser(
          orgId,
          targetUserId
        );
      if (!target) {
        throw new ApiError(
          404,
          ApiCode.ORGANIZATION_USER_NOT_FOUND,
          "Member not found in this organization"
        );
      }

      // Resolve the org's roles → slug/id maps; every desired slug must exist.
      const orgRoles =
        await DbService.repository.roles.findByOrganizationId(orgId);
      const bySlug = new Map(orgRoles.map((r) => [r.slug, r]));
      const byId = new Map(orgRoles.map((r) => [r.id, r]));
      const desiredRoles = desiredSlugSet.map((slug) => {
        const role = bySlug.get(slug);
        if (!role) {
          throw new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            `Unknown role slug "${slug}"`
          );
        }
        return role;
      });

      // ≥1 system role: keeps the enum mirror defined and every member anchored
      // to a base org role. Custom roles are additive on top.
      const desiredSystemNames = desiredRoles
        .filter((r) => r.kind === "system")
        .map((r) => r.name as OrgRole);
      if (desiredSystemNames.length === 0) {
        throw new ApiError(
          409,
          ApiCode.MEMBER_MIN_ONE_ROLE,
          "A member must have at least one organization role (owner, admin, or member)"
        );
      }

      // Heal a pre-cutover membership so the diff + owner count are authoritative
      // over user_role alone.
      await DbService.repository.userRole.materializeFromEnum(
        targetUserId,
        orgId,
        target.role,
        caller.userId
      );
      const baselineIds = await DbService.repository.userRole.findRoleIds(
        targetUserId,
        orgId
      );
      const baseSet = new Set(baselineIds);
      const desiredIds = desiredRoles.map((r) => r.id);
      const wantSet = new Set(desiredIds);
      const toAdd = desiredIds.filter((id) => !baseSet.has(id));
      const toRemove = baselineIds.filter((id) => !wantSet.has(id));

      if (toAdd.length === 0 && toRemove.length === 0) {
        return {
          userId: targetUserId,
          roles: desiredSystemNames,
          roleSlugs: desiredSlugSet,
        };
      }

      // OQ2: adding or removing the system owner/admin role is owner-only.
      const callerIsOwner = caller.roles.includes("owner");
      for (const id of [...toAdd, ...toRemove]) {
        const role = byId.get(id);
        if (
          role?.kind === "system" &&
          (role.name === "owner" || role.name === "admin") &&
          !callerIsOwner
        ) {
          throw new ApiError(
            403,
            ApiCode.INSUFFICIENT_ROLE,
            "Only the owner can assign or remove the owner or admin role"
          );
        }
      }

      // Last-owner: never strip the system owner role from the org's last owner.
      const ownerRole = orgRoles.find(
        (r) => r.kind === "system" && r.name === "owner"
      );
      if (ownerRole && toRemove.includes(ownerRole.id)) {
        const owners = await DbService.repository.userRole.countUsersWithRole(
          orgId,
          "owner"
        );
        if (owners <= 1) {
          throw new ApiError(
            409,
            ApiCode.LAST_OWNER_ROLE_REMOVAL,
            "Cannot remove the owner role from the organization's last owner"
          );
        }
      }

      await DbService.transaction(async (tx) => {
        for (const id of toAdd) {
          await DbService.repository.userRole.assignById(
            targetUserId,
            orgId,
            id,
            caller.userId,
            tx
          );
        }
        for (const id of toRemove) {
          await DbService.repository.userRole.removeAssignmentById(
            targetUserId,
            orgId,
            id,
            caller.userId,
            tx
          );
        }
        // Enum mirror = highest of the resulting **system** roles.
        await DbService.repository.organizationUsers.update(
          target.id,
          { role: highestRole(desiredSystemNames) },
          tx
        );
      });

      for (const id of toAdd) {
        void AuditService.record({
          organizationId: orgId,
          userId: caller.userId,
          action: "member.role.add",
          targetType: "user",
          targetId: targetUserId,
          sourceIp: auditCtx.sourceIp,
          userAgent: auditCtx.userAgent,
          metadata: { role: byId.get(id)?.slug ?? id },
        });
      }
      for (const id of toRemove) {
        void AuditService.record({
          organizationId: orgId,
          userId: caller.userId,
          action: "member.role.remove",
          targetType: "user",
          targetId: targetUserId,
          sourceIp: auditCtx.sourceIp,
          userAgent: auditCtx.userAgent,
          metadata: { role: byId.get(id)?.slug ?? id },
        });
      }

      return {
        userId: targetUserId,
        roles: desiredSystemNames,
        roleSlugs: desiredSlugSet,
      };
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  /** Find the caller's user by sub, or create it from the Auth0 profile
   *  (a brand-new invitee accepting before anything else provisioned them). */
  private static async resolveCaller(
    auth0Sub: string,
    authorizationHeader: string | undefined
  ): Promise<UserSelect> {
    const existing = await DbService.repository.users.findByAuth0Id(auth0Sub);
    if (existing) return existing;
    const profile = await Auth0Service.getAuth0UserProfile(
      Auth0Service.getAccessToken(authorizationHeader)
    );
    const { user } = await DbService.repository.users.findOrCreateByAuth0Id(
      new UserModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          auth0Id: auth0Sub,
          email: profile.email ?? null,
          name: profile.name ?? null,
          picture: profile.picture ?? null,
          lastLogin: SystemUtilities.utc.now().getTime(),
        })
        .parse()
    );
    return user;
  }

  /** Bind a user to an org as a member, or bump lastLogin if already one.
   *  Public so on-first-token provisioning (#577, self-hosted join_single_org)
   *  can reuse the same idempotent membership primitive. */
  static async attachMembership(
    userId: string,
    organizationId: string,
    role: OrganizationUserSelect["role"],
    lastLogin: number
  ): Promise<OrganizationUserSelect> {
    const existing =
      await DbService.repository.organizationUsers.findByOrganizationAndUser(
        organizationId,
        userId
      );
    if (existing) {
      const updated = await DbService.repository.organizationUsers.update(
        existing.id,
        { lastLogin }
      );
      // #620: heal a pre-cutover membership that carries only the enum role.
      await DbService.repository.userRole.materializeFromEnum(
        userId,
        organizationId,
        existing.role,
        SystemUtilities.id.system
      );
      return updated ?? existing;
    }
    const model = new OrganizationUserModelFactory().create(userId).update({
      organizationId,
      userId,
      role,
      lastLogin,
    });
    const created = await DbService.repository.organizationUsers.create(
      model.parse()
    );
    // #620: the membership's role now lives in user_role (the enum is a mirror).
    await DbService.repository.userRole.assign(
      userId,
      organizationId,
      role,
      SystemUtilities.id.system
    );
    return created;
  }

  private static async requireOrg(
    organizationId: string
  ): Promise<OrganizationSelect> {
    const org =
      await DbService.repository.organizations.findById(organizationId);
    if (!org) {
      throw new ApiError(
        404,
        ApiCode.ORGANIZATION_NOT_FOUND,
        "Organization not found"
      );
    }
    return org;
  }

  /** True if the org can admit one more seat. Must be called under the seat
   *  lock. `maxSeats === null` (tier unlimited) always admits. */
  private static async admit(orgId: string, now: number): Promise<boolean> {
    const maxSeats = await SeatService.tierMaxSeatsFor(orgId);
    if (maxSeats === null) return true;
    const members = await DbService.repository.organizationUsers.count(
      eq(organizationUsers.organizationId, orgId)
    );
    const pending = await DbService.repository.invitations.countPendingActive(
      orgId,
      now
    );
    return members + pending < maxSeats;
  }

  /** The org's tier seat entitlement. Fail-closed: an unresolvable org/tier
   *  throws (deny the invite) rather than returning "unlimited". A resolved
   *  tier's `maxSeats` of null legitimately means unlimited. */
  private static async tierMaxSeatsFor(orgId: string): Promise<number | null> {
    const org = await DbService.repository.organizations.findById(orgId);
    if (!org?.tier) {
      logger.error({ orgId }, "Cannot resolve org tier for seat cap");
      throw new ApiError(
        500,
        ApiCode.SEAT_LIMIT_EXCEEDED,
        "Unable to resolve the organization's seat entitlement"
      );
    }
    const tier = await DbService.repository.tiers.findBySlug(org.tier);
    if (!tier) {
      logger.error({ orgId, tier: org.tier }, "Org tier row not found");
      throw new ApiError(
        500,
        ApiCode.SEAT_LIMIT_EXCEEDED,
        "Unable to resolve the organization's seat entitlement"
      );
    }
    return tier.maxSeats;
  }

  /** Load a pending invitation that belongs to the caller's org, or 404. */
  private static async requirePending(
    caller: PermissionContext,
    invitationId: string
  ): Promise<InvitationSelect> {
    const inv = await DbService.repository.invitations.findById(invitationId);
    if (
      !inv ||
      inv.organizationId !== caller.organizationId ||
      inv.status !== "pending"
    ) {
      throw new ApiError(
        404,
        ApiCode.INVITATION_NOT_FOUND,
        "No pending invitation with that id"
      );
    }
    return inv;
  }

  private static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private static ttlMs(): number {
    return environment.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  private static inviteUrl(token: string): string {
    return `${environment.WEB_APP_URL}/invitations/accept?token=${token}`;
  }

  /** Strip `tokenHash` (never exposed) and attach a transient `inviteUrl`. */
  private static toResponse(
    inv: InvitationSelect,
    inviteUrl?: string
  ): InvitationResponse {
    const { tokenHash: _tokenHash, ...rest } = inv;
    return inviteUrl ? { ...rest, inviteUrl } : rest;
  }
}
