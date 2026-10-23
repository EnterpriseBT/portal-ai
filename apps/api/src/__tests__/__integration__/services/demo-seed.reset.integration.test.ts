/**
 * Integration tests for DemoSeedService (#509), against the postgres-test DB:
 * reset (portals cleared, records reconverged, OAuth untouched) and the missing-column guard.
 *
 * One of three files split by concern from the original suite (#857), so the
 * sharded CI run can place them independently. Each test still wipes the DB
 * and seeds a full demo org, so a single file stays the heaviest unit.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import {
  ConnectorInstanceModelFactory,
  PortalModelFactory,
} from "@portalai/core/models";

import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { DbService } from "../../../services/db.service.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import { COUNTS } from "../../../demo/demo-data.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  demoSeedHelpers,
  openDemoSeedDb,
  type DemoSeedConnection,
} from "../utils/demo-seed.util.js";

describe("DemoSeedService (integration): reset", () => {
  let connection!: DemoSeedConnection;
  let db!: DbClient;

  beforeEach(async () => {
    ({ connection, db } = await openDemoSeedDb());
  });

  afterEach(async () => {
    await connection.end();
  });

  const { provisionOrg, rawCount, entityIdByKey } = demoSeedHelpers(() => db);

  it("reset clears portals + reconverges records, leaving OAuth untouched", async () => {
    const orgId = await provisionOrg();
    await DemoSeedService.seed({ orgId, rows: 0 });

    // A mock OAuth (Google Sheets) instance that reset must NOT touch.
    const gsDef =
      await DbService.repository.connectorDefinitions.findBySlug(
        "google-sheets"
      );
    const gsModel = new ConnectorInstanceModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        connectorDefinitionId: gsDef!.id,
        organizationId: orgId,
        name: "Google Sheets",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: { ...gsDef!.capabilityFlags },
      });
    await DbService.repository.connectorInstances.create(gsModel.parse());

    // A portal (conversation) that reset must delete.
    const [station] =
      await DbService.repository.stations.findByOrganizationId(orgId);
    const portal = new PortalModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        organizationId: orgId,
        stationId: station.id,
        name: "Demo chat",
        lastOpened: null,
      });
    await DbService.repository.portals.create(portal.parse());

    const result = await DemoSeedService.reset({ orgId, rows: 0 });

    expect(result.portalsDeleted).toBe(1);
    expect(
      await rawCount(
        `SELECT count(*)::int AS count FROM portals WHERE organization_id = '${orgId}'`
      )
    ).toBe(0);

    // Records re-converged to the checked-in baseline.
    const notes = result.entities.find((e) => e.key === "notes")!;
    expect(notes.deleted).toBe(COUNTS.notes);
    expect(notes.reconverged).toBe(COUNTS.notes);
    const notesId = await entityIdByKey(orgId, "notes");
    expect(
      await rawCount(
        `SELECT count(*)::int AS count FROM entity_records WHERE connector_entity_id = '${notesId}' AND deleted IS NULL`
      )
    ).toBe(COUNTS.notes);

    // The OAuth instance is untouched.
    const gsStill =
      await DbService.repository.connectorInstances.findByOrgDefinitionAndName(
        orgId,
        gsDef!.id,
        "Google Sheets"
      );
    expect(gsStill).toBeDefined();
  }, 90000);

  it("throws when a required system column definition is missing", async () => {
    const orgId = await provisionOrg();
    const address = await DbService.repository.columnDefinitions.findByKey(
      orgId,
      "address"
    );
    await DbService.repository.columnDefinitions.softDelete(
      address!.id,
      SystemUtilities.id.system
    );

    await expect(DemoSeedService.seed({ orgId, rows: 0 })).rejects.toThrow(
      /address/
    );
  });
});
