import { jest } from "@jest/globals";

import {
  cliEnvMockModule,
  resetCliEnvMocks,
  mocks,
  BUILTIN_ENVIRONMENTS,
  EnvDestructiveBlockedError,
} from "./helpers/cli-env-mock.js";

jest.unstable_mockModule("@portalai/cli-env", () => cliEnvMockModule());

const { partitionTables, runReset, LIST_RESETTABLE_TABLES_SQL } =
  await import("../reset.js");

const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

beforeEach(() => {
  resetCliEnvMocks();
  mocks.resolveEnvConnection.mockResolvedValue({
    env: "app-dev",
    kind: "staging",
    apiBaseUrl: "x",
    db: async () => ({
      connectionString: "postgresql://u:p@localhost:15432/db",
      close: async () => {},
    }),
    token: async () => "t",
    dispose: async () => {},
  });
});

describe("partitionTables (reset-hard semantics, #106)", () => {
  it("er__* wide tables DROP; everything else TRUNCATEs", () => {
    expect(
      partitionTables(["users", "er__ce_1", "organizations", "er__ce_2"])
    ).toEqual({
      toDrop: ["er__ce_1", "er__ce_2"],
      toTruncate: ["users", "organizations"],
    });
  });
});

describe("runReset", () => {
  it("guards DESTRUCTIVE, excludes __drizzle_migrations, drops er__* and truncates the rest", async () => {
    const execCalls: string[] = [];
    const exec = jest.fn(async (_conn: string, sql: string) => {
      execCalls.push(sql);
      if (sql === LIST_RESETTABLE_TABLES_SQL)
        return "users\ner__ce_1\norganizations\n";
      return "";
    });

    const out = await runReset(appDev, { yes: true }, exec);

    expect(mocks.assertOperationAllowed).toHaveBeenCalledWith(appDev, {
      destructive: true,
      confirmed: true,
      prodConfirmed: false,
    });
    expect(execCalls[0]).toBe(LIST_RESETTABLE_TABLES_SQL);
    expect(
      execCalls.some((s) => s.includes('DROP TABLE "er__ce_1" CASCADE'))
    ).toBe(true);
    expect(
      execCalls.some((s) =>
        s.includes('TRUNCATE TABLE "users", "organizations" CASCADE')
      )
    ).toBe(true);
    expect(out).toEqual({
      dropped: ["er__ce_1"],
      truncated: ["users", "organizations"],
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ command: "db reset", env: "app-dev" })
    );
  });

  // #784: PostGIS installs spatial_ref_sys in public and nothing reseeds it,
  // so the listing leaves out every table an extension owns.
  it("lists only public tables that aren't migrations or extension-owned", () => {
    expect(LIST_RESETTABLE_TABLES_SQL).toContain("n.nspname = 'public'");
    expect(LIST_RESETTABLE_TABLES_SQL).toContain(
      "c.relname <> '__drizzle_migrations'"
    );
    expect(LIST_RESETTABLE_TABLES_SQL).toMatch(
      /NOT EXISTS \(SELECT 1 FROM pg_depend d WHERE d\.classid = 'pg_class'::regclass AND d\.objid = c\.oid AND d\.deptype = 'e'\)/
    );
    expect(LIST_RESETTABLE_TABLES_SQL).toContain("c.relkind IN ('r', 'p')");
  });

  it("destructive guard failure propagates before any SQL", async () => {
    mocks.assertOperationAllowed.mockImplementation(() => {
      throw new EnvDestructiveBlockedError("never in prod");
    });
    const exec = jest.fn(async () => "");
    await expect(runReset(appDev, { yes: true }, exec)).rejects.toBeInstanceOf(
      EnvDestructiveBlockedError
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("no tables → no-op (no DROP/TRUNCATE issued)", async () => {
    const exec = jest.fn(async (_c: string, sql: string) =>
      sql === LIST_RESETTABLE_TABLES_SQL ? "" : ""
    );
    const out = await runReset(appDev, { yes: true }, exec);
    expect(out).toEqual({ dropped: [], truncated: [] });
    expect(exec).toHaveBeenCalledTimes(1); // only the table query
  });
});
