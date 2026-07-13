/**
 * Repository for the `api_endpoint_configs` table.
 *
 * One row per `connector_entity` belonging to a `rest-api` connector
 * instance. The repository exposes the joined read path used by every
 * REST API connector route and the helpers that keep the entity row +
 * config row in lockstep (created together, soft-deleted together).
 *
 * Phase 1: GET / POST only, pagination = 'none'. Phase 3 widens both via
 * the CHECK constraint relaxation and the Zod pagination union.
 */

import { eq, and, inArray, isNull } from "drizzle-orm";

import { apiEndpointConfigs, connectorEntities } from "../schema/index.js";
import type {
  ApiEndpointConfigSelect,
  ApiEndpointConfigInsert,
  ConnectorEntitySelect,
} from "../schema/zod.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import { SystemUtilities } from "../../utils/system.util.js";

/** Joined `(connector_entity, api_endpoint_config)` pair. */
export interface ApiEndpoint {
  entity: ConnectorEntitySelect;
  config: ApiEndpointConfigSelect;
}

/** Inline endpoint config payload accepted by `createWithEntity`. */
export interface CreateApiEndpointInput {
  organizationId: string;
  connectorInstanceId: string;
  key: string;
  label: string;
  config: Omit<
    ApiEndpointConfigInsert,
    | "id"
    | "created"
    | "createdBy"
    | "updated"
    | "updatedBy"
    | "deleted"
    | "deletedBy"
    | "organizationId"
    | "connectorEntityId"
  >;
}

/** Patch payload for `updateConfig` — none of the immutable columns. */
export type UpdateApiEndpointConfigPatch = Partial<
  Omit<
    ApiEndpointConfigInsert,
    | "id"
    | "created"
    | "createdBy"
    | "updated"
    | "updatedBy"
    | "deleted"
    | "deletedBy"
    | "organizationId"
    | "connectorEntityId"
  >
>;

export class ApiEndpointsRepository extends Repository<
  typeof apiEndpointConfigs,
  ApiEndpointConfigSelect,
  ApiEndpointConfigInsert
> {
  constructor() {
    super(apiEndpointConfigs);
  }

  /**
   * Joined live (non-soft-deleted) endpoints under a connector instance,
   * ordered by `connector_entities.created` ASC.
   */
  async findByInstance(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<ApiEndpoint[]> {
    const rows = await (client as typeof db)
      .select({ entity: connectorEntities, config: apiEndpointConfigs })
      .from(apiEndpointConfigs)
      .innerJoin(
        connectorEntities,
        eq(apiEndpointConfigs.connectorEntityId, connectorEntities.id)
      )
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          isNull(apiEndpointConfigs.deleted),
          isNull(connectorEntities.deleted)
        )
      )
      .orderBy(connectorEntities.created);

    return rows as ApiEndpoint[];
  }

  /**
   * Joined live lookup for a single endpoint, keyed by its
   * `connector_entity_id`. Returns `null` on miss.
   */
  async findByEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<ApiEndpoint | null> {
    const [row] = await (client as typeof db)
      .select({ entity: connectorEntities, config: apiEndpointConfigs })
      .from(apiEndpointConfigs)
      .innerJoin(
        connectorEntities,
        eq(apiEndpointConfigs.connectorEntityId, connectorEntities.id)
      )
      .where(
        and(
          eq(apiEndpointConfigs.connectorEntityId, connectorEntityId),
          isNull(apiEndpointConfigs.deleted),
          isNull(connectorEntities.deleted)
        )
      )
      .limit(1);

    return (row as ApiEndpoint | undefined) ?? null;
  }

  /**
   * Create the `connector_entity` + `api_endpoint_config` pair in one
   * transaction. The caller can pre-start a transaction and pass its
   * client; otherwise this opens its own.
   */
  async createWithEntity(
    input: CreateApiEndpointInput,
    actor: string,
    client?: DbClient
  ): Promise<ApiEndpoint> {
    const work = async (tx: DbClient): Promise<ApiEndpoint> => {
      const now = Date.now();

      const entityRow: ConnectorEntitySelect = {
        id: SystemUtilities.id.v4.generate(),
        created: now,
        createdBy: actor,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: input.organizationId,
        connectorInstanceId: input.connectorInstanceId,
        key: input.key,
        label: input.label,
      };
      await (tx as typeof db).insert(connectorEntities).values(entityRow);

      const configRow: ApiEndpointConfigInsert = {
        id: SystemUtilities.id.v4.generate(),
        created: now,
        createdBy: actor,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: input.organizationId,
        connectorEntityId: entityRow.id,
        ...input.config,
      };
      const [configInserted] = await (tx as typeof db)
        .insert(apiEndpointConfigs)
        .values(configRow as never)
        .returning();

      return {
        entity: entityRow,
        config: configInserted as ApiEndpointConfigSelect,
      };
    };

    if (client) return work(client);
    return Repository.transaction((tx) => work(tx));
  }

  /**
   * Update only the config columns. Returns the patched joined pair, or
   * `null` if the endpoint doesn't exist (caller maps to 404).
   */
  async updateConfig(
    connectorEntityId: string,
    patch: UpdateApiEndpointConfigPatch,
    actor: string,
    client: DbClient = db
  ): Promise<ApiEndpoint | null> {
    const [updated] = await (client as typeof db)
      .update(apiEndpointConfigs)
      .set({
        ...patch,
        updated: Date.now(),
        updatedBy: actor,
      } as never)
      .where(
        and(
          eq(apiEndpointConfigs.connectorEntityId, connectorEntityId),
          isNull(apiEndpointConfigs.deleted)
        )
      )
      .returning();

    if (!updated) return null;
    return this.findByEntityId(connectorEntityId, client);
  }

  /**
   * Soft-delete both the entity and its config row in one transaction.
   * Returns `true` on success, `false` when no live endpoint exists.
   */
  async softDeleteWithEntity(
    connectorEntityId: string,
    actor: string,
    client?: DbClient
  ): Promise<boolean> {
    const work = async (tx: DbClient): Promise<boolean> => {
      const now = Date.now();

      const configResult = await (tx as typeof db)
        .update(apiEndpointConfigs)
        .set({ deleted: now, deletedBy: actor } as never)
        .where(
          and(
            eq(apiEndpointConfigs.connectorEntityId, connectorEntityId),
            isNull(apiEndpointConfigs.deleted)
          )
        )
        .returning({ id: apiEndpointConfigs.id });

      if (configResult.length === 0) return false;

      await (tx as typeof db)
        .update(connectorEntities)
        .set({ deleted: now, deletedBy: actor })
        .where(
          and(
            eq(connectorEntities.id, connectorEntityId),
            isNull(connectorEntities.deleted)
          )
        );

      return true;
    };

    if (client) return work(client);
    return Repository.transaction((tx) => work(tx));
  }

  /** Hard delete by entity id — used only by integration tests teardown. */
  async hardDeleteByEntityIds(
    connectorEntityIds: string[],
    client: DbClient = db
  ): Promise<void> {
    if (connectorEntityIds.length === 0) return;
    await (client as typeof db)
      .delete(apiEndpointConfigs)
      .where(inArray(apiEndpointConfigs.connectorEntityId, connectorEntityIds));
  }
}

export const apiEndpointsRepo = new ApiEndpointsRepository();
