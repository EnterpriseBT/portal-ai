import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────
// The container is the wiring under test (#637): seed the Members field from the
// group's membership on edit-open, and persist via setMembers on BOTH create and
// edit. Mock the SDK so we drive those hooks directly.

type MembersQuery = {
  data?: { userIds: string[] };
  isLoading?: boolean;
  isError?: boolean;
};
const mockGroupMembers = jest.fn<() => MembersQuery>();
const mockCreateMutate =
  jest.fn<(vars: unknown, opts?: unknown) => Promise<unknown>>();
const mockUpdateMutate =
  jest.fn<(vars: unknown, opts?: unknown) => Promise<unknown>>();
const mockSetMembers =
  jest.fn<(v: unknown, opts?: unknown) => Promise<unknown>>();

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
        mutateAsync: mockCreateMutate,
        reset: jest.fn(),
        isPending: false,
        error: null,
      }),
      update: () => ({
        mutateAsync: mockUpdateMutate,
        reset: jest.fn(),
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

const { queryKeys } = await import("../api/keys");
const { QueryClient } = await import("@tanstack/react-query");
const {
  render,
  screen,
  fireEvent,
  waitFor,
  pressEnter,
  expectNoAxeViolations,
} = await import("./test-utils");
const { GroupEditorDialog, GroupEditorDialogUI } =
  await import("../modules/AccessAuthoring/GroupEditorDialog.component");

const editGroup = {
  id: "g-1",
  name: "Analysts",
  description: null,
  policyIds: [],
  memberCount: 1,
  sourcePortalId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGroupMembers.mockReturnValue({
    data: { userIds: [] },
    isLoading: false,
    isError: false,
  });
  mockSetMembers.mockResolvedValue({});
  // #985: the save runs on the writes' promises, never a per-call onSuccess
  // (which React Query skips once the page unmounts), so the fakes only
  // resolve.
  mockCreateMutate.mockResolvedValue({ group: { id: "new-g" } });
  mockUpdateMutate.mockResolvedValue({ group: { id: "g-1" } });
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

  it("has no axe violations when open (#793)", async () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    render(<GroupEditorDialog open onClose={jest.fn()} group={editGroup} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("saves membership on edit (setMembers with the group id + ids)", async () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    const onClose = jest.fn();
    render(<GroupEditorDialog open onClose={onClose} group={editGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // #985: the refresh runs once, from the last write, even if the page
    // unmounts; the group write itself carries none.
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: editGroup.name }),
      undefined
    );
    await waitFor(() =>
      expect(mockSetMembers).toHaveBeenCalledWith(
        { id: "g-1", userIds: ["u-1"] },
        { invalidate: [queryKeys.groups.root] }
      )
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("still refreshes the group list and closes when the membership write fails", async () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    mockSetMembers.mockRejectedValue(new Error("boom"));
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const onClose = jest.fn();
    render(<GroupEditorDialog open onClose={onClose} group={editGroup} />, {
      queryClient,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.groups.root,
    });
  });

  it("stays open when the group write fails", async () => {
    mockGroupMembers.mockReturnValue(loaded(["u-1"]));
    mockUpdateMutate.mockRejectedValue(new Error("refused"));
    const onClose = jest.fn();
    render(<GroupEditorDialog open onClose={onClose} group={editGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalled());
    expect(mockSetMembers).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
    // With no membership write, the group write carries the refresh.
    expect(mockUpdateMutate).toHaveBeenCalledWith(expect.anything(), {
      invalidate: [queryKeys.groups.root],
    });
    expect(mockSetMembers).not.toHaveBeenCalled();
  });

  it("still saves membership on create (unified path)", async () => {
    render(<GroupEditorDialog open onClose={jest.fn()} group={null} />);
    fireEvent.change(screen.getByRole("textbox", { name: /name/i }), {
      target: { value: "New Team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockSetMembers).toHaveBeenCalledWith(
        { id: "new-g", userIds: [] },
        { invalidate: [queryKeys.groups.root] }
      )
    );
  });
});

// #789: the editor's UI saves on a real Enter exactly when Save could.
describe("GroupEditorDialogUI — Enter", () => {
  const uiProps = {
    open: true,
    onClose: jest.fn(),
    group: null,
    name: "Analysts",
    onNameChange: jest.fn(),
    description: "",
    onDescriptionChange: jest.fn(),
    policyIds: [],
    onPolicyIdsChange: jest.fn(),
    policyOptions: [],
    memberIds: [],
    onMemberIdsChange: jest.fn(),
    memberOptions: [],
    onSubmit: jest.fn(),
    serverError: null,
  };

  it("saves on a real Enter in the name field", async () => {
    const onSubmit = jest.fn();
    render(<GroupEditorDialogUI {...uiProps} onSubmit={onSubmit} />);
    await pressEnter(screen.getByRole("textbox", { name: /^name/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("doesn't save on Enter with an empty name", async () => {
    const onSubmit = jest.fn();
    render(<GroupEditorDialogUI {...uiProps} name="" onSubmit={onSubmit} />);
    await pressEnter(screen.getByRole("textbox", { name: /^name/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
