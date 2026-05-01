/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/**
 * Repository for the `connector_entities` table.
 *
 * Extends the generic {@link Repository} with connector-instance-scoped
 * queries and key-based lookups.
 */

import { eq, and, inArray, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  connectorEntities,
  connectorInstances,
  fieldMappings,
  columnDefinitions,
} from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import { entityTagAssignmentsRepo } from "./entity-tag-assignments.repository.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import type {
  ConnectorEntitySelect,
  ConnectorEntityInsert,
  FieldMappingSelect,
  ColumnDefinitionSelect,
} from "../schema/zod.js";

export interface ConnectorEntityListOptions extends ListOptions {
  include?: string[];
}

export class ConnectorEntitiesRepository extends Repository<
  typeof connectorEntities,
  ConnectorEntitySelect,
  ConnectorEntityInsert
> {
  constructor() {
    super(connectorEntities);
  }

  /**
   * Find entities matching `where`, with optional eager-loaded relations.
   * Pass `include` to attach any combination of `connectorInstance`, `fieldMappings`, and `tags`.
   */
  override async findMany(
    where?: SQL,
    opts: ConnectorEntityListOptions = {},
    client: DbClient = db
  ): Promise<ConnectorEntitySelect[]> {
    const entities = await super.findMany(where, opts, client);
    const { include } = opts;
    if (entities.length === 0 || !include || include.length === 0)
      return entities;

    const entityIds = entities.map((e) => e.id);
    const includes = new Set(include);

    const [instanceMap, fieldMappingsByEntity, tagsByEntity] =
      await Promise.all([
        includes.has("connectorInstance")
          ? (client as typeof db)
              .select()
              .from(connectorInstances)
              .where(
                inArray(connectorInstances.id, [
                  ...new Set(entities.map((e) => e.connectorInstanceId)),
                ])
              )
              .then((rows) => new Map(rows.map((i) => [i.id, i])))
          : Promise.resolve(null),
        includes.has("fieldMappings")
          ? this.findFieldMappingsByEntityIds(entityIds, client)
          : Promise.resolve(null),
        includes.has("tags")
          ? entityTagAssignmentsRepo.findByConnectorEntityIds(entityIds, client)
          : Promise.resolve(null),
      ]);

    return entities.map((entity) => ({
      ...entity,
      ...(instanceMap && {
        connectorInstance: instanceMap.get(entity.connectorInstanceId) ?? null,
      }),
      ...(fieldMappingsByEntity && {
        fieldMappings: fieldMappingsByEntity.get(entity.id) ?? [],
      }),
      ...(tagsByEntity && { tags: tagsByEntity.get(entity.id) ?? [] }),
    })) as ConnectorEntitySelect[];
  }

  /** Find all entities for a given connector instance. */
  async findByConnectorInstanceId(
    connectorInstanceId: string,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect[]> {
    return (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          this.notDeleted()
        )
      )) as ConnectorEntitySelect[];
  }

  /** Find a single entity by connector instance + key. */
  async findByKey(
    connectorInstanceId: string,
    key: string,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          eq(connectorEntities.key, key),
          this.notDeleted()
        )
      )
      .limit(1);
    return row as ConnectorEntitySelect | undefined;
  }

  /**
   * Batch-load field mappings (with column definitions) for a list of entity IDs.
   * Returns a Map keyed by entity ID.
   */
  async findFieldMappingsByEntityIds(
    entityIds: string[],
    client: DbClient = db
  ): Promise<
    Map<
      string,
      (FieldMappingSelect & {
        columnDefinition: ColumnDefinitionSelect | null;
      })[]
    >
  > {
    if (entityIds.length === 0) return new Map();

    const mappings = await (client as typeof db)
      .select()
      .from(fieldMappings)
      .where(
        and(
          inArray(fieldMappings.connectorEntityId, entityIds),
          isNull(fieldMappings.deleted)
        )
      );

    const uniqueColDefIds = [
      ...new Set(mappings.map((m) => m.columnDefinitionId)),
    ];
    const colDefs =
      uniqueColDefIds.length > 0
        ? await (client as typeof db)
            .select()
            .from(columnDefinitions)
            .where(
              and(
                inArray(columnDefinitions.id, uniqueColDefIds),
                isNull(columnDefinitions.deleted)
              )
            )
        : [];

    const colDefMap = new Map(colDefs.map((cd) => [cd.id, cd]));
    const result = new Map<
      string,
      (FieldMappingSelect & {
        columnDefinition: ColumnDefinitionSelect | null;
      })[]
    >();
    for (const m of mappings) {
      const enriched = {
        ...(m as FieldMappingSelect),
        columnDefinition: colDefMap.get(m.columnDefinitionId) ?? null,
      };
      const list = result.get(m.connectorEntityId) ?? [];
      list.push(enriched);
      result.set(m.connectorEntityId, list);
    }
    return result;
  }

  /**
   * Soft-delete all entities for a given connector instance.
   * Returns the number of affected rows.
   */
  async softDeleteByConnectorInstanceId(
    connectorInstanceId: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    const now = Date.now();
    const result = await (client as typeof db)
      .update(this.table)
      .set({ deleted: now, deletedBy } as any)
      .where(
        and(
          eq(connectorEntities.connectorInstanceId, connectorInstanceId),
          this.notDeleted()
        )
      )
      .returning();
    return result.length;
  }

  /**
   * Insert a connector entity or update it when the same connector instance
   * already owns this `(organization_id, key)`. Under C2 the key is unique
   * per organization, so a collision from a *different* connector in the
   * same org is a hard error — throws
   * `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR`.
   */
  async upsertByKey(
    data: ConnectorEntityInsert,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect> {
    const [existing] = (await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorEntities.organizationId, data.organizationId),
          eq(connectorEntities.key, data.key),
          isNull(connectorEntities.deleted)
        )
      )
      .limit(1)) as ConnectorEntitySelect[];

    if (!existing) {
      const [row] = await (client as typeof db)
        .insert(this.table)
        .values(data as never)
        .returning();
      return row as ConnectorEntitySelect;
    }

    if (existing.connectorInstanceId !== data.connectorInstanceId) {
      throw new ApiError(
        400,
        ApiCode.CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR,
        `Entity key "${data.key}" is already used by connector "${existing.connectorInstanceId}" in this org.`,
        { conflictingConnectorInstanceId: existing.connectorInstanceId }
      );
    }

    const [updated] = await (client as typeof db)
      .update(this.table)
      .set({
        label: data.label,
        updated: data.updated ?? Date.now(),
        updatedBy: data.updatedBy,
      } as never)
      .where(eq(connectorEntities.id, existing.id))
      .returning();
    return updated as ConnectorEntitySelect;
  }
}

/** Singleton instance. */
export const connectorEntitiesRepo = new ConnectorEntitiesRepository();
