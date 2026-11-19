/**
 * Integration tests for the `db:demo:delete` runner (#1035): the spawn target
 * of `portalai demo delete`, which runs the full organization deletion (#197)
 * on an org `demo create` marked, and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { runDemoDelete } from "../../../db/demo-delete.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
import { SeedService } from "../../../services/seed.service.js";
import {
  createUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

describe("db:demo:delete — runDemoDelete", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let ownerEmail!: string;
  let out: string[];
  let err: string[];
  const io = {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);
    const owner = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(owner as never);
    ownerEmail = owner.email;
    out = [];
    err = [];
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  it("deletes a demo org as the given actor and prints one JSON line", async () => {
    const { organizationId } = await ApplicationService.createDemoOrganization({
      ownerEmail,
      name: `Demo ${generateId()}`,
      tier: "standard",
    });

    const code = await runDemoDelete(
      ["--org", organizationId, "--actor", "operator-1"],
      undefined,
      io
    );

    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ id: organizationId, deleted: true });
    expect(
      await DbService.repository.organizations.findById(organizationId)
    ).toBeUndefined();
  });

  it("refuses a non-demo org with exit 1 and leaves it live", async () => {
    const { organization } =
      await ApplicationService.createOrganizationForEmail(
        ownerEmail,
        `Customer ${generateId()}`
      );

    const code = await runDemoDelete(
      ["--org", organization.id, "--actor", "operator-1"],
      undefined,
      io
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/not a demo org/);
    expect(
      await DbService.repository.organizations.findById(organization.id)
    ).toBeDefined();
  });

  it.each([
    ["no --org", ["--actor", "operator-1"]],
    ["no --actor", ["--org", "o-1"]],
    ["--org's value is a flag", ["--org", "--actor", "operator-1"]],
    ["an unknown flag", ["--org", "o-1", "--actor", "a", "--force", "x"]],
  ])("is a usage error with %s", async (_label, argv) => {
    expect(await runDemoDelete(argv, undefined, io)).toBe(1);
    expect(err.join("\n")).toMatch(/^Usage: db:demo:delete/);
  });
});
