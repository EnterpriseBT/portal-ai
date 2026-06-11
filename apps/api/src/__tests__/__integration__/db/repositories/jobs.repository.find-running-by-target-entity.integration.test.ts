import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { JobsRepository } from "../../../../db/repositories/jobs.repository.js";
import {
  generateId,
  teardownOrg,
  seedUserAndOrg,
} from "../../utils/application.util.js";

describe("JobsRepository.findRunningByTargetEntityId", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: JobsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const seeded = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      `auth0|jobs-repo-test-${generateId()}`
    );
    orgId = seeded.organizationId;
    repo = new JobsRepository();
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  function newJob(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      organizationId: orgId,
      type: "bulk_transform",
      status: "active",
      progress: 0,
      metadata: { targetConnectorEntityIds: ["entity-1"] },
      result: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      bullJobId: null,
      attempts: 0,
      maxAttempts: 3,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as never;
  }

  it("returns the in-flight bulk_transform job locking the entity", async () => {
    await db.insert(schema.jobs).values(newJob());
    const rows = await repo.findRunningByTargetEntityId("entity-1", orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("bulk_transform");
  });

  it("ignores terminal jobs (completed / failed / cancelled)", async () => {
    await db
      .insert(schema.jobs)
      .values([
        newJob({ id: generateId(), status: "completed" }),
        newJob({ id: generateId(), status: "failed" }),
        newJob({ id: generateId(), status: "cancelled" }),
      ]);
    const rows = await repo.findRunningByTargetEntityId("entity-1", orgId);
    expect(rows).toHaveLength(0);
  });

  it("returns nothing when no jobs target the entity", async () => {
    const rows = await repo.findRunningByTargetEntityId(
      "entity-not-found",
      orgId
    );
    expect(rows).toHaveLength(0);
  });

  it("distinguishes between two entities — locking A doesn't trip B", async () => {
    await db.insert(schema.jobs).values(
      newJob({
        metadata: { targetConnectorEntityIds: ["entity-A"] },
      })
    );
    const entityA = await repo.findRunningByTargetEntityId("entity-A", orgId);
    const entityB = await repo.findRunningByTargetEntityId("entity-B", orgId);
    expect(entityA).toHaveLength(1);
    expect(entityB).toHaveLength(0);
  });

  it("ignores jobs of other types even with the same metadata key", async () => {
    // Hypothetical: a connector_sync job whose metadata happens to
    // include `targetConnectorEntityId`. The query is scoped to
    // bulk_transform only.
    await db.insert(schema.jobs).values(
      newJob({
        type: "connector_sync",
        metadata: {
          connectorInstanceId: "ci-1",
          targetConnectorEntityId: "entity-1",
        },
      })
    );
    const rows = await repo.findRunningByTargetEntityId("entity-1", orgId);
    expect(rows).toHaveLength(0);
  });
});
