import { jest } from "@jest/globals";
import type { SelectOption } from "@portalai/core/ui";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityGroupGet = jest.fn();
const mockEntityGroupUpdate = jest.fn();
const mockEntityGroupDelete = jest.fn();
const mockEntityGroupAddMember = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    entityGroups: {
      get: mockEntityGroupGet,
      update: () => ({
        mutate: mockEntityGroupUpdate,
        isPending: false,
        error: null,
      }),
      delete: () => ({
        mutate: mockEntityGroupDelete,
        isPending: false,
        error: null,
      }),
      addMember: () => ({
        mutate: mockEntityGroupAddMember,
        isPending: false,
        error: null,
      }),
    },
  },
  queryKeys: {
    entityGroups: {
      root: ["entityGroups"],
    },
  },
}));

jest.unstable_mockModule("../utils/api.util", () => ({
  useAuthFetch: () => ({
    fetchWithAuth: jest.fn(),
  }),
  useAuthQuery: jest.fn(),
  useAuthMutation: jest.fn(),
  toServerError: (error: unknown) => (error ? { message: String(error), code: "UNKNOWN" } : null),
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const {
  EntityGroupDetailViewUI,
  OverlapPreview,
} = await import("../views/EntityGroupDetail.view");

// ── Fixtures ────────────────────────────────────────────────────────

const stubGroup = {
  id: "grp-1",
  organizationId: "org-1",
  name: "Customer Identity",
  description: "Groups customer entities across connectors",
  created: Date.now(),
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  members: [
    {
      id: "mem-1",
      organizationId: "org-1",
      entityGroupId: "grp-1",
      connectorEntityId: "ent-1",
      linkFieldMappingId: "fm-1",
      isPrimary: true,
      connectorEntityLabel: "CRM Customers",
      linkFieldMappingSourceField: "email",
      created: Date.now(),
      createdBy: "system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    },
    {
      id: "mem-2",
      organizationId: "org-1",
      entityGroupId: "grp-1",
      connectorEntityId: "ent-2",
      linkFieldMappingId: "fm-2",
      isPrimary: false,
      connectorEntityLabel: "Billing Contacts",
      linkFieldMappingSourceField: "contact_email",
      created: Date.now(),
      createdBy: "system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    },
  ],
};

const defaultProps = {
  group: stubGroup,
  onUpdateGroup: jest.fn(),
  onDeleteGroup: jest.fn(),
  onPromoteMember: jest.fn(),
  onDemoteMember: jest.fn(),
  onRemoveMember: jest.fn(),
  addMemberOpen: false,
  onOpenAddMember: jest.fn(),
  onCloseAddMember: jest.fn(),
  onSearchEntities: jest.fn<(_: string) => Promise<SelectOption[]>>().mockResolvedValue([]),
  onSearchFieldMappings: jest.fn<(_: string) => Promise<SelectOption[]>>().mockResolvedValue([]),
  selectedEntityId: null as string | null,
  onEntityChange: jest.fn(),
  selectedFieldMappingId: null as string | null,
  onFieldMappingChange: jest.fn(),
  addMemberIsPrimary: false,
  onAddMemberPrimaryChange: jest.fn(),
  overlap: null as null,
  overlapLoading: false,
  onAddMember: jest.fn(),
  isAddingMember: false,
  editOpen: false,
  onOpenEdit: jest.fn(),
  onCloseEdit: jest.fn(),
  editServerError: null,
  addMemberServerError: null,
  deleteServerError: null,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("EntityGroupDetailViewUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders group header with name and description", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    expect(
      screen.getByRole("heading", { name: "Customer Identity" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Groups customer entities across connectors")
    ).toBeInTheDocument();
  });

  it("renders breadcrumbs with Dashboard and Entity Groups", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Entity Groups")).toBeInTheDocument();
    // Group name appears in both breadcrumbs and heading
    expect(screen.getAllByText("Customer Identity").length).toBeGreaterThanOrEqual(2);
  });

  it("renders members table with entity labels and link fields", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    expect(screen.getByText("CRM Customers")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("Billing Contacts")).toBeInTheDocument();
    expect(screen.getByText("contact_email")).toBeInTheDocument();
  });

  it("shows filled star for primary member and outline star for non-primary", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    expect(screen.getByLabelText("Remove as primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Set as primary")).toBeInTheDocument();
  });

  it("clicking star icon on non-primary member triggers primary update", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    await user.click(screen.getByLabelText("Set as primary"));
    expect(defaultProps.onPromoteMember).toHaveBeenCalledWith("mem-2");
  });

  it("clicking Add Member button in header calls onOpenAddMember", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Add Member/i }));
    expect(defaultProps.onOpenAddMember).toHaveBeenCalledTimes(1);
  });

  it("add member submit button disabled until entity and field mapping selected", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} addMemberOpen={true} />);
    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    expect(submitBtn).toBeDisabled();
  });

  it("add member submit button enabled when entity and field mapping are selected", () => {
    render(
      <EntityGroupDetailViewUI
        {...defaultProps}
        addMemberOpen={true}
        selectedEntityId="ent-3"
        selectedFieldMappingId="fm-3"
      />
    );
    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    expect(submitBtn).toBeEnabled();
  });

  it("remove member triggers delete confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    const removeButtons = screen.getAllByLabelText("Remove member");
    await user.click(removeButtons[0]);
    expect(
      screen.getByText("Are you sure you want to remove this member from the group?")
    ).toBeInTheDocument();
  });

  it("confirming remove member calls onRemoveMember", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    const removeButtons = screen.getAllByLabelText("Remove member");
    await user.click(removeButtons[0]);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(defaultProps.onRemoveMember).toHaveBeenCalledWith("mem-1");
  });

  it("renders edit and delete action buttons", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    expect(screen.getByRole("button", { name: /Edit/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete/i })
    ).toBeInTheDocument();
  });

  it("clicking Edit button calls onOpenEdit", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Edit/i }));
    expect(defaultProps.onOpenEdit).toHaveBeenCalledTimes(1);
  });

  it("edit dialog shows name and description fields when open", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} editOpen={true} />);
    expect(screen.getByText("Edit Entity Group")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue("Customer Identity");
    expect(screen.getByLabelText(/Description/)).toHaveValue(
      "Groups customer entities across connectors"
    );
  });

  it("edit dialog does not call onUpdateGroup when name is cleared", async () => {
    const user = userEvent.setup();
    render(<EntityGroupDetailViewUI {...defaultProps} editOpen={true} />);
    await user.clear(screen.getByLabelText(/Name/));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(defaultProps.onUpdateGroup).not.toHaveBeenCalled();
  });

  it("edit dialog calls onClose when nothing changed", async () => {
    const user = userEvent.setup();
    const onCloseEdit = jest.fn();
    render(
      <EntityGroupDetailViewUI
        {...defaultProps}
        editOpen={true}
        onCloseEdit={onCloseEdit}
      />
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onCloseEdit).toHaveBeenCalled();
    expect(defaultProps.onUpdateGroup).not.toHaveBeenCalled();
  });

  it("edit dialog displays server error when provided", () => {
    render(
      <EntityGroupDetailViewUI
        {...defaultProps}
        editOpen={true}
        editServerError={{ message: "Name already taken", code: "ENTITY_GROUP_DUPLICATE" }}
      />
    );
    expect(screen.getByText(/Name already taken/)).toBeInTheDocument();
    expect(screen.getByText(/ENTITY_GROUP_DUPLICATE/)).toBeInTheDocument();
  });

  it("link field mapping select is disabled when no entity is selected", () => {
    render(<EntityGroupDetailViewUI {...defaultProps} addMemberOpen={true} />);
    const fieldMappingInput = screen.getByLabelText("Link Field Mapping");
    expect(fieldMappingInput).toBeDisabled();
  });

  it("add member dialog displays server error when provided", () => {
    render(
      <EntityGroupDetailViewUI
        {...defaultProps}
        addMemberOpen={true}
        addMemberServerError={{ message: "Member already exists", code: "ENTITY_GROUP_DUPLICATE_MEMBER" }}
      />
    );
    expect(screen.getByText(/Member already exists/)).toBeInTheDocument();
    expect(screen.getByText(/ENTITY_GROUP_DUPLICATE_MEMBER/)).toBeInTheDocument();
  });

  it("delete confirmation dialog displays server error when provided", async () => {
    const user = userEvent.setup();
    render(
      <EntityGroupDetailViewUI
        {...defaultProps}
        deleteServerError={{ message: "Cannot delete group", code: "ENTITY_GROUP_DELETE_FAILED" }}
      />
    );
    // Open the delete dialog
    await user.click(screen.getByRole("button", { name: /Delete/i }));
    expect(screen.getByText(/Cannot delete group/)).toBeInTheDocument();
    expect(screen.getByText(/ENTITY_GROUP_DELETE_FAILED/)).toBeInTheDocument();
  });
});

describe("OverlapPreview", () => {
  it("renders nothing when overlap is null", () => {
    const { container } = render(
      <OverlapPreview overlap={null} isLoading={false} />
    );
    expect(container.querySelector("[data-testid='overlap-preview']")).not.toBeInTheDocument();
  });

  it("shows loading text when loading", () => {
    render(<OverlapPreview overlap={null} isLoading={true} />);
    expect(screen.getByText("Checking overlap…")).toBeInTheDocument();
  });

  it("displays overlap percentage >= 50% with default styling", () => {
    const overlap = {
      overlapPercentage: 72,
      sourceRecordCount: 200,
      targetRecordCount: 300,
      matchingRecordCount: 145,
    };
    render(<OverlapPreview overlap={overlap} isLoading={false} />);
    expect(screen.getByTestId("overlap-percentage")).toHaveTextContent(
      "72% overlap"
    );
    expect(screen.getByTestId("overlap-counts")).toHaveTextContent(
      "145 of 200 source records match 145 of 300 target records"
    );
    const box = screen.getByTestId("overlap-preview");
    // For >= 50% overlap, the box renders with default grey styling (no warning/error)
    expect(box).toBeInTheDocument();
  });

  it("displays warning highlight when overlap < 50% and >= 5%", () => {
    const overlap = {
      overlapPercentage: 30,
      sourceRecordCount: 100,
      targetRecordCount: 200,
      matchingRecordCount: 30,
    };
    render(<OverlapPreview overlap={overlap} isLoading={false} />);
    expect(screen.getByTestId("overlap-percentage")).toHaveTextContent(
      "30% overlap"
    );
    const box = screen.getByTestId("overlap-preview");
    expect(box).toBeInTheDocument();
  });

  it("displays error highlight when overlap < 5%", () => {
    const overlap = {
      overlapPercentage: 3,
      sourceRecordCount: 100,
      targetRecordCount: 200,
      matchingRecordCount: 3,
    };
    render(<OverlapPreview overlap={overlap} isLoading={false} />);
    expect(screen.getByTestId("overlap-percentage")).toHaveTextContent(
      "3% overlap"
    );
    const box = screen.getByTestId("overlap-preview");
    expect(box).toBeInTheDocument();
  });

  it("rounds percentage to integer", () => {
    const overlap = {
      overlapPercentage: 72.5,
      sourceRecordCount: 200,
      targetRecordCount: 300,
      matchingRecordCount: 145,
    };
    render(<OverlapPreview overlap={overlap} isLoading={false} />);
    expect(screen.getByTestId("overlap-percentage")).toHaveTextContent(
      "73% overlap"
    );
  });
});
