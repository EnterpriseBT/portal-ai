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
  describe("signing secret (#911)", () => {
    const SECRET_A = "whsec_" + "a".repeat(43);
    const SECRET_B = "whsec_" + "b".repeat(43);
    let saved: string | undefined;
    let schemaSpy: ReturnType<typeof jest.spyOn>;
    let metadataSpy: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      saved = process.env.DEMO_TOOLPACK_SIGNING_SECRETS;
      process.env.DEMO_TOOLPACK_URL = "https://demo-toolpack.test";
      schemaSpy = jest
        .spyOn(ToolpackRegistrationService, "fetchSchema")
        .mockResolvedValue([
          {
            name: "quote_shipping_rate",
            description: "Quote a shipping rate.",
            parameterSchema: { type: "object", properties: {} },
          },
        ] as never);
      metadataSpy = jest
        .spyOn(ToolpackRegistrationService, "fetchMetadata")
        .mockResolvedValue(null as never);
    });

    afterEach(() => {
      schemaSpy.mockRestore();
      metadataSpy.mockRestore();
      delete process.env.DEMO_TOOLPACK_URL;
      if (saved === undefined) delete process.env.DEMO_TOOLPACK_SIGNING_SECRETS;
      else process.env.DEMO_TOOLPACK_SIGNING_SECRETS = saved;
    });

    async function storedSecret(id: string): Promise<string> {
      const row = await DbService.repository.organizationToolpacks.findById(id);
      return row!.signingSecret;
    }

    it("registers with the first DEMO_TOOLPACK_SIGNING_SECRETS entry", async () => {
      process.env.DEMO_TOOLPACK_SIGNING_SECRETS = ` ${SECRET_A} , ${SECRET_B}`;
      const orgId = await provisionOrg();

      const result = await DemoSeedService.seed({ orgId, rows: 0 });

      expect(schemaSpy).toHaveBeenCalledWith(
        "https://demo-toolpack.test/schema",
        undefined,
        SECRET_A
      );
      expect(await storedSecret(result.toolpacks.custom!)).toBe(SECRET_A);
    });

    it("keeps it across a re-seed", async () => {
      process.env.DEMO_TOOLPACK_SIGNING_SECRETS = `${SECRET_A},${SECRET_B}`;
      const orgId = await provisionOrg();

      await DemoSeedService.seed({ orgId, rows: 0 });
      const second = await DemoSeedService.seed({ orgId, rows: 0 });

      expect(await storedSecret(second.toolpacks.custom!)).toBe(SECRET_A);
    });

    it("mints a secret on first registration when the variable is unset", async () => {
      delete process.env.DEMO_TOOLPACK_SIGNING_SECRETS;
      const orgId = await provisionOrg();
      const result = await DemoSeedService.seed({ orgId, rows: 0 });
      expect(await storedSecret(result.toolpacks.custom!)).toMatch(
        /^whsec_[A-Za-z0-9_-]{43}$/
      );
    });

    it("keeps the stored secret on a re-seed without (or with a malformed) variable", async () => {
      process.env.DEMO_TOOLPACK_SIGNING_SECRETS = SECRET_A;
      const orgId = await provisionOrg();
      const first = await DemoSeedService.seed({ orgId, rows: 0 });

      delete process.env.DEMO_TOOLPACK_SIGNING_SECRETS;
      await DemoSeedService.seed({ orgId, rows: 0 });
      expect(await storedSecret(first.toolpacks.custom!)).toBe(SECRET_A);

      process.env.DEMO_TOOLPACK_SIGNING_SECRETS = "not-a-secret";
      await DemoSeedService.seed({ orgId, rows: 0 });
      expect(await storedSecret(first.toolpacks.custom!)).toBe(SECRET_A);
      expect(schemaSpy).toHaveBeenLastCalledWith(
        "https://demo-toolpack.test/schema",
        undefined,
        SECRET_A
      );
    });

    it("keeps the registered toolpack attached when a refresh is refused", async () => {
      process.env.DEMO_TOOLPACK_SIGNING_SECRETS = SECRET_A;
      const orgId = await provisionOrg();
      const first = await DemoSeedService.seed({ orgId, rows: 0 });

      schemaSpy.mockRejectedValueOnce(new Error("signature rejected"));
      const second = await DemoSeedService.seed({ orgId, rows: 0 });

      expect(second.toolpacks.custom).toBe(first.toolpacks.custom);
      const [station] =
        await DbService.repository.stations.findByOrganizationId(orgId);
      const attached =
        await DbService.repository.stationToolpacks.findByStationId(station.id);
      expect(
        attached.some(
          (a) => a.organizationToolpackId === first.toolpacks.custom
        )
      ).toBe(true);
    });
  });
});
