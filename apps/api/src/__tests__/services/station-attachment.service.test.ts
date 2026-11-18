import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import type { PermissionSet } from "../../services/permission-set.js";
import type { DbClient } from "../../db/repositories/base.repository.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Owner = { id: string; createdBy: string };

/** The handle DbService.transaction passes to its callback. */
const TX_HANDLE = { tx: "attach" };

const mockViewOwners =
  jest.fn<(ids: string[], org: string, client?: unknown) => Promise<Owner[]>>();
const mockInstanceOwners =
  jest.fn<(ids: string[], org: string, client?: unknown) => Promise<Owner[]>>();
const mockViewLinks = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockInstanceLinks = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockViewInsert =
  jest.fn<
    (rows: { curatedViewId: string }[], tx: unknown) => Promise<unknown[]>
  >();
const mockViewSoftDelete = jest.fn<(...a: unknown[]) => Promise<string[]>>();
const mockInstanceInsert =
  jest.fn<
    (rows: { connectorInstanceId: string }[], tx: unknown) => Promise<unknown[]>
  >();
const mockInstanceSoftDelete = jest.fn<(...a: unknown[]) => Promise<number>>();
const mockStationFindById =
  jest.fn<(id: string, client?: unknown) => Promise<unknown>>();
const mockLoadSet = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockViewLinksForStations =
  jest.fn<(ids: string[], client?: unknown) => Promise<unknown[]>>();
const mockViewSummaries =
  jest.fn<
    (ids: string[], org: string, client?: unknown) => Promise<unknown[]>
  >();
const mockAuditRecord = jest.fn<(e: unknown) => Promise<void>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    transaction: async <R>(fn: (tx: unknown) => Promise<R>) => fn(TX_HANDLE),
    repository: {
      stations: { findById: mockStationFindById },
      curatedViews: {
        findOwnersByIds: mockViewOwners,
        findSummariesByIds: mockViewSummaries,
      },
      connectorInstances: { findOwnersByIds: mockInstanceOwners },
      stationViews: {
        findByStationId: mockViewLinks,
        insertManyIgnoreConflicts: mockViewInsert,
        softDeleteByStationAndViews: mockViewSoftDelete,
        findByStationIds: mockViewLinksForStations,
      },
      stationInstances: {
        findByStationId: mockInstanceLinks,
        insertManyIgnoreConflicts: mockInstanceInsert,
        softDeleteByStationAndInstances: mockInstanceSoftDelete,
      },
    },
  },
}));

jest.unstable_mockModule("../../services/permission.service.js", () => ({
  PermissionService: { loadSet: mockLoadSet },
}));

jest.unstable_mockModule("../../services/audit.service.js", () => ({
  AuditService: { record: mockAuditRecord },
}));

const { StationAttachmentService } =
  await import("../../services/station-attachment.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG = "org-1";
const TX = { tx: true } as unknown as DbClient;

/** A set that grants read on exactly `readable` ids. */
const setReading = (...readable: string[]): PermissionSet =>
  ({
    can: (_action: string, object?: { id?: string }) =>
      readable.includes(object?.id ?? ""),
  }) as unknown as PermissionSet;

/** findOwnersByIds that knows exactly `known` ids (the rest are missing). */
const ownersOf =
  (...known: string[]) =>
  async (ids: string[]) =>
    ids
      .filter((id) => known.includes(id))
      .map((id) => ({ id, createdBy: "u" }));

beforeEach(() => {
  jest.clearAllMocks();
  mockViewLinks.mockResolvedValue([]);
  mockInstanceLinks.mockResolvedValue([]);
  mockViewInsert.mockImplementation(async (rows) => rows);
  mockInstanceInsert.mockImplementation(async (rows) => rows);
  mockViewSoftDelete.mockResolvedValue([]);
  mockInstanceSoftDelete.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// assertAttachable (spec case 4)
// ---------------------------------------------------------------------------

describe("StationAttachmentService.assertAttachable", () => {
  const denied = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e as { status: number; code: string; message: string }
    );
    expect(err).toMatchObject({
      status: 403,
      code: ApiCode.STATION_ATTACHMENT_NOT_READABLE,
    });
    return err!.message;
  };

  it("passes when every id is in the org and readable", async () => {
    mockViewOwners.mockImplementation(ownersOf("v1", "v2"));
    mockInstanceOwners.mockImplementation(ownersOf("c1"));
    await expect(
      StationAttachmentService.assertAttachable(
        setReading("v1", "v2", "c1"),
        ORG,
        {
          curatedViewIds: ["v1", "v2"],
          connectorInstanceIds: ["c1"],
        }
      )
    ).resolves.toBeUndefined();
    expect(mockViewOwners).toHaveBeenCalledWith(["v1", "v2"], ORG, undefined);
  });

  it("refuses a missing, a cross-org and an unreadable id with the same message", async () => {
    // A missing id and a cross-org id look the same: the org-scoped lookup
    // doesn't return them.
    mockViewOwners.mockImplementation(ownersOf("v1", "hidden"));
    const missing = await denied(
      StationAttachmentService.assertAttachable(setReading("v1"), ORG, {
        curatedViewIds: ["v1", "nope"],
      })
    );
    const crossOrg = await denied(
      StationAttachmentService.assertAttachable(setReading("v1"), ORG, {
        curatedViewIds: ["other-org-view"],
      })
    );
    const unreadable = await denied(
      StationAttachmentService.assertAttachable(setReading("v1"), ORG, {
        curatedViewIds: ["hidden"],
      })
    );
    expect(new Set([missing, crossOrg, unreadable]).size).toBe(1);
  });

  it("checks connector ids the same way", async () => {
    mockInstanceOwners.mockImplementation(ownersOf("c1"));
    await denied(
      StationAttachmentService.assertAttachable(setReading(), ORG, {
        connectorInstanceIds: ["c1"],
      })
    );
  });

  it("does no lookup for empty or absent arrays", async () => {
    await StationAttachmentService.assertAttachable(setReading(), ORG, {
      curatedViewIds: [],
    });
    expect(mockViewOwners).not.toHaveBeenCalled();
    expect(mockInstanceOwners).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyChanges (spec case 5, reworked by the adversarial walk: add/remove
// changes instead of a full set, so a stale editor can't re-attach what
// another editor just removed)
// ---------------------------------------------------------------------------

describe("StationAttachmentService.applyChanges", () => {
  const args = (
    add: string[],
    remove: string[],
    kind: "curated_view" | "connector_instance" = "curated_view"
  ) => ({
    stationId: "st-1",
    organizationId: ORG,
    userId: "user-1",
    kind,
    add,
    remove,
  });

  it("adds new ids and soft-deletes removed readable ones", async () => {
    mockViewLinks.mockResolvedValue([
      { curatedViewId: "v1" },
      { curatedViewId: "v2" },
    ]);
    mockViewOwners.mockImplementation(ownersOf("v1", "v2", "v3"));
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("v1", "v2", "v3"),
      args(["v3"], ["v1"])
    );
    expect(diff).toEqual({ added: ["v3"], removed: ["v1"] });
    expect(
      mockViewInsert.mock.calls[0]![0].map((r) => r.curatedViewId)
    ).toEqual(["v3"]);
    expect(mockViewSoftDelete).toHaveBeenCalledWith(
      "st-1",
      ["v1"],
      "user-1",
      TX
    );
  });

  it("leaves attachments it isn't told about alone (no full-set replace)", async () => {
    mockViewLinks.mockResolvedValue([
      { curatedViewId: "v1" },
      { curatedViewId: "v2" },
    ]);
    mockViewOwners.mockImplementation(ownersOf("v1", "v2", "v3"));
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("v1", "v2", "v3"),
      args(["v3"], [])
    );
    expect(diff).toEqual({ added: ["v3"], removed: [] });
    expect(mockViewSoftDelete).not.toHaveBeenCalled();
  });

  it("skips removing an attachment the caller can't read", async () => {
    mockViewLinks.mockResolvedValue([
      { curatedViewId: "v1" },
      { curatedViewId: "v2" },
    ]);
    mockViewOwners.mockImplementation(ownersOf("v1", "v2"));
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("v2"),
      args([], ["v1", "v2"])
    );
    expect(diff).toEqual({ added: [], removed: ["v2"] });
  });

  it("removes a dangling attachment (its object is gone)", async () => {
    mockViewLinks.mockResolvedValue([{ curatedViewId: "gone" }]);
    mockViewOwners.mockImplementation(ownersOf());
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading(),
      args([], ["gone"])
    );
    expect(diff.removed).toEqual(["gone"]);
  });

  it("treats adding an already-attached id (even unreadable) and removing an unattached one as no-ops", async () => {
    mockViewLinks.mockResolvedValue([{ curatedViewId: "v1" }]);
    mockViewOwners.mockImplementation(ownersOf("v1", "v9"));
    await expect(
      StationAttachmentService.applyChanges(
        TX,
        setReading("v9"),
        args(["v1"], ["v9"])
      )
    ).resolves.toEqual({ added: [], removed: [] });
  });

  it("refuses to add an unreadable id, before writing anything", async () => {
    mockViewOwners.mockImplementation(ownersOf("v9"));
    await expect(
      StationAttachmentService.applyChanges(TX, setReading(), args(["v9"], []))
    ).rejects.toMatchObject({ code: ApiCode.STATION_ATTACHMENT_NOT_READABLE });
    expect(mockViewInsert).not.toHaveBeenCalled();
    expect(mockViewSoftDelete).not.toHaveBeenCalled();
  });

  it("de-dupes the ids", async () => {
    mockViewOwners.mockImplementation(ownersOf("v1"));
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("v1"),
      args(["v1", "v1"], [])
    );
    expect(diff.added).toEqual(["v1"]);
    expect(mockViewInsert.mock.calls[0]![0]).toHaveLength(1);
  });

  it("reports only the rows actually inserted (a concurrent add wins the conflict)", async () => {
    mockViewOwners.mockImplementation(ownersOf("v1"));
    mockViewInsert.mockResolvedValue([]);
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("v1"),
      args(["v1"], [])
    );
    expect(diff.added).toEqual([]);
  });

  it("works the same way for connector instances", async () => {
    mockInstanceLinks.mockResolvedValue([
      { connectorInstanceId: "c1" },
      { connectorInstanceId: "c2" },
    ]);
    mockInstanceOwners.mockImplementation(ownersOf("c1", "c2", "c3"));
    const diff = await StationAttachmentService.applyChanges(
      TX,
      setReading("c2", "c3"),
      args(["c3"], ["c1", "c2"], "connector_instance")
    );
    // c1 is unreadable, so its removal is skipped; c2 goes; c3 is added.
    expect(diff).toEqual({ added: ["c3"], removed: ["c2"] });
    expect(mockInstanceLinks).toHaveBeenCalledWith("st-1", {}, TX);
    expect(mockInstanceSoftDelete).toHaveBeenCalledWith(
      "st-1",
      ["c2"],
      "user-1",
      TX
    );
  });
});

// ---------------------------------------------------------------------------
// attachViews / detachViews (#1036)
// ---------------------------------------------------------------------------

describe("StationAttachmentService.attachViews / detachViews (#1036)", () => {
  const CTX = { userId: "user-1", organizationId: ORG, roles: [] as never[] };
  const AUDIT = {
    userId: "user-1",
    organizationId: ORG,
    sourceIp: null,
    userAgent: "portal-agent",
  };
  const STATION = { id: "st-1", organizationId: ORG, createdBy: "owner" };

  /** A set reading `readable` ids, writing only `writable` ids. */
  const setFor = (readable: string[], writable: string[]) =>
    ({
      can: (_a: string, o?: { id?: string }) => readable.includes(o?.id ?? ""),
      check: (_a: string, o?: { id?: string }) => {
        if (!writable.includes(o?.id ?? "")) {
          throw Object.assign(new Error("denied"), {
            status: 403,
            code: ApiCode.PERMISSION_DENIED,
          });
        }
      },
    }) as unknown as PermissionSet;

  const status = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: { status?: number; code?: string }) => e
    );
    return err && { status: err.status, code: err.code };
  };

  beforeEach(() => {
    mockStationFindById.mockResolvedValue(STATION);
    mockLoadSet.mockResolvedValue(setFor(["st-1", "v1", "v2"], ["st-1"]));
    mockViewOwners.mockImplementation(ownersOf("v1", "v2", "v3"));
  });

  it("attaches deduped ids in one transaction and audits only what was added", async () => {
    mockViewLinks.mockResolvedValue([{ curatedViewId: "v2" }]);
    const result = await StationAttachmentService.attachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1", "v1", "v2"] },
      AUDIT
    );
    expect(result).toEqual({
      stationId: "st-1",
      added: ["v1"],
      alreadyAttached: ["v2"],
    });
    const [rows, tx] = mockViewInsert.mock.calls[0];
    expect(rows.map((r) => r.curatedViewId)).toEqual(["v1"]);
    expect(tx).toBe(TX_HANDLE);
    expect(mockAuditRecord).toHaveBeenCalledTimes(1);
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "station.attachments.change",
        targetType: "station",
        targetId: "st-1",
        userAgent: "portal-agent",
        metadata: {
          // #1052: the event carries pack arrays, empty for a view change.
          added: {
            curatedViewIds: ["v1"],
            connectorInstanceIds: [],
            toolPacks: [],
          },
          removed: {
            curatedViewIds: [],
            connectorInstanceIds: [],
            toolPacks: [],
          },
        },
      })
    );
  });

  it("refuses the whole batch when one view is unreadable: no insert, no audit", async () => {
    expect(
      await status(
        StationAttachmentService.attachViews(
          CTX,
          { stationId: "st-1", curatedViewIds: ["v1", "v3"] },
          AUDIT
        )
      )
    ).toEqual({ status: 403, code: ApiCode.STATION_ATTACHMENT_NOT_READABLE });
    expect(mockViewInsert).not.toHaveBeenCalled();
    expect(mockAuditRecord).not.toHaveBeenCalled();
  });

  it("checks an already-attached view's readability too, like the route", async () => {
    mockViewLinks.mockResolvedValue([{ curatedViewId: "v3" }]);
    expect(
      await status(
        StationAttachmentService.attachViews(
          CTX,
          { stationId: "st-1", curatedViewIds: ["v3"] },
          AUDIT
        )
      )
    ).toEqual({ status: 403, code: ApiCode.STATION_ATTACHMENT_NOT_READABLE });
  });

  it("does not audit an attach that added nothing", async () => {
    mockViewLinks.mockResolvedValue([{ curatedViewId: "v1" }]);
    const result = await StationAttachmentService.attachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1"] },
      AUDIT
    );
    expect(result.added).toEqual([]);
    expect(result.alreadyAttached).toEqual(["v1"]);
    expect(mockAuditRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["in another org", { ...STATION, organizationId: "org-2" }],
  ])("answers 404 for a station that is %s", async (_label, station) => {
    mockStationFindById.mockResolvedValue(station);
    expect(
      await status(
        StationAttachmentService.attachViews(
          CTX,
          { stationId: "st-1", curatedViewIds: ["v1"] },
          AUDIT
        )
      )
    ).toEqual({ status: 404, code: ApiCode.STATION_NOT_FOUND });
  });

  it("answers 404 for an unreadable station before checking write", async () => {
    mockLoadSet.mockResolvedValue(setFor(["v1"], []));
    expect(
      await status(
        StationAttachmentService.detachViews(
          CTX,
          { stationId: "st-1", curatedViewIds: ["v1"] },
          AUDIT
        )
      )
    ).toEqual({ status: 404, code: ApiCode.STATION_NOT_FOUND });
  });

  it("answers 403 for a readable station without write", async () => {
    mockLoadSet.mockResolvedValue(setFor(["st-1", "v1"], []));
    expect(
      await status(
        StationAttachmentService.attachViews(
          CTX,
          { stationId: "st-1", curatedViewIds: ["v1"] },
          AUDIT
        )
      )
    ).toEqual({ status: 403, code: ApiCode.PERMISSION_DENIED });
    expect(mockViewInsert).not.toHaveBeenCalled();
  });

  it("detaches with station write alone, reporting what wasn't attached", async () => {
    // v3 is unreadable to the caller; detaching is an edit to the station.
    // The delete reports which links it removed.
    mockViewSoftDelete.mockResolvedValue(["v1", "v3"]);
    const result = await StationAttachmentService.detachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1", "v3", "v9"] },
      AUDIT
    );
    expect(result).toEqual({
      stationId: "st-1",
      removed: ["v1", "v3"],
      notAttached: ["v9"],
    });
    expect(mockViewSoftDelete).toHaveBeenCalledWith(
      "st-1",
      ["v1", "v3", "v9"],
      "user-1",
      TX_HANDLE
    );
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          added: {
            curatedViewIds: [],
            connectorInstanceIds: [],
            toolPacks: [],
          },
          removed: {
            curatedViewIds: ["v1", "v3"],
            connectorInstanceIds: [],
            toolPacks: [],
          },
        },
      })
    );
  });

  it("detaching nothing attached is a no-op with no audit", async () => {
    const result = await StationAttachmentService.detachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1"] },
      AUDIT
    );
    expect(result).toEqual({
      stationId: "st-1",
      removed: [],
      notAttached: ["v1"],
    });
    expect(mockAuditRecord).not.toHaveBeenCalled();
  });

  it("a detach that lost a race to another reports and audits nothing", async () => {
    // Both read the link as attached; only one delete removes it. This one's
    // delete removed no row, so it reports nothing and audits nothing.
    mockViewLinks.mockResolvedValue([{ curatedViewId: "v1" }]);
    mockViewSoftDelete.mockResolvedValue([]);
    const result = await StationAttachmentService.detachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1"] },
      AUDIT
    );
    expect(result.removed).toEqual([]);
    expect(mockAuditRecord).not.toHaveBeenCalled();
  });

  it("records the portal session in the audit metadata, never as a column", async () => {
    mockViewSoftDelete.mockResolvedValue(["v1"]);
    await StationAttachmentService.detachViews(
      CTX,
      { stationId: "st-1", curatedViewIds: ["v1"] },
      { ...AUDIT, sourcePortalId: "portal-9" }
    );
    const event = mockAuditRecord.mock.calls[0]![0] as Record<string, unknown>;
    expect(event).not.toHaveProperty("sourcePortalId");
    expect(event.metadata).toMatchObject({ sourcePortalId: "portal-9" });
  });
});

// ---------------------------------------------------------------------------
// listViewsForStations (#1036)
// ---------------------------------------------------------------------------

describe("StationAttachmentService.listViewsForStations (#1036)", () => {
  const summary = (id: string, createdBy = "u") => ({
    id,
    key: `${id}_key`,
    label: `${id} label`,
    connectorEntityId: "e1",
    createdBy,
  });

  it("reads every station's views in one batched lookup", async () => {
    mockViewLinksForStations.mockResolvedValue([
      { stationId: "st-1", curatedViewId: "v1" },
      { stationId: "st-2", curatedViewId: "v1" },
      { stationId: "st-2", curatedViewId: "v2" },
    ]);
    mockViewSummaries.mockResolvedValue([summary("v1"), summary("v2")]);

    const byStation = await StationAttachmentService.listViewsForStations(
      setReading("v1", "v2"),
      ORG,
      ["st-1", "st-2", "st-3"]
    );

    expect(mockViewLinksForStations).toHaveBeenCalledTimes(1);
    expect(mockViewSummaries).toHaveBeenCalledTimes(1);
    expect(mockViewSummaries).toHaveBeenCalledWith(
      ["v1", "v2"],
      ORG,
      undefined
    );
    expect(byStation.get("st-1")).toEqual([
      { id: "v1", key: "v1_key", label: "v1 label", canRead: true },
    ]);
    expect(byStation.get("st-2")).toHaveLength(2);
    expect(byStation.get("st-3")).toEqual([]);
  });

  it("gives an unreadable or deleted view no id, key or label", async () => {
    mockViewLinksForStations.mockResolvedValue([
      { stationId: "st-1", curatedViewId: "v1" },
      { stationId: "st-1", curatedViewId: "v-secret" },
      { stationId: "st-1", curatedViewId: "v-gone" },
    ]);
    mockViewSummaries.mockResolvedValue([summary("v1"), summary("v-secret")]);

    const byStation = await StationAttachmentService.listViewsForStations(
      setReading("v1"),
      ORG,
      ["st-1"]
    );

    expect(byStation.get("st-1")).toEqual([
      { id: "v1", key: "v1_key", label: "v1 label", canRead: true },
      { canRead: false, label: null },
      { canRead: false, label: null },
    ]);
  });

  it("does no lookup for an empty station list", async () => {
    const byStation = await StationAttachmentService.listViewsForStations(
      setReading(),
      ORG,
      []
    );
    expect(byStation.size).toBe(0);
    expect(mockViewLinksForStations).not.toHaveBeenCalled();
  });
});
