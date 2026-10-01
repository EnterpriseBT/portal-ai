import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import type { PermissionSet } from "../../services/permission-set.js";
import type { DbClient } from "../../db/repositories/base.repository.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Owner = { id: string; createdBy: string };

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
const mockViewSoftDelete = jest.fn<(...a: unknown[]) => Promise<number>>();
const mockInstanceInsert =
  jest.fn<
    (rows: { connectorInstanceId: string }[], tx: unknown) => Promise<unknown[]>
  >();
const mockInstanceSoftDelete = jest.fn<(...a: unknown[]) => Promise<number>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      curatedViews: { findOwnersByIds: mockViewOwners },
      connectorInstances: { findOwnersByIds: mockInstanceOwners },
      stationViews: {
        findByStationId: mockViewLinks,
        insertManyIgnoreConflicts: mockViewInsert,
        softDeleteByStationAndViews: mockViewSoftDelete,
      },
      stationInstances: {
        findByStationId: mockInstanceLinks,
        insertManyIgnoreConflicts: mockInstanceInsert,
        softDeleteByStationAndInstances: mockInstanceSoftDelete,
      },
    },
  },
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
  mockViewSoftDelete.mockResolvedValue(0);
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
