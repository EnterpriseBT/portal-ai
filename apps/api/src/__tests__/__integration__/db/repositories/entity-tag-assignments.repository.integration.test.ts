/**
 * Integration tests for the EntityTagAssignmentsRepository.
 *
 * Tests run against a real PostgreSQL database provided by the docker-compose postgres-test service (see `__integration__/setup.ts`).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import type { TagTarget } from "@portalai/core/models";

import { EntityTagsRepository } from "../../../../db/repositories/entity-tags.repository.js";
import { EntityTagAssignmentsRepository } from "../../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type {
  EntityTagInsert,
  EntityTagAssignmentInsert,
  ConnectorEntityInsert,
} from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../../utils/seed-populated-org.util.js";
import { wideTableReconcilerService } from "../../../../services/wide-table-reconciler.service.js";

describe("EntityTagAssignmentsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let tagsRepo: EntityTagsRepository;
  let assignmentsRepo: EntityTagAssignmentsRepository;
  let orgId: string;
  let connectorInstanceId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    tagsRepo = new EntityTagsRepository();
    assignmentsRepo = new EntityTagAssignmentsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: `test-connector-${generateId().slice(0, 8)}`,
        display: "Test Connector",
        category: "crm",
        authType: "oauth2",
        configSchema: {},
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    connectorInstanceId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id: connectorInstanceId,
        connectorDefinitionId: connDefId,
        organizationId: orgId,
        name: "Test Instance",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeTag(overrides?: Partial<EntityTagInsert>): EntityTagInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      name: `tag-${generateId().slice(0, 8)}`,
      color: null,
      description: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityTagInsert;
  }

  function makeEntity(
    overrides?: Partial<ConnectorEntityInsert>
  ): ConnectorEntityInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorInstanceId,
      key: `entity_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Test Entity",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as ConnectorEntityInsert;
  }

  function makeAssignment(
    connectorEntityId: string,
    entityTagId: string,
    overrides?: Partial<EntityTagAssignmentInsert>
  ): EntityTagAssignmentInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      entityTagId,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityTagAssignmentInsert;
  }

  async function seedEntity(): Promise<string> {
    const entity = makeEntity();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorEntities)
      .values(entity as never);
    return entity.id;
  }

  async function seedTag(): Promise<string> {
    const tag = await tagsRepo.create(makeTag(), db);
    return tag.id;
  }

  const entityTarget = (id: string) => ({ type: "entity" as const, id });
  const row = () => ({
    id: generateId(),
    organizationId: orgId,
    created: Date.now(),
    createdBy: "test-system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  // ── findByTarget ─────────────────────────────────────────────────

  describe("findByTarget", () => {
    it("returns the object's tags with their assignment ids", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(
        makeAssignment(entityId, tagId),
        db
      );

      const results = await assignmentsRepo.findByTarget(
        entityTarget(entityId),
        db
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(tagId);
      expect(results[0].assignmentId).toBe(assignment.id);
    });

    it("returns an empty array when the object has no tags", async () => {
      const entityId = await seedEntity();
      expect(
        await assignmentsRepo.findByTarget(entityTarget(entityId), db)
      ).toHaveLength(0);
    });

    it("excludes soft-deleted assignments", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(
        makeAssignment(entityId, tagId),
        db
      );
      await assignmentsRepo.softDelete(assignment.id, "test-system", db);

      expect(
        await assignmentsRepo.findByTarget(entityTarget(entityId), db)
      ).toHaveLength(0);
    });

    it("excludes a deleted tag", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);
      await tagsRepo.softDelete(tagId, "test-system", db);

      expect(
        await assignmentsRepo.findByTarget(entityTarget(entityId), db)
      ).toHaveLength(0);
    });
  });

  // ── findByTargetIds ──────────────────────────────────────────────

  describe("findByTargetIds", () => {
    it("batch-loads tags for multiple objects", async () => {
      const entityId1 = await seedEntity();
      const entityId2 = await seedEntity();
      const tagId1 = await seedTag();
      const tagId2 = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityId1, tagId1), db);
      await assignmentsRepo.create(makeAssignment(entityId2, tagId2), db);

      const map = await assignmentsRepo.findByTargetIds(
        "entity",
        [entityId1, entityId2],
        db
      );

      expect(map.get(entityId1)).toHaveLength(1);
      expect(map.get(entityId1)![0].id).toBe(tagId1);
      expect(map.get(entityId2)).toHaveLength(1);
      expect(map.get(entityId2)![0].id).toBe(tagId2);
    });

    it("returns an empty map for empty input", async () => {
      const map = await assignmentsRepo.findByTargetIds("entity", [], db);
      expect(map.size).toBe(0);
    });

    it("omits objects with no tags from the map", async () => {
      const entityWithTag = await seedEntity();
      const entityWithoutTag = await seedEntity();
      const tagId = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityWithTag, tagId), db);

      const map = await assignmentsRepo.findByTargetIds(
        "entity",
        [entityWithTag, entityWithoutTag],
        db
      );

      expect(map.has(entityWithTag)).toBe(true);
      expect(map.has(entityWithoutTag)).toBe(false);
    });
  });

  // ── insertIfAbsent ───────────────────────────────────────────────

  describe("insertIfAbsent", () => {
    it("creates an assignment, then reports the existing one", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();

      const first = await assignmentsRepo.insertIfAbsent(
        entityTarget(entityId),
        tagId,
        row(),
        db
      );
      expect(first.created).toBe(true);
      expect(first.row.connectorEntityId).toBe(entityId);
      expect(first.row.stationId).toBeNull();

      const second = await assignmentsRepo.insertIfAbsent(
        entityTarget(entityId),
        tagId,
        row(),
        db
      );
      expect(second.created).toBe(false);
      expect(second.row.id).toBe(first.row.id);
    });

    it("makes one row from two concurrent calls", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      // Two connections, so the inserts really race.
      const other = postgres(process.env.DATABASE_URL!, { max: 1 });
      try {
        const db2 = drizzle(other, { schema });
        const results = await Promise.all([
          assignmentsRepo.insertIfAbsent(
            entityTarget(entityId),
            tagId,
            row(),
            db
          ),
          assignmentsRepo.insertIfAbsent(
            entityTarget(entityId),
            tagId,
            row(),
            db2
          ),
        ]);
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(
          await assignmentsRepo.findByTarget(entityTarget(entityId), db)
        ).toHaveLength(1);
      } finally {
        await other.end();
      }
    });

    it("assigns again after the previous assignment was removed", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const first = await assignmentsRepo.insertIfAbsent(
        entityTarget(entityId),
        tagId,
        row(),
        db
      );
      await assignmentsRepo.softDelete(first.row.id, "test-system", db);

      const again = await assignmentsRepo.insertIfAbsent(
        entityTarget(entityId),
        tagId,
        row(),
        db
      );
      expect(again.created).toBe(true);
      expect(again.row.id).not.toBe(first.row.id);
    });
  });

  // ── findAssignment ───────────────────────────────────────────────

  describe("findAssignment", () => {
    it("finds an assignment only on its own object", async () => {
      const entityId = await seedEntity();
      const otherEntityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(
        makeAssignment(entityId, tagId),
        db
      );

      expect(
        await assignmentsRepo.findAssignment(
          entityTarget(entityId),
          assignment.id,
          db
        )
      ).toMatchObject({ id: assignment.id });
      expect(
        await assignmentsRepo.findAssignment(
          entityTarget(otherEntityId),
          assignment.id,
          db
        )
      ).toBeUndefined();
    });

    it("misses a soft-deleted assignment", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();
      const assignment = await assignmentsRepo.create(
        makeAssignment(entityId, tagId),
        db
      );
      await assignmentsRepo.softDelete(assignment.id, "test-system", db);

      expect(
        await assignmentsRepo.findAssignment(
          entityTarget(entityId),
          assignment.id,
          db
        )
      ).toBeUndefined();
    });
  });

  // ── Unique constraint ────────────────────────────────────────────

  describe("unique constraint", () => {
    it("should reject duplicate (connectorEntityId, entityTagId) at DB level", async () => {
      const entityId = await seedEntity();
      const tagId = await seedTag();

      await assignmentsRepo.create(makeAssignment(entityId, tagId), db);

      await expect(
        assignmentsRepo.create(makeAssignment(entityId, tagId), db)
      ).rejects.toThrow();
    });
  });
});

/**
 * #1070: the same methods across every target type, on one org holding an
 * entity, station, pin, connector instance and curated view.
 */
describe("EntityTagAssignmentsRepository across target types (#1070)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let org!: PopulatedOrg;
  let tagId!: string;
  const repo = new EntityTagAssignmentsRepository();
  const client = () => db as DbClient;

  const row = () => ({
    id: generateId(),
    organizationId: org.orgId,
    created: Date.now(),
    createdBy: "test-system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  const targets = (): TagTarget[] => [
    { type: "entity", id: org.connectorEntityId },
    { type: "station", id: org.stationId },
    { type: "pin", id: org.portalResultId },
    { type: "connector_instance", id: org.connectorInstanceId },
    { type: "curated_view", id: org.curatedViewId },
  ];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "tag-repo-targets");
    // The populated org already tags its entity; start every target clean.
    await db
      .delete(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.organizationId, org.orgId));
    const tag = await new EntityTagsRepository().create(
      {
        ...row(),
        name: `tag-${generateId().slice(0, 8)}`,
        color: null,
        description: null,
      } as EntityTagInsert,
      db as DbClient
    );
    tagId = tag.id;
  });

  afterEach(async () => {
    await wideTableReconcilerService.dropTable(
      org.connectorEntityId,
      db as DbClient
    );
    await teardownOrg(db);
    await connection.end();
  });

  it("assigns, reads back and reports duplicates on every type", async () => {
    for (const target of targets()) {
      const first = await repo.insertIfAbsent(target, tagId, row(), client());
      expect(first.created).toBe(true);
      const second = await repo.insertIfAbsent(target, tagId, row(), client());
      expect(second.created).toBe(false);

      const tags = await repo.findByTarget(target, client());
      expect(tags.map((t) => t.id)).toEqual([tagId]);
      const map = await repo.findByTargetIds(
        target.type,
        [target.id],
        client()
      );
      expect(map.get(target.id)?.map((t) => t.id)).toEqual([tagId]);
    }
  });

  it("soft-deletes only the named type's assignments", async () => {
    for (const target of targets()) {
      await repo.insertIfAbsent(target, tagId, row(), client());
    }
    const swept = await repo.softDeleteByTargets(
      "station",
      [org.stationId],
      "test-system",
      client()
    );
    expect(swept).toBe(1);
    for (const target of targets()) {
      const tags = await repo.findByTarget(target, client());
      expect(tags).toHaveLength(target.type === "station" ? 0 : 1);
    }
  });

  it("counts assignments per type", async () => {
    for (const target of targets()) {
      await repo.insertIfAbsent(target, tagId, row(), client());
    }
    expect(
      await repo.countByTargetIds("pin", [org.portalResultId], client())
    ).toBe(1);
    expect(await repo.countByTargetIds("pin", [], client())).toBe(0);
  });

  it("filters a list to objects carrying any of the tags", async () => {
    await repo.insertIfAbsent(
      { type: "station", id: org.stationId },
      tagId,
      row(),
      client()
    );
    const tagged = await db
      .select({ id: schema.stations.id })
      .from(schema.stations)
      .where(
        and(
          eq(schema.stations.organizationId, org.orgId),
          repo.taggedWithAny("station", schema.stations.id, [
            tagId,
            "no-such-tag",
          ])
        )
      );
    expect(tagged.map((s) => s.id)).toEqual([org.stationId]);

    const none = await db
      .select({ id: schema.stations.id })
      .from(schema.stations)
      .where(repo.taggedWithAny("station", schema.stations.id, []));
    expect(none).toHaveLength(0);
  });
});
