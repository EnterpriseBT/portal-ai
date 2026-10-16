import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type User = { id: string; name: string | null; email: string | null };

const mockMembership =
  jest.fn<(orgId: string, userId: string) => Promise<unknown>>();
const mockUsersFindMany = jest.fn<(where: unknown) => Promise<User[]>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizationUsers: { findByOrganizationAndUser: mockMembership },
      users: { findMany: mockUsersFindMany },
    },
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
