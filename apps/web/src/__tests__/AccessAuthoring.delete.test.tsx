/**
 * #691: deleting a custom role, policy or group asks first, and the
 * confirm can't fire the delete twice.
 */
import { jest } from "@jest/globals";

const mockRemoveGroup = jest.fn();
let removeGroupPending = false;
const q = (data: unknown) => ({ data, isLoading: false, error: null });
const mutation = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  error: null,
});

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    policies: {
      list: () => q({ policies: [] }),
      remove: mutation,
      create: mutation,
      update: mutation,
    },
    roles: {
      list: () => q({ roles: [] }),
      remove: mutation,
      create: mutation,
      update: mutation,
    },
    groups: {
      list: () =>
        q({
          groups: [
            { id: "g-1", name: "Analysts", memberCount: 2, policyIds: [] },
          ],
        }),
      remove: () => ({
        mutate: mockRemoveGroup,
        reset: jest.fn(),
        isPending: removeGroupPending,
        error: null,
      }),
      create: mutation,
      update: mutation,
      members: () => q({ userIds: [] }),
      setMembers: mutation,
    },
    members: { list: () => q({ members: [] }) },
  },
  queryKeys: {
    policies: { root: ["policies"] },
    roles: { root: ["roles"] },
    groups: { root: ["groups"] },
  },
}));

jest.unstable_mockModule("../api/rbac-objects.api", () => ({
  useRbacObjectSearch: () => jest.fn(async () => []),
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { AccessAuthoring } =
  await import("../modules/AccessAuthoring/AccessAuthoring.component");

beforeEach(() => {
  mockRemoveGroup.mockReset();
  removeGroupPending = false;
});

const openGroups = () => {
  render(<AccessAuthoring />);
  fireEvent.click(screen.getByRole("tab", { name: /Groups/i }));
};

describe("AccessAuthoring delete (#691)", () => {
  it("Delete opens a confirm naming the group; nothing is deleted yet", () => {
    openGroups();
    fireEvent.click(screen.getByRole("button", { name: "delete Analysts" }));
    expect(screen.getByText("Delete group")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Analysts");
    expect(mockRemoveGroup).not.toHaveBeenCalled();
  });

  it("confirming deletes it once", () => {
    openGroups();
    fireEvent.click(screen.getByRole("button", { name: "delete Analysts" }));
    const confirm = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    expect(mockRemoveGroup).toHaveBeenCalledTimes(1);
    expect(mockRemoveGroup.mock.calls[0][0]).toEqual({ id: "g-1" });
  });

  it("a double-click on the confirm sends one delete (before React re-renders)", () => {
    openGroups();
    fireEvent.click(screen.getByRole("button", { name: "delete Analysts" }));
    const confirm = screen.getByRole("button", { name: "Delete" });
    // Two clicks in one tick: no render (so no isPending) in between, which is
    // what a real double-click produced in the smoke walk.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockRemoveGroup).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without deleting", () => {
    openGroups();
    fireEvent.click(screen.getByRole("button", { name: "delete Analysts" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockRemoveGroup).not.toHaveBeenCalled();
  });
});
