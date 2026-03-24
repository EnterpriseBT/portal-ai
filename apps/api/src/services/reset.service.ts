import { eq, and, ne } from "drizzle-orm";

import { DbService } from "./db.service.js";
import {
  entityGroupMembers,
  entityTagAssignments,
  entityRecords,
  fieldMappings,
  connectorEntities,
  connectorInstances,
  entityGroups,
  entityTags,
  columnDefinitions,
  jobs,
  organizationUsers,
} from "../db/schema/index.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "reset" });

/**
 * Service for resetting an organization's workspace data in local dev.
 *
 * Hard-deletes all org-scoped records **except**:
 * - The organization itself
 * - The owner user
 * - The owner's organization_users join record
 */
export class ResetService {
  /**
   * Hard-delete all data for an organization except the org, its owner, and the owner's membership.
   * Deletions are performed in FK-safe order within a single transaction.
   */
  static async resetOrganization(organizationId: string): Promise<void> {
    const org = await DbService.repository.organizations.findById(organizationId);
    if (!org) {
      throw new Error(`Organization not found: ${organizationId}`);
    }

    logger.info({ organizationId, orgName: org.name }, "Resetting organization workspace");

    await DbService.transaction(async (tx) => {
      // Delete in child → parent order to respect FK constraints

      const deletedEntityGroupMembers = await tx
        .delete(entityGroupMembers)
        .where(eq(entityGroupMembers.organizationId, organizationId))
        .returning({ id: entityGroupMembers.id });
      logger.info(`Deleted ${deletedEntityGroupMembers.length} entity group members`);

      const deletedEntityTagAssignments = await tx
        .delete(entityTagAssignments)
        .where(eq(entityTagAssignments.organizationId, organizationId))
        .returning({ id: entityTagAssignments.id });
      logger.info(`Deleted ${deletedEntityTagAssignments.length} entity tag assignments`);

      const deletedEntityRecords = await tx
        .delete(entityRecords)
        .where(eq(entityRecords.organizationId, organizationId))
        .returning({ id: entityRecords.id });
      logger.info(`Deleted ${deletedEntityRecords.length} entity records`);

      const deletedFieldMappings = await tx
        .delete(fieldMappings)
        .where(eq(fieldMappings.organizationId, organizationId))
        .returning({ id: fieldMappings.id });
      logger.info(`Deleted ${deletedFieldMappings.length} field mappings`);

      const deletedConnectorEntities = await tx
        .delete(connectorEntities)
        .where(eq(connectorEntities.organizationId, organizationId))
        .returning({ id: connectorEntities.id });
      logger.info(`Deleted ${deletedConnectorEntities.length} connector entities`);

      const deletedConnectorInstances = await tx
        .delete(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId))
        .returning({ id: connectorInstances.id });
      logger.info(`Deleted ${deletedConnectorInstances.length} connector instances`);

      const deletedEntityGroups = await tx
        .delete(entityGroups)
        .where(eq(entityGroups.organizationId, organizationId))
        .returning({ id: entityGroups.id });
      logger.info(`Deleted ${deletedEntityGroups.length} entity groups`);

      const deletedEntityTags = await tx
        .delete(entityTags)
        .where(eq(entityTags.organizationId, organizationId))
        .returning({ id: entityTags.id });
      logger.info(`Deleted ${deletedEntityTags.length} entity tags`);

      const deletedColumnDefinitions = await tx
        .delete(columnDefinitions)
        .where(eq(columnDefinitions.organizationId, organizationId))
        .returning({ id: columnDefinitions.id });
      logger.info(`Deleted ${deletedColumnDefinitions.length} column definitions`);

      const deletedJobs = await tx
        .delete(jobs)
        .where(eq(jobs.organizationId, organizationId))
        .returning({ id: jobs.id });
      logger.info(`Deleted ${deletedJobs.length} jobs`);

      // Delete non-owner organization_users (keep the owner's membership)
      const deletedOrgUsers = await tx
        .delete(organizationUsers)
        .where(
          and(
            eq(organizationUsers.organizationId, organizationId),
            ne(organizationUsers.userId, org.ownerUserId)
          )
        )
        .returning({ id: organizationUsers.id });
      logger.info(`Deleted ${deletedOrgUsers.length} non-owner organization users`);
    });

    logger.info({ organizationId, orgName: org.name }, "Organization workspace reset complete");
  }

  /**
   * Reset the first organization found in the database.
   * Convenience method for local dev when there's typically one org.
   */
  static async resetFirst(): Promise<void> {
    const orgs = await DbService.repository.organizations.findMany(undefined, { limit: 1 });
    if (orgs.length === 0) {
      throw new Error("No organizations found in the database");
    }
    await ResetService.resetOrganization(orgs[0].id);
  }
}
