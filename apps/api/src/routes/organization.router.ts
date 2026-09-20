import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import { PermissionService } from "../services/permission.service.js";
import { TierService } from "../services/tier.service.js";
import { UsageService } from "../services/usage.service.js";
import type {
  OrganizationDeleteResponse,
  OrganizationGetResponse,
  OrganizationUsageGetResponse,
  UsageLedgerListResponse,
  AuditLogListResponse,
  UserMembershipsGetResponse,
  MemberRoleUpdateResponse,
  InvitationResponse,
  InvitationListResponse,
  MemberListResponse,
  AcceptInvitationResponse,
} from "@portalai/core/contracts";
import {
  OrganizationDeleteRequestSchema,
  OrganizationSwitchRequestSchema,
  UsageLedgerListRequestQuerySchema,
  AuditLogListRequestQuerySchema,
  MemberRoleUpdateRequestSchema,
  InviteCreateRequestSchema,
  AcceptInvitationRequestSchema,
} from "@portalai/core/contracts";
import { SeatService } from "../services/seat.service.js";
import {
  TOOL_USAGE_LEDGER_SORT_KEYS,
  type ToolUsageLedgerSortBy,
} from "../db/repositories/tool-usage-ledger.repository.js";
import {
  AUDIT_LOG_SORT_KEYS,
  type AuditLogSortBy,
} from "../db/repositories/audit-log.repository.js";
import { OrganizationDeleteService } from "../services/organization-delete.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { AuditService } from "../services/audit.service.js";
import { auditContextFromRequest } from "../utils/audit-context.util.js";

const logger = createLogger({ module: "organization" });

export const organizationRouter = Router();

/**
 * @openapi
 * /api/organization/current:
 *   get:
 *     tags:
 *       - Organization
 *     summary: Get current organization
 *     description: Returns the authenticated user's most recently logged-into organization, determined by the latest lastLogin timestamp on the organization_users join record.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current organization retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/OrganizationGetResponse'
 *       404:
 *         description: User or organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
/**
 * @openapi
 * /api/organization/{id}:
 *   patch:
 *     tags:
 *       - Organization
 *     summary: Update organization settings
 *     description: Updates organization fields. Currently supports setting defaultStationId.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               defaultStationId:
 *                 type: [string, "null"]
 *     responses:
 *       200:
 *         description: Organization updated
 *       404:
 *         description: Organization or station not found
 *       500:
 *         description: Internal server error
 */
organizationRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      // Only allow users to update their current org
      if (id !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "Organization not found"
          )
        );
      }

      const { defaultStationId } = req.body as {
        defaultStationId?: string | null;
      };

      if (defaultStationId !== undefined && defaultStationId !== null) {
        // Validate the station belongs to this org
        const station =
          await DbService.repository.stations.findById(defaultStationId);
        if (!station || station.organizationId !== organizationId) {
          return next(
            new ApiError(
              404,
              ApiCode.STATION_NOT_FOUND,
              "Station not found or does not belong to this organization"
            )
          );
        }
      }

      const organization = await DbService.repository.organizations.update(id, {
        defaultStationId: defaultStationId ?? null,
        updated: Date.now(),
        updatedBy: userId,
      } as never);

      return HttpService.success(res, { organization });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to update organization"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to update organization"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/{id}:
 *   delete:
 *     tags:
 *       - Organization
 *     summary: Permanently delete the organization (owner only)
 *     description: >
 *       Deletes the caller's current organization and all of its data (#197).
 *       Owner-only, gated by a server-verified type-to-confirm — the body's
 *       `confirmationName` must match the organization's name (trimmed,
 *       case-sensitive). All org content is hard-deleted (including dynamic
 *       wide tables and uploaded S3 objects); the organization row and its
 *       memberships are soft-deleted as an audit tombstone; usage-ledger rows
 *       are retained. Queued jobs are auto-cancelled; an active job blocks
 *       the delete with 409.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrganizationDeleteRequest'
 *     responses:
 *       200:
 *         description: Organization deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/OrganizationDeleteResponse'
 *       400:
 *         description: Invalid payload, or confirmationName does not match the organization name
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: The caller is not the organization's owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Organization not found (not the caller's current org, or already deleted)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: An active job holds the organization; details.runningJobs lists it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.delete(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      // Current-org guard first (mirrors PATCH /:id): a foreign org id gets
      // 404 before any owner logic runs, so org existence never leaks.
      if (id !== organizationId) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "Organization not found"
          )
        );
      }

      const parsed = OrganizationDeleteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "confirmationName is required"
          )
        );
      }

      const organization =
        await DbService.repository.organizations.findById(id);
      if (!organization) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "Organization not found"
          )
        );
      }

      // Owner-only (#576). Throws INSUFFICIENT_ROLE-mapped ORGANIZATION_NOT_OWNER
      // for a non-owner (admin included — org deletion is owner-exclusive); the
      // outer catch forwards it.
      await PermissionService.check(req.application!.metadata, "org.delete");

      if (parsed.data.confirmationName.trim() !== organization.name.trim()) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_CONFIRMATION_MISMATCH,
            "The confirmation name does not match the organization name"
          )
        );
      }

      logger.info(
        { organizationId: id, orgName: organization.name, userId },
        "Organization delete requested"
      );

      await OrganizationDeleteService.deleteOrganization(id, userId);

      // #575: audit the destructive action (post-commit, fail-open). The org
      // row is soft-deleted (tombstone), so the audit row — retained past the
      // tombstone — is the durable record that the deletion happened.
      void AuditService.record({
        ...auditContextFromRequest(req),
        action: "org.delete",
        targetType: "organization",
        targetId: id,
        metadata: { name: organization.name },
      });

      return HttpService.success<OrganizationDeleteResponse>(res, { id });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to delete organization"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_DELETE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to delete organization"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/members/{userId}/role:
 *   patch:
 *     summary: Assign a member's role in the current organization
 *     description: >
 *       Owner and admin may assign the `member` role. Only the **owner** may
 *       mint or remove an `admin`; the `owner` role itself is immutable here
 *       (ownership transfer is out of scope). Emits `member.role.change` (#576).
 *     tags:
 *       - Organization
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The internal user id of the member whose role is changing.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MemberRoleUpdateRequest'
 *     responses:
 *       200:
 *         description: Role updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MemberRoleUpdateResponse'
 *       400:
 *         description: Invalid payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Caller's role may not assign this role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Member not found in this organization
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.patch(
  "/members/:userId/role",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const targetUserId = req.params.userId;

      const parsed = MemberRoleUpdateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "role is required and must be one of owner|admin|member"
          )
        );
      }
      const newRole = parsed.data.role;

      // Base authz: owner + admin may assign roles; members may not.
      await PermissionService.check(ctx, "member.role.assign");

      const target =
        await DbService.repository.organizationUsers.findByOrganizationAndUser(
          ctx.organizationId,
          targetUserId
        );
      if (!target) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "Member not found in this organization"
          )
        );
      }

      // The owner role is immutable via this endpoint — minting or removing an
      // owner is ownership transfer, out of scope for #576.
      if (newRole === "owner" || target.role === "owner") {
        return next(
          new ApiError(
            403,
            ApiCode.INSUFFICIENT_ROLE,
            "The owner role can only change through ownership transfer"
          )
        );
      }

      // OQ2: only the owner may mint or remove an `admin`.
      if (
        (newRole === "admin" || target.role === "admin") &&
        ctx.role !== "owner"
      ) {
        return next(
          new ApiError(
            403,
            ApiCode.INSUFFICIENT_ROLE,
            "Only the owner can assign or remove the admin role"
          )
        );
      }

      if (target.role === newRole) {
        return HttpService.success<MemberRoleUpdateResponse>(res, {
          member: target,
        });
      }

      const updated = await DbService.repository.organizationUsers.update(
        target.id,
        {
          role: newRole,
        }
      );

      // #575/#576: audit the role change (post-commit, fail-open).
      void AuditService.record({
        ...auditContextFromRequest(req),
        action: "member.role.change",
        targetType: "user",
        targetId: targetUserId,
        metadata: { from: target.role, to: newRole },
      });

      return HttpService.success<MemberRoleUpdateResponse>(res, {
        member: updated ?? { ...target, role: newRole },
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to assign role"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/invitations:
 *   post:
 *     summary: Invite a user to the organization (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InviteCreateRequest'
 *     responses:
 *       200:
 *         description: The created invitation, incl. a one-time inviteUrl
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationResponse'
 *       403:
 *         description: Caller's role may not invite
 *       409:
 *         description: Already a member, already invited, or seat limit reached
 */
organizationRouter.post(
  "/invitations",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const parsed = InviteCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "email (valid) and role (member|admin) are required"
          )
        );
      }
      const audit = auditContextFromRequest(req);
      const invitation = await SeatService.invite(ctx, parsed.data, {
        sourceIp: audit.sourceIp,
        userAgent: audit.userAgent,
      });
      return HttpService.success<InvitationResponse>(res, invitation);
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to invite"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/invitations:
 *   get:
 *     summary: List the organization's pending invitations (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Pending invitations
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationListResponse'
 */
organizationRouter.get(
  "/invitations",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitations = await SeatService.listInvitations(
        req.application!.metadata
      );
      return HttpService.success<InvitationListResponse>(res, { invitations });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to list invitations"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/invitations/{id}/revoke:
 *   post:
 *     summary: Revoke a pending invitation (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The revoked invitation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationResponse'
 *       404:
 *         description: No pending invitation with that id
 */
organizationRouter.post(
  "/invitations/:id/revoke",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audit = auditContextFromRequest(req);
      const invitation = await SeatService.revoke(
        req.application!.metadata,
        req.params.id,
        { sourceIp: audit.sourceIp, userAgent: audit.userAgent }
      );
      return HttpService.success<InvitationResponse>(res, invitation);
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to revoke"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/invitations/{id}/resend:
 *   post:
 *     summary: Rotate the token + extend expiry on a pending invitation (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The refreshed invitation, incl. a new one-time inviteUrl
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationResponse'
 *       404:
 *         description: No pending invitation with that id
 */
organizationRouter.post(
  "/invitations/:id/resend",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audit = auditContextFromRequest(req);
      const invitation = await SeatService.resend(
        req.application!.metadata,
        req.params.id,
        { sourceIp: audit.sourceIp, userAgent: audit.userAgent }
      );
      return HttpService.success<InvitationResponse>(res, invitation);
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to resend"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/members:
 *   get:
 *     summary: List the organization's members (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Members
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MemberListResponse'
 */
organizationRouter.get(
  "/members",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.application!.metadata;
      const [members, seatUsage] = await Promise.all([
        SeatService.listMembers(ctx),
        SeatService.seatUsage(ctx),
      ]);
      return HttpService.success<MemberListResponse>(res, {
        members,
        seatUsage,
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to list members"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/invitations/accept:
 *   post:
 *     summary: Accept an invitation by token (any authenticated user)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AcceptInvitationRequest'
 *     responses:
 *       200:
 *         description: The invited org + the caller's role in it
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AcceptInvitationResponse'
 *       404:
 *         description: No valid invitation for that token
 *       410:
 *         description: The invitation has expired
 */
organizationRouter.post(
  "/invitations/accept",
  // jwtCheck only (mounted on the router) — NOT getApplicationMetadata: the
  // accepter may have no current org yet, and binding the membership here is
  // what gives them one.
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string | undefined;
      if (!auth0Id) {
        return next(
          new ApiError(
            401,
            ApiCode.METADATA_MISSING_AUTH,
            "Missing authentication subject"
          )
        );
      }
      const parsed = AcceptInvitationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "token is required"
          )
        );
      }

      const audit = auditContextFromRequest(req);
      const result = await SeatService.acceptByToken(
        auth0Id,
        req.headers.authorization,
        parsed.data.token,
        { sourceIp: audit.sourceIp, userAgent: audit.userAgent }
      );
      return HttpService.success<AcceptInvitationResponse>(res, result);
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to accept"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/members/{userId}:
 *   delete:
 *     summary: Remove a member from the organization (owner/admin)
 *     tags: [Organization]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Member removed
 *       403:
 *         description: Caller's role may not remove members
 *       404:
 *         description: Member not found in this organization
 *       409:
 *         description: Cannot remove the last owner
 */
organizationRouter.delete(
  "/members/:userId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audit = auditContextFromRequest(req);
      await SeatService.removeMember(
        req.application!.metadata,
        req.params.userId,
        { sourceIp: audit.sourceIp, userAgent: audit.userAgent }
      );
      res.status(204).send();
      return;
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error ? error.message : "Failed to remove member"
            )
      );
    }
  }
);

organizationRouter.get(
  "/current",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string;
      logger.info({ auth0Id }, "GET /api/organization/current called");

      const user = await DbService.repository.users
        .findByAuth0Id(auth0Id)
        .catch((error) => {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            500,
            ApiCode.ORGANIZATION_FETCH_FAILED,
            error instanceof Error ? error.message : "Failed to fetch user"
          );
        });
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const result = await ApplicationService.getCurrentOrganization(
        user.id
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          500,
          ApiCode.ORGANIZATION_FETCH_FAILED,
          error instanceof Error
            ? error.message
            : "Failed to fetch current organization"
        );
      });
      if (!result) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "No organization found for user"
          )
        );
      }

      return HttpService.success<OrganizationGetResponse>(res, {
        organization: result.organization,
        role: result.organizationUser.role,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch current organization"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch current organization"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/memberships:
 *   get:
 *     tags:
 *       - Organization
 *     summary: List the caller's organization memberships
 *     description: Returns every organization the authenticated user is a live member of, each flagged `isCurrent` if it is the org currently resolved for the user (the org switcher's data source).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Memberships retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserMembershipsGetResponse'
 *       404:
 *         description: User not found
 */
organizationRouter.get(
  "/memberships",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string;
      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }
      const memberships = await ApplicationService.listUserMemberships(user.id);
      return HttpService.success<UserMembershipsGetResponse>(res, {
        memberships,
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to list memberships"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/switch:
 *   post:
 *     tags:
 *       - Organization
 *     summary: Switch the caller's current organization
 *     description: Makes the given organization the authenticated user's current one (by bumping the membership's last-login recency). The user must hold a live membership in the target org, otherwise 403.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrganizationSwitchRequest'
 *     responses:
 *       200:
 *         description: Switched; returns the new current organization
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrganizationGetResponse'
 *       403:
 *         description: The user is not a member of the target organization
 *       404:
 *         description: User not found
 */
organizationRouter.post(
  "/switch",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = OrganizationSwitchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.ORGANIZATION_INVALID_PAYLOAD,
            "organizationId is required"
          )
        );
      }

      const auth0Id = req.auth?.payload.sub as string;
      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const result = await ApplicationService.switchOrganization(
        user.id,
        parsed.data.organizationId
      );

      // #575: record under the org switched INTO (this route runs without
      // getApplicationMetadata, so build the context by hand). Post-commit,
      // fail-open.
      void AuditService.record({
        userId: user.id,
        organizationId: result.organization.id,
        action: "member.switch",
        targetType: "organization",
        targetId: result.organization.id,
        sourceIp: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      });

      return HttpService.success<OrganizationGetResponse>(res, {
        organization: result.organization,
        role: result.role,
      });
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to switch organization"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/usage:
 *   get:
 *     tags:
 *       - Organization
 *     summary: Get current organization tier + usage balance
 *     description: Returns the caller's current organization's resolved subscription tier policy and its current billing-period usage balance (units used and available per cost class). `available` is null for an unlimited class.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tier + usage balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/OrganizationUsageGetResponse'
 *       404:
 *         description: User or organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.get(
  "/usage",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth0Id = req.auth?.payload.sub as string;

      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_USER_NOT_FOUND,
            "User not found"
          )
        );
      }

      const result = await ApplicationService.getCurrentOrganization(user.id);
      if (!result) {
        return next(
          new ApiError(
            404,
            ApiCode.ORGANIZATION_NOT_FOUND,
            "No organization found for user"
          )
        );
      }

      const tier = await TierService.resolveTier(result.organization);
      const usage = await UsageService.getBalance(
        result.organization,
        tier,
        new Date()
      );

      return HttpService.success<OrganizationUsageGetResponse>(res, {
        tier,
        usage,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch organization usage"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch organization usage"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/usage/ledger:
 *   get:
 *     tags:
 *       - Organization
 *     summary: List the current organization's itemized tool-usage ledger
 *     description: Paginated, per-call itemization behind the aggregate usage balance (#179). One row per committed charge; newest-first by default. Filterable by billing period and tool name.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created, units, toolName]
 *           default: created
 *         description: Field to sort by (allow-map; unknown values are a 400)
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort direction (defaults newest-first)
 *       - in: query
 *         name: periodId
 *         schema:
 *           type: string
 *         description: Billing period to filter by (e.g. 2026-07)
 *       - in: query
 *         name: toolName
 *         schema:
 *           type: string
 *         description: Tool name to filter by (exact match)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive substring search on the tool name
 *     responses:
 *       200:
 *         description: One page of ledger entries + the filter-scoped total
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/UsageLedgerListResponse'
 *       400:
 *         description: Malformed query (unknown sortBy or bad pagination)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Missing authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: User or organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.get(
  "/usage/ledger",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UsageLedgerListRequestQuerySchema.safeParse(req.query);
      if (
        !parsed.success ||
        !TOOL_USAGE_LEDGER_SORT_KEYS.includes(
          parsed.data.sortBy as ToolUsageLedgerSortBy
        )
      ) {
        return next(
          new ApiError(
            400,
            ApiCode.USAGE_LEDGER_INVALID_QUERY,
            "Invalid usage-ledger query"
          )
        );
      }
      const query = parsed.data;

      const { entries, total } =
        await DbService.repository.toolUsageLedger.findPage(
          req.application?.metadata.organizationId as string,
          {
            periodId: query.periodId,
            toolName: query.toolName,
            search: query.search,
            limit: query.limit,
            offset: query.offset,
            sortBy: query.sortBy as ToolUsageLedgerSortBy,
            sortOrder: query.sortOrder,
          }
        );

      return HttpService.success<UsageLedgerListResponse>(res, {
        entries,
        total,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch usage ledger"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.USAGE_LEDGER_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch usage ledger"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/organization/audit-log:
 *   get:
 *     tags:
 *       - Organization
 *     summary: List the current organization's security audit log
 *     description: Paginated, tamper-evident trail of security-relevant actions (#575) — logins, org/member changes, credential create/update/use, secret rotation, data export/delete. Newest-first by default; filterable by action and outcome. Owner-gated (widens to role='admin' with #576).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created]
 *           default: created
 *         description: Field to sort by (allow-map; unknown values are a 400)
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort direction (defaults newest-first)
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Audit action to filter by (exact match; unknown values are a 400)
 *       - in: query
 *         name: outcome
 *         schema:
 *           type: string
 *           enum: [success, failure]
 *         description: Outcome to filter by
 *     responses:
 *       200:
 *         description: One page of audit-log entries + the filter-scoped total
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/AuditLogListResponse'
 *       400:
 *         description: Malformed query (unknown sortBy/action or bad pagination)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Missing authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Caller is not the organization's owner
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: User or organization not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
organizationRouter.get(
  "/audit-log",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AuditLogListRequestQuerySchema.safeParse(req.query);
      if (
        !parsed.success ||
        !AUDIT_LOG_SORT_KEYS.includes(parsed.data.sortBy as AuditLogSortBy)
      ) {
        return next(
          new ApiError(
            400,
            ApiCode.AUDIT_LOG_INVALID_QUERY,
            "Invalid audit-log query"
          )
        );
      }
      const query = parsed.data;

      const organizationId = req.application?.metadata.organizationId as string;

      // Audit trail is owner + admin (#576 widened this from owner-only).
      // Throws INSUFFICIENT_ROLE for a member; the outer catch forwards it.
      await PermissionService.check(
        req.application!.metadata,
        "org.audit.read"
      );

      const { entries, total } = await DbService.repository.auditLog.findPage(
        organizationId,
        {
          action: query.action,
          outcome: query.outcome,
          limit: query.limit,
          offset: query.offset,
          sortBy: query.sortBy as AuditLogSortBy,
          sortOrder: query.sortOrder,
        }
      );

      return HttpService.success<AuditLogListResponse>(res, {
        entries,
        total,
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch audit log"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.AUDIT_LOG_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to fetch audit log"
            )
      );
    }
  }
);
