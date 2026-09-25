import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────
// The container is the wiring under test (#637): seed the Members field from the
// group's membership on edit-open, and persist via setMembers on BOTH create and
// edit. Mock the SDK so we drive those hooks directly.

type MutateOpts = { onSuccess?: (d: unknown) => void };
const mockGroupMembers = jest.fn<() => { data?: { userIds: string[] } }>();
const mockCreateMutate = jest.fn<(vars: unknown, opts: MutateOpts) => void>();
const mockUpdateMutate = jest.fn<(vars: unknown, opts: MutateOpts) => void>();
const mockSetMembers = jest.fn<(v: unknown) => Promise<unknown>>();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    policies: { list: () => ({ data: { policies: [] } }) },
    members: {
      list: () => ({
        data: {
          members: [{ userId: "u-1", email: "u1@example.io", name: null }],
        },
      }),
    },
    groups: {
      members: mockGroupMembers,
      create: () => ({
        mutate: mockCreateMutate,
        isPending: false,
        error: null,
      }),
      update: () => ({
        mutate: mockUpdateMutate,
        isPending: false,
        error: null,
      }),
      setMembers: () => ({
        mutateAsync: mockSetMembers,
        isPending: false,
        error: null,
      }),
    },
  },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { GroupEditorDialog } =
  await import("../modules/AccessAuthoring/GroupEditorDialog.component");

const editGroup = {
  id: "g-1",
  name: "Analysts",
  description: null,
  policyIds: [],
  memberCount: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGroupMembers.mockReturnValue({ data: { userIds: [] } });
  mockSetMembers.mockResolvedValue({});
  mockCreateMutate.mockImplementation((_vars, opts) =>
    opts?.onSuccess?.({ group: { id: "new-g" } })
  );
  mockUpdateMutate.mockImplementation((_vars, opts) =>
    opts?.onSuccess?.({ group: { id: "g-1" } })
  );
});

describe("GroupEditorDialog (#637)", () => {
  it("seeds the Members field from the group's members on edit-open", () => {
    mockGroupMembers.mockReturnValue({ data: { userIds: ["u-1"] } });
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    // The seeded member renders as a chip via its roster label — not an empty field.
    expect(screen.getByText("u1@example.io")).toBeInTheDocument();
  });

  it("saves membership on edit (setMembers with the group id + ids)", () => {
    mockGroupMembers.mockReturnValue({ data: { userIds: ["u-1"] } });
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockSetMembers).toHaveBeenCalledWith({
      id: "g-1",
      userIds: ["u-1"],
    });
  });

  it("still saves membership on create (unified path)", () => {
    render(<GroupEditorDialog open onClose={jest.fn()} group={null} />);
    fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
      target: { value: "New Team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockSetMembers).toHaveBeenCalledWith({ id: "new-g", userIds: [] });
  });
});
