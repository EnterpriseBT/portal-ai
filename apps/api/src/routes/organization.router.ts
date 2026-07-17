import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import { TierService } from "../services/tier.service.js";
import { UsageService } from "../services/usage.service.js";
import type {
  OrganizationDeleteResponse,
  OrganizationGetResponse,
  OrganizationUsageGetResponse,
  UsageLedgerListResponse,
  UserMembershipsGetResponse,
} from "@portalai/core/contracts";
import {
  OrganizationDeleteRequestSchema,
  OrganizationSwitchRequestSchema,
  UsageLedgerListRequestQuerySchema,
} from "@portalai/core/contracts";
import {
  TOOL_USAGE_LEDGER_SORT_KEYS,
  type ToolUsageLedgerSortBy,
} from "../db/repositories/tool-usage-ledger.repository.js";
import { OrganizationDeleteService } from "../services/organization-delete.service.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

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
 *                   type: object
 *                   properties:
 *                     organization:
 *                       $ref: '#/components/schemas/Organization'
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
 *                 type: string
 *                 nullable: true
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

      if (organization.ownerUserId !== userId) {
        return next(
          new ApiError(
            403,
            ApiCode.ORGANIZATION_NOT_OWNER,
            "Only the organization's owner can delete it"
          )
        );
      }

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
      return HttpService.success<OrganizationGetResponse>(res, {
        organization: result.organization,
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
 *         description: Tool name to filter by
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
