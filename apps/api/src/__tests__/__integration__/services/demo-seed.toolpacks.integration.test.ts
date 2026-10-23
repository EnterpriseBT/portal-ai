/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB:
 * toolpacks: built-ins enabled, the custom toolpack registered from DEMO_TOOLPACK_URL, and its idempotent re-registration.
 *
 * One of three files split by concern from the original suite (#857), so the
 * sharded CI run can place them independently. Each test still wipes the DB
 * and seeds a full demo org, so a single file stays the heaviest unit.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import { BUILTIN_TOOLPACKS } from "@portalai/core/registries";

import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { ToolpackRegistrationService } from "../../../services/toolpack-registration.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  demoSeedHelpers,
  openDemoSeedDb,
  type DemoSeedConnection,
} from "../utils/demo-seed.util.js";

describe("DemoSeedService (integration): toolpacks", () => {
  let connection!: DemoSeedConnection;
  let db!: DbClient;

  beforeEach(async () => {
    ({ connection, db } = await openDemoSeedDb());
  });

  afterEach(async () => {
    await connection.end();
  });

  const { provisionOrg, rawCount } = demoSeedHelpers(() => db);

  it("enables all built-in toolpacks; skips custom when no URL is set", async () => {
    delete process.env.DEMO_TOOLPACK_URL;
    const orgId = await provisionOrg();

    const result = await DemoSeedService.seed({ orgId, rows: 0 });

    expect(result.toolpacks.builtins.sort()).toEqual(
      BUILTIN_TOOLPACKS.map((p) => p.slug).sort()
    );
    expect(result.toolpacks.builtins).toHaveLength(BUILTIN_TOOLPACKS.length);
    expect(result.toolpacks.custom).toBeNull();
    expect(
      await rawCount(
        `SELECT count(*)::int AS count FROM organization_toolpacks WHERE organization_id = '${orgId}' AND deleted IS NULL`
      )
    ).toBe(0);
  });

  it("registers the custom toolpack when DEMO_TOOLPACK_URL is set", async () => {
    const orgId = await provisionOrg();
    process.env.DEMO_TOOLPACK_URL = "https://demo-toolpack.test";
    const schemaSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchSchema")
      .mockResolvedValue([
        {
          name: "quote_shipping_rate",
          description: "Quote a shipping rate.",
          parameterSchema: { type: "object", properties: {} },
        },
      ] as never);
    const metadataSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchMetadata")
      .mockResolvedValue(null as never);

    try {
      const result = await DemoSeedService.seed({ orgId, rows: 0 });
      expect(result.toolpacks.custom).toBeTruthy();
      expect(schemaSpy).toHaveBeenCalledWith(
        "https://demo-toolpack.test/schema",
        undefined,
        expect.any(String)
      );
      expect(
        await rawCount(
          `SELECT count(*)::int AS count FROM organization_toolpacks WHERE organization_id = '${orgId}' AND deleted IS NULL`
        )
      ).toBe(1);
    } finally {
      schemaSpy.mockRestore();
      metadataSpy.mockRestore();
      delete process.env.DEMO_TOOLPACK_URL;
    }
  });

  it("re-registers the custom toolpack idempotently — a second seed refreshes, not duplicates", async () => {
    // The prod refresh path is a `demo seed` re-run, and (org, name) is unique.
    // A plain INSERT would 23505 on the second pass, `custom` would come back
    // null, and replaceForStation would disassociate the live toolpack. This
    // asserts the second pass refreshes the same row and keeps it attached.
    const orgId = await provisionOrg();
    process.env.DEMO_TOOLPACK_URL = "https://demo-toolpack.test";
    const schemaSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchSchema")
      .mockResolvedValue([
        {
          name: "quote_shipping_rate",
          description: "Quote a shipping rate.",
          parameterSchema: { type: "object", properties: {} },
        },
      ] as never);
    const metadataSpy = jest
      .spyOn(ToolpackRegistrationService, "fetchMetadata")
      .mockResolvedValue(null as never);

    try {
      const first = await DemoSeedService.seed({ orgId, rows: 0 });
      const second = await DemoSeedService.seed({ orgId, rows: 0 });

      expect(second.toolpacks.custom).toBeTruthy();
      // Same row refreshed in place — not a duplicate, not a new id.
      expect(second.toolpacks.custom).toBe(first.toolpacks.custom);
      expect(
        await rawCount(
          `SELECT count(*)::int AS count FROM organization_toolpacks WHERE organization_id = '${orgId}' AND deleted IS NULL`
        )
      ).toBe(1);
      // Still attached to the station after the second pass.
      const [station] =
        await DbService.repository.stations.findByOrganizationId(orgId);
      const attached =
        await DbService.repository.stationToolpacks.findByStationId(station.id);
      expect(
        attached.some(
          (a) => a.organizationToolpackId === second.toolpacks.custom
        )
      ).toBe(true);
    } finally {
      schemaSpy.mockRestore();
      metadataSpy.mockRestore();
      delete process.env.DEMO_TOOLPACK_URL;
    }
  });
});
