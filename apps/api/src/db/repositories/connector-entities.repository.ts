/**
 * Repository for the `connector_entities` table.
 *
 * Extends the generic {@link Repository} with connector-instance-scoped
 * queries and key-based lookups.
 */

import { eq, and, inArray, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { IndexColumn } from "drizzle-orm/pg-core";

import { connectorEntities, connectorInstances, fieldMappings, columnDefinitions, entityTagAssignments } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient, type ListOptions } from "./base.repository.js";
import { entityTagAssignmentsRepo } from "./entity-tag-assignments.repository.js";
import type {
  ConnectorEntitySelect,
  ConnectorEntityInsert,
  ConnectorInstanceSelect,
  FieldMappingSelect,
  ColumnDefinitionSelect,
  EntityTagSelect,
} from "../schema/zod.js";

export class ConnectorEntitiesRepository extends Repository<
  typeof connectorEntities,
  ConnectorEntitySelect,
  ConnectorEntityInsert
> {
  constructor() {
    super(connectorEntities);
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
   * Return entities with their field mappings and associated column definitions.
   * Uses batch-loading to avoid N+1 queries.
   */
  async findManyWithFieldMappings(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<
    (ConnectorEntitySelect & {
      fieldMappings: (FieldMappingSelect & {
        columnDefinition: ColumnDefinitionSelect | null;
      })[];
    })[]
  > {
    // 1. Fetch paginated entities
    const entities = await this.findMany(where, opts, client);
    if (entities.length === 0) return [];

    const entityIds = entities.map((e) => e.id);

    // 2. Batch-fetch field mappings for these entities
    const mappings = await (client as typeof db)
      .select()
      .from(fieldMappings)
      .where(
        and(
          inArray(fieldMappings.connectorEntityId, entityIds),
          isNull(fieldMappings.deleted)
        )
      );

    // 3. Batch-fetch column definitions for the mappings
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

    // 4. Assemble in-memory
    const colDefMap = new Map(colDefs.map((cd) => [cd.id, cd]));

    const mappingsByEntity = new Map<
      string,
      (FieldMappingSelect & { columnDefinition: ColumnDefinitionSelect | null })[]
    >();
    for (const m of mappings) {
      const enriched = {
        ...(m as FieldMappingSelect),
        columnDefinition: colDefMap.get(m.columnDefinitionId) ?? null,
      };
      const list = mappingsByEntity.get(m.connectorEntityId) ?? [];
      list.push(enriched);
      mappingsByEntity.set(m.connectorEntityId, list);
    }

    return entities.map((entity) => ({
      ...entity,
      fieldMappings: mappingsByEntity.get(entity.id) ?? [],
    }));
  }

  /**
   * Return entities with their full connector instance attached.
   * Uses batch-loading to avoid N+1 queries.
   */
  async findManyWithInstance(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<
    (ConnectorEntitySelect & {
      connectorInstance: ConnectorInstanceSelect;
    })[]
  > {
    const entities = await this.findMany(where, opts, client);
    if (entities.length === 0) return [];

    const instanceIds = [
      ...new Set(entities.map((e) => e.connectorInstanceId)),
    ];

    const instances = await (client as typeof db)
      .select()
      .from(connectorInstances)
      .where(inArray(connectorInstances.id, instanceIds));

    const instanceMap = new Map(instances.map((i) => [i.id, i]));

    return entities
      .filter((e) => instanceMap.has(e.connectorInstanceId))
      .map((entity) => ({
        ...entity,
        connectorInstance: instanceMap.get(
          entity.connectorInstanceId
        )! as ConnectorInstanceSelect,
      }));
  }

  /**
   * Return entities with their assigned tags batch-loaded.
   * Fetches paginated entities then calls entityTagAssignmentsRepo.findByConnectorEntityIds
   * to batch-load tags in a second query.
   */
  async findManyWithTags(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<(ConnectorEntitySelect & { tags: EntityTagSelect[] })[]> {
    const entities = await this.findMany(where, opts, client);
    if (entities.length === 0) return [];

    const entityIds = entities.map((e) => e.id);
    const tagsByEntity = await entityTagAssignmentsRepo.findByConnectorEntityIds(
      entityIds,
      client
    );

    return entities.map((entity) => ({
      ...entity,
      tags: tagsByEntity.get(entity.id) ?? [],
    }));
  }

  /**
   * Return entities in an organization that have at least one assignment
   * matching any of the given tag IDs.
   */
  async findManyByTagIds(
    organizationId: string,
    tagIds: string[],
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<ConnectorEntitySelect[]> {
    if (tagIds.length === 0) return [];

    const assignedRows = await (client as typeof db)
      .selectDistinct({ id: entityTagAssignments.connectorEntityId })
      .from(entityTagAssignments)
      .where(
        and(
          inArray(entityTagAssignments.entityTagId, tagIds),
          isNull(entityTagAssignments.deleted)
        )
      );

    if (assignedRows.length === 0) return [];

    const assignedIds = assignedRows.map((r) => r.id);

    return this.findMany(
      and(
        eq(connectorEntities.organizationId, organizationId),
        inArray(connectorEntities.id, assignedIds)
      ),
      opts,
      client
    );
  }

  /**
   * Insert a connector entity or update it if a row with the same
   * `(connector_instance_id, key)` already exists. Returns the resulting row.
   */
  async upsertByKey(
    data: ConnectorEntityInsert,
    client: DbClient = db
  ): Promise<ConnectorEntitySelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          connectorEntities.connectorInstanceId,
          connectorEntities.key,
        ] as IndexColumn[],
        set: {
          label: data.label,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as ConnectorEntitySelect;
  }
}

/** Singleton instance. */
export const connectorEntitiesRepo = new ConnectorEntitiesRepository();
