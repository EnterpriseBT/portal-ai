import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type User = { id: string; name: string | null; email: string | null };

const mockMembership =
  jest.fn<(orgId: string, userId: string) => Promise<unknown>>();
const mockUsersFindMany = jest.fn<(where: unknown) => Promise<User[]>>();

const mockFindPin = jest.fn<(id: string) => Promise<unknown>>();
const mockCan = jest.fn<(action: string, object: unknown) => boolean>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizationUsers: { findByOrganizationAndUser: mockMembership },
      users: { findMany: mockUsersFindMany },
      portalResults: { findById: mockFindPin },
    },
  },
}));

jest.unstable_mockModule("../../services/permission.service.js", () => ({
  PermissionService: {
    loadSet: async () => ({ can: mockCan }),
  },
}));

const { PinDefinerService, DefinerAccessLostError } =
  await import("../../services/pin-definer.service.js");

function pin(
  over: Partial<{
    id: string;
    definerPrincipalType: "user" | "role";
    definerPrincipalId: string;
  }> = {}
) {
  return {
    id: "pin-1",
    organizationId: "org-1",
    definerPrincipalType: "user" as const,
    definerPrincipalId: "definer-1",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PinDefinerService.assertDefinerActive (#640)", () => {
  it("returns the definer when they are an active member of the pin's org", async () => {
    mockMembership.mockResolvedValue({ id: "ou-1" });
    await expect(PinDefinerService.assertDefinerActive(pin())).resolves.toEqual(
      { userId: "definer-1" }
    );
    expect(mockMembership).toHaveBeenCalledWith("org-1", "definer-1");
  });

  it("throws DefinerAccessLostError when the definer has no membership", async () => {
    mockMembership.mockResolvedValue(undefined);
    await expect(
      PinDefinerService.assertDefinerActive(pin())
    ).rejects.toBeInstanceOf(DefinerAccessLostError);
  });

  it("refuses a role definer as an invariant, without a lookup", async () => {
    await expect(
      PinDefinerService.assertDefinerActive(
        pin({ definerPrincipalType: "role" })
      )
    ).rejects.toMatchObject({
      status: 500,
      code: ApiCode.PORTAL_RESULT_DEFINER_UNSUPPORTED,
    });
    expect(mockMembership).not.toHaveBeenCalled();
  });
});

describe("PinDefinerService.describe (#640)", () => {
  it("names the definer by name, then email, then id", async () => {
    mockUsersFindMany.mockResolvedValue([
      { id: "a", name: "Ada", email: "ada@x.io" },
      { id: "b", name: null, email: "bo@x.io" },
    ]);
    const out = await PinDefinerService.describeMany(
      [
        pin({ id: "p1", definerPrincipalId: "a" }),
        pin({ id: "p2", definerPrincipalId: "b" }),
        pin({ id: "p3", definerPrincipalId: "gone" }),
      ],
      "viewer"
    );
    expect(out.get("p1")!.definer).toEqual({ id: "a", displayName: "Ada" });
    expect(out.get("p2")!.definer.displayName).toBe("bo@x.io");
    expect(out.get("p3")!.definer.displayName).toBe("gone");
  });

  it("flags viewerIsDefiner only for the definer themselves", async () => {
    mockUsersFindMany.mockResolvedValue([]);
    expect(
      (await PinDefinerService.describe(pin(), "definer-1")).viewerIsDefiner
    ).toBe(true);
    expect(
      (await PinDefinerService.describe(pin(), "someone-else")).viewerIsDefiner
    ).toBe(false);
  });

  it("loads every definer on a page with one users query", async () => {
    mockUsersFindMany.mockResolvedValue([]);
    await PinDefinerService.describeMany(
      [
        pin({ id: "p1", definerPrincipalId: "a" }),
        pin({ id: "p2", definerPrincipalId: "a" }),
        pin({ id: "p3", definerPrincipalId: "b" }),
      ],
      "viewer"
    );
    expect(mockUsersFindMany).toHaveBeenCalledTimes(1);
  });

  it("skips the query for an empty page", async () => {
    const out = await PinDefinerService.describeMany([], "viewer");
    expect(out.size).toBe(0);
    expect(mockUsersFindMany).not.toHaveBeenCalled();
  });
});

describe("PinDefinerService.authorizeHandleRead (#640)", () => {
  const ctx = { userId: "sharee", organizationId: "org-1", roles: [] };
  const handle = { portalResultId: "pin-1", userId: "definer-1" };
  const row = { ...pin(), createdBy: "definer-1" };
  const canRead = (action: string) => action === "resource.read";

  it("lets a reader who isn't the definer page the definer's handle", async () => {
    mockFindPin.mockResolvedValue(row);
    mockCan.mockImplementation(canRead);
    mockMembership.mockResolvedValue({ id: "ou-1" });
    await expect(
      PinDefinerService.authorizeHandleRead(handle, ctx)
    ).resolves.toBeUndefined();
  });

  it("answers an expired handle once the pin is unshared, or in another org", async () => {
    mockFindPin.mockResolvedValue(row);
    mockCan.mockReturnValue(false);
    await expect(
      PinDefinerService.authorizeHandleRead(handle, ctx)
    ).rejects.toMatchObject({ status: 404, code: ApiCode.READ_HANDLE_EXPIRED });

    mockFindPin.mockResolvedValue({ ...row, organizationId: "org-2" });
    mockCan.mockReturnValue(true);
    await expect(
      PinDefinerService.authorizeHandleRead(handle, ctx)
    ).rejects.toMatchObject({ status: 404, code: ApiCode.READ_HANDLE_EXPIRED });
  });

  it("refuses neutrally to a reader once the definer is removed", async () => {
    mockFindPin.mockResolvedValue(row);
    mockCan.mockImplementation(canRead);
    mockMembership.mockResolvedValue(undefined);
    await expect(
      PinDefinerService.authorizeHandleRead(handle, ctx)
    ).rejects.toMatchObject({
      status: 422,
      code: ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE,
    });
  });

  it("tells a caller who manages the pin why", async () => {
    mockFindPin.mockResolvedValue(row);
    mockCan.mockReturnValue(true);
    mockMembership.mockResolvedValue(undefined);
    await expect(
      PinDefinerService.authorizeHandleRead(handle, ctx)
    ).rejects.toMatchObject({
      status: 422,
      code: ApiCode.PORTAL_RESULT_DEFINER_ACCESS_LOST,
    });
  });

  it("refuses a handle produced as someone other than the pin's definer", async () => {
    mockFindPin.mockResolvedValue(row);
    mockCan.mockImplementation(canRead);
    mockMembership.mockResolvedValue({ id: "ou-1" });
    await expect(
      PinDefinerService.authorizeHandleRead(
        { ...handle, userId: "someone-else" },
        ctx
      )
    ).rejects.toMatchObject({ status: 422 });
  });
});
