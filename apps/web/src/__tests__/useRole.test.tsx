import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockCurrent = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: mockCurrent } },
}));

const { useRole } = await import("../utils/use-role.util");

// useRole is pure given the (mocked) query result — no real hooks execute, so
// it can be invoked directly.
describe("useRole (#576)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("owner → isOwner + isAdminOrOwner", () => {
    mockCurrent.mockReturnValue({ data: { role: "owner", organization: {} } });
    expect(useRole()).toEqual({
      role: "owner",
      isOwner: true,
      isAdmin: false,
      isAdminOrOwner: true,
      roleKnown: true,
    });
  });

  it("admin → isAdmin + isAdminOrOwner, not isOwner", () => {
    mockCurrent.mockReturnValue({ data: { role: "admin", organization: {} } });
    expect(useRole()).toMatchObject({
      role: "admin",
      isOwner: false,
      isAdmin: true,
      isAdminOrOwner: true,
    });
  });

  it("member → none of the elevated flags", () => {
    mockCurrent.mockReturnValue({ data: { role: "member", organization: {} } });
    expect(useRole()).toMatchObject({
      role: "member",
      isOwner: false,
      isAdmin: false,
      isAdminOrOwner: false,
      roleKnown: true,
    });
  });

  it("loading (no data) → role null, roleKnown false, no flags", () => {
    mockCurrent.mockReturnValue({ data: undefined });
    expect(useRole()).toEqual({
      role: null,
      isOwner: false,
      isAdmin: false,
      isAdminOrOwner: false,
      roleKnown: false,
    });
  });
});
