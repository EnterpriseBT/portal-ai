import { eq, and, ne, inArray, isNull } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { SeedService } from "./seed.service.js";
import { wideTableReconcilerService } from "./wide-table-reconciler.service.js";
import {
  apiEndpointConfigs,
  entityGroupMembers,
  entityTagAssignments,
  entityRecords,
  fieldMappings,
  connectorEntities,
  connectorInstanceLayoutPlans,
  connectorInstances,
  entityGroups,
  entityTags,
  columnDefinitions,
  jobs,
  organizations,
  organizationUsers,
  portalResults,
  portalMessages,
  portals,
  stationToolpacks,
  stationInstances,
  stations,
  wideTableColumns,
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
 *
 * Also drops each connector entity's dynamic `er__<id>` wide table — the
 * reconciler recreates them on demand, and leaving them behind orphans
 * tables full of stale rows once their `connector_entities` row is gone.
 *
 * The org it hands back is equivalent to a freshly-provisioned one: the
 * system column definitions `ApplicationService` seeds at provisioning
 * time are re-seeded after the cascade.
 */
export class ResetService {
  /**
   * Hard-delete all data for an organization except the org, its owner, and the owner's membership.
   * Deletions are performed in FK-safe order within a single transaction.
   */
  static async resetOrganization(organizationId: string): Promise<void> {
    const org =
      await DbService.repository.organizations.findById(organizationId);
    if (!org) {
      throw new Error(`Organization not found: ${organizationId}`);
    }

    logger.info(
      { organizationId, orgName: org.name },
      "Resetting organization workspace"
    );

    await DbService.transaction(async (tx) => {
      // Delete in child → parent order to respect FK constraints.
      //
      // This order is mirrored — deliberately, not shared — by
      // `OrganizationDeleteService.cascade`, which extends it to full
      // coverage plus the tombstones. Keep the two in step: anything
      // added here that a delete must also cover belongs there too.

      // Wide tables first: `wide_table_columns` FKs field_mappings,
      // connector_entities AND column_definitions, so its rows must go
      // before all three. `dropTable` drops the physical `er__<id>`
      // table (created by the reconciler, not by a migration — leaving
      // it behind orphans it once its entity row goes) and clears the
      // entity's catalog rows; the org-wide sweep after catches rows
      // belonging to already-soft-deleted entities.
      const liveEntityRows = await tx
        .select({ id: connectorEntities.id })
        .from(connectorEntities)
        .where(
          and(
            eq(connectorEntities.organizationId, organizationId),
            isNull(connectorEntities.deleted)
          )
        );
      for (const { id } of liveEntityRows) {
        await wideTableReconcilerService.dropTable(id, tx);
      }
      logger.info(`Dropped ${liveEntityRows.length} er__ wide tables`);

      const deletedWideTableColumns = await tx
        .delete(wideTableColumns)
        .where(eq(wideTableColumns.organizationId, organizationId))
        .returning({ id: wideTableColumns.id });
      logger.info(
        `Deleted ${deletedWideTableColumns.length} wide table columns`
      );

      const deletedEntityGroupMembers = await tx
        .delete(entityGroupMembers)
        .where(eq(entityGroupMembers.organizationId, organizationId))
        .returning({ id: entityGroupMembers.id });
      logger.info(
        `Deleted ${deletedEntityGroupMembers.length} entity group members`
      );

      const deletedEntityTagAssignments = await tx
        .delete(entityTagAssignments)
        .where(eq(entityTagAssignments.organizationId, organizationId))
        .returning({ id: entityTagAssignments.id });
      logger.info(
        `Deleted ${deletedEntityTagAssignments.length} entity tag assignments`
      );

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

      const deletedPortalResults = await tx
        .delete(portalResults)
        .where(eq(portalResults.organizationId, organizationId))
        .returning({ id: portalResults.id });
      logger.info(`Deleted ${deletedPortalResults.length} portal results`);

      const deletedPortalMessages = await tx
        .delete(portalMessages)
        .where(eq(portalMessages.organizationId, organizationId))
        .returning({ id: portalMessages.id });
      logger.info(`Deleted ${deletedPortalMessages.length} portal messages`);

      const deletedPortals = await tx
        .delete(portals)
        .where(eq(portals.organizationId, organizationId))
        .returning({ id: portals.id });
      logger.info(`Deleted ${deletedPortals.length} portals`);

      // station_toolpacks and station_instances are join tables without organizationId —
      // delete by matching stationId against org-scoped stations
      const orgStationIds = tx
        .select({ id: stations.id })
        .from(stations)
        .where(eq(stations.organizationId, organizationId));

      const deletedStationToolpacks = await tx
        .delete(stationToolpacks)
        .where(inArray(stationToolpacks.stationId, orgStationIds))
        .returning({ id: stationToolpacks.id });
      logger.info(
        `Deleted ${deletedStationToolpacks.length} station toolpacks`
      );

      const deletedStationInstances = await tx
        .delete(stationInstances)
        .where(inArray(stationInstances.stationId, orgStationIds))
        .returning({ id: stationInstances.id });
      logger.info(
        `Deleted ${deletedStationInstances.length} station instances`
      );

      await tx
        .update(organizations)
        .set({ defaultStationId: null })
        .where(eq(organizations.id, organizationId));
      logger.info("Reset defaultStationId to null");

      const deletedStations = await tx
        .delete(stations)
        .where(eq(stations.organizationId, organizationId))
        .returning({ id: stations.id });
      logger.info(`Deleted ${deletedStations.length} stations`);

      // Indirectly scoped: layout plans hang off the org's instances and
      // carry no organizationId of their own.
      const orgInstanceIds = tx
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId));

      const deletedLayoutPlans = await tx
        .delete(connectorInstanceLayoutPlans)
        .where(
          inArray(
            connectorInstanceLayoutPlans.connectorInstanceId,
            orgInstanceIds
          )
        )
        .returning({ id: connectorInstanceLayoutPlans.id });
      logger.info(
        `Deleted ${deletedLayoutPlans.length} connector instance layout plans`
      );

      const deletedApiEndpointConfigs = await tx
        .delete(apiEndpointConfigs)
        .where(eq(apiEndpointConfigs.organizationId, organizationId))
        .returning({ id: apiEndpointConfigs.id });
      logger.info(
        `Deleted ${deletedApiEndpointConfigs.length} API endpoint configs`
      );

      const deletedConnectorEntities = await tx
        .delete(connectorEntities)
        .where(eq(connectorEntities.organizationId, organizationId))
        .returning({ id: connectorEntities.id });
      logger.info(
        `Deleted ${deletedConnectorEntities.length} connector entities`
      );

      const deletedConnectorInstances = await tx
        .delete(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId))
        .returning({ id: connectorInstances.id });
      logger.info(
        `Deleted ${deletedConnectorInstances.length} connector instances`
      );

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
      logger.info(
        `Deleted ${deletedColumnDefinitions.length} column definitions`
      );

      // Put the system column definitions back. `ApplicationService` seeds
      // them at org-provisioning time, so an org that keeps its row must
      // keep them too — otherwise reset hands back an org the app can
      // never otherwise produce, missing scaffolding a fresh org has.
      //
      // Re-seeded rather than spared by a `system = false` predicate: the
      // upsert is keyed and idempotent, so this also repairs orgs that an
      // earlier reset already stripped.
      await new SeedService().seedSystemColumnDefinitions(organizationId, tx);
      logger.info("Re-seeded system column definitions");

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
      logger.info(
        `Deleted ${deletedOrgUsers.length} non-owner organization users`
      );
    });

    logger.info(
      { organizationId, orgName: org.name },
      "Organization workspace reset complete"
    );
  }

  /**
   * Reset the first organization found in the database.
   * Convenience method for local dev when there's typically one org.
   */
  static async resetFirst(): Promise<void> {
    const orgs = await DbService.repository.organizations.findMany(undefined, {
      limit: 1,
    });
    if (orgs.length === 0) {
      throw new Error("No organizations found in the database");
    }
    await ResetService.resetOrganization(orgs[0].id);
  }
}
