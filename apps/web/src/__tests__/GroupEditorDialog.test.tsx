import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────
// The container is the wiring under test (#637): seed the Members field from the
// group's membership on edit-open, and persist via setMembers on BOTH create and
// edit. Mock the SDK so we drive those hooks directly.

type MutateOpts = { onSuccess?: (d: unknown) => void };
type MembersQuery = {
  data?: { userIds: string[] };
  isLoading?: boolean;
  isError?: boolean;
};
const mockGroupMembers = jest.fn<() => MembersQuery>();
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
  mockGroupMembers.mockReturnValue({
    data: { userIds: [] },
    isLoading: false,
    isError: false,
  });
  mockSetMembers.mockResolvedValue({});
  mockCreateMutate.mockImplementation((_vars, opts) =>
    opts?.onSuccess?.({ group: { id: "new-g" } })
  );
  mockUpdateMutate.mockImplementation((_vars, opts) =>
    opts?.onSuccess?.({ group: { id: "g-1" } })
  );
});

describe("GroupEditorDialog (#637)", () => {
  const loaded = (userIds: string[]) => ({
    data: { userIds },
    isLoading: false,
    isError: false,
  });

  it("seeds the Members field from the group's members on edit-open", () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    // The seeded member renders as a chip via its roster label — not an empty field.
    expect(screen.getByText("u1@example.io")).toBeInTheDocument();
  });

  it("saves membership on edit (setMembers with the group id + ids)", () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockSetMembers).toHaveBeenCalledWith({
      id: "g-1",
      userIds: ["u-1"],
    });
  });

  it("disables Save while the group's members are still loading (edit)", () => {
    mockGroupMembers.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    // Save is blocked until the roster seeds — a submit here would wipe members.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does not wipe membership if saved before the roster seeds (fetch error)", () => {
    mockGroupMembers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    // Save is enabled (not loading) but membership never seeded — the name/policy
    // update lands, and setMembers is skipped so the real membership is untouched.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mockUpdateMutate).toHaveBeenCalled();
    expect(mockSetMembers).not.toHaveBeenCalled();
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
