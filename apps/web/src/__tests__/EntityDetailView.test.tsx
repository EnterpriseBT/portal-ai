import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityGet = jest.fn();
const mockRecordsList = jest.fn();
const mockRecordsCount = jest.fn();
const mockRecordsSync = jest.fn();
const mockFieldMappingsValidate = jest.fn();

const emptyQueryResult = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isPending: false,
};

const emptyRecordsList = {
  data: {
    records: [],
    columns: [],
    source: "cache",
    total: 0,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

const stubRecordsList = {
  data: {
    records: [
      {
        id: "rec-1",
        connectorEntityId: "ent-1",
        sourceId: "src-1",
        normalizedData: { first_name: "Jane", email: "jane@ex.com" },
        checksum: "abc",
        syncedAt: null,
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ],
    columns: [
      { key: "first_name", label: "First Name", type: "string" as const, required: false, enumValues: null, defaultValue: null },
      { key: "email", label: "Email", type: "string" as const, required: false, enumValues: null, defaultValue: null },
    ],
    source: "cache" as const,
    total: 1,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorEntities: {
      get: mockEntityGet,
    },
    entityRecords: {
      list: mockRecordsList,
      count: mockRecordsCount,
      sync: mockRecordsSync,
    },
    fieldMappings: {
      validateBidirectional: mockFieldMappingsValidate,
    },
  },
  queryKeys: {
    entityTagAssignments: {
      root: ["entityTagAssignments"],
      listByEntity: (id: string) => ["entityTagAssignments", "listByEntity", id],
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { EntityDetailViewUI } = await import("../views/EntityDetail.view");
const { BidirectionalConsistencyBannerUI } = await import(
  "../components/BidirectionalConsistencyBanner.component"
);

// ── Fixtures ────────────────────────────────────────────────────────

const stubEntity = {
  id: "ent-1",
  connectorInstanceId: "inst-1",
  organizationId: "org-1",
  key: "contacts",
  label: "Contacts",
  created: Date.now(),
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("EntityDetailViewUI", () => {
  beforeEach(() => {
    mockRecordsList.mockReturnValue(emptyRecordsList);
    mockRecordsCount.mockReturnValue(emptyQueryResult);
    mockRecordsSync.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockEntityGet.mockReturnValue(emptyQueryResult);
    mockFieldMappingsValidate.mockReturnValue({ data: undefined });
  });

  it("renders breadcrumbs with Dashboard, Entities, and entity label", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Entities")).toBeInTheDocument();
  });

  it("renders entity label as heading", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(
      screen.getByRole("heading", { name: "Contacts" })
    ).toBeInTheDocument();
  });

  it("renders entity key chip", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(screen.getByText("contacts")).toBeInTheDocument();
  });

  it("renders entity metadata when provided", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        connectorInstanceName="My CSV"
        accessMode="import"
        recordCount={150}
        lastSyncAt={Date.now()}
      />
    );
    expect(screen.getByText("My CSV")).toBeInTheDocument();
    expect(screen.getByText("import")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("Last sync")).toBeInTheDocument();
  });

  it("renders sync button for import access mode", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        accessMode="import"
        onSync={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Sync" })
    ).toBeInTheDocument();
  });

  it("renders sync button for hybrid access mode", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        accessMode="hybrid"
        onSync={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Sync" })
    ).toBeInTheDocument();
  });

  it("hides sync button for live access mode", () => {
    render(
      <EntityDetailViewUI entity={stubEntity} accessMode="live" />
    );
    expect(
      screen.queryByRole("button", { name: "Sync" })
    ).not.toBeInTheDocument();
  });

  it("hides sync button when no access mode is set", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(
      screen.queryByRole("button", { name: "Sync" })
    ).not.toBeInTheDocument();
  });

  it("calls onSync when sync button is clicked", async () => {
    const onSync = jest.fn();
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        accessMode="import"
        onSync={onSync}
      />
    );
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(onSync).toHaveBeenCalled();
  });

  it("shows syncing state when isSyncing is true", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        accessMode="import"
        isSyncing={true}
        onSync={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Syncing…" })
    ).toBeDisabled();
  });

  it("clicking a row calls onRecordClick with the correct recordId", async () => {
    const onRecordClick = jest.fn();
    mockRecordsList.mockReturnValue(stubRecordsList);
    render(<EntityDetailViewUI entity={stubEntity} onRecordClick={onRecordClick} />);

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByText("Jane"));

    expect(onRecordClick).toHaveBeenCalledWith("rec-1");
  });

  it("does not render any warning banners when no bidirectionalFieldMappings are provided", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a warning banner when isConsistent is false for a bidirectional field mapping", () => {
    mockFieldMappingsValidate.mockReturnValue({
      data: {
        isConsistent: false,
        inconsistentRecordIds: ["rec-1"],
        totalChecked: 5,
      },
    });
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        bidirectionalFieldMappings={[
          { id: "fm-1", sourceField: "related_contacts" },
        ]}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/related_contacts/)).toBeInTheDocument();
  });

  it("does not render warning banners when isConsistent is true", () => {
    mockFieldMappingsValidate.mockReturnValue({
      data: { isConsistent: true, inconsistentRecordIds: [], totalChecked: 5 },
    });
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        bidirectionalFieldMappings={[{ id: "fm-1", sourceField: "tags" }]}
      />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders assigned tags as chips when tags are provided", () => {
    const tags = [
      {
        id: "tag-1",
        organizationId: "org-1",
        name: "Important",
        color: "#ff0000",
        description: null,
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        assignmentId: "assignment-1",
      },
      {
        id: "tag-2",
        organizationId: "org-1",
        name: "Archive",
        color: null,
        description: null,
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        assignmentId: "assignment-2",
      },
    ];
    render(<EntityDetailViewUI entity={stubEntity} tags={tags} />);
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("Important")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("does not render tags section when tags prop is not provided", () => {
    render(<EntityDetailViewUI entity={stubEntity} />);
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("renders the tag assignment autocomplete when onSearchTags and onAssignTag are provided", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        tags={[]}
        onSearchTags={jest.fn<() => Promise<never[]>>().mockResolvedValue([])}
        onAssignTag={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Add tag")).toBeInTheDocument();
  });

  it("does not block record display when a warning banner is shown", () => {
    mockFieldMappingsValidate.mockReturnValue({
      data: {
        isConsistent: false,
        inconsistentRecordIds: ["rec-1"],
        totalChecked: 5,
      },
    });
    mockRecordsList.mockReturnValue(stubRecordsList);
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        bidirectionalFieldMappings={[{ id: "fm-1", sourceField: "tags" }]}
        onRecordClick={jest.fn()}
      />
    );
    // Warning is shown
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Records are still displayed
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });
});

// ── Create Record Dialog ───────────────────────────────────────────

describe("EntityDetailViewUI — New Record button", () => {
  beforeEach(() => {
    mockRecordsList.mockReturnValue(stubRecordsList);
    mockRecordsCount.mockReturnValue(emptyQueryResult);
    mockRecordsSync.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockEntityGet.mockReturnValue(emptyQueryResult);
    mockFieldMappingsValidate.mockReturnValue({ data: undefined });
  });

  it("shows New Record button when isWriteEnabled and columns exist", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        isWriteEnabled={true}
        onOpenCreateRecordDialog={jest.fn()}
        createRecordDialogOpen={false}
        onCloseCreateRecordDialog={jest.fn()}
        onCreateRecord={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "New Record" })).toBeInTheDocument();
  });

  it("hides New Record button when isWriteEnabled is false", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        isWriteEnabled={false}
        onOpenCreateRecordDialog={jest.fn()}
        createRecordDialogOpen={false}
        onCloseCreateRecordDialog={jest.fn()}
        onCreateRecord={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "New Record" })).not.toBeInTheDocument();
  });

  it("hides New Record button when no columns defined", () => {
    mockRecordsList.mockReturnValue(emptyRecordsList);
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        isWriteEnabled={true}
        onOpenCreateRecordDialog={jest.fn()}
        createRecordDialogOpen={false}
        onCloseCreateRecordDialog={jest.fn()}
        onCreateRecord={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "New Record" })).not.toBeInTheDocument();
  });

  it("opens CreateEntityRecordDialog on New Record click", async () => {
    const onOpen = jest.fn();
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        isWriteEnabled={true}
        onOpenCreateRecordDialog={onOpen}
        createRecordDialogOpen={false}
        onCloseCreateRecordDialog={jest.fn()}
        onCreateRecord={jest.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "New Record" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders CreateEntityRecordDialog when createRecordDialogOpen is true", () => {
    render(
      <EntityDetailViewUI
        entity={stubEntity}
        isWriteEnabled={true}
        onOpenCreateRecordDialog={jest.fn()}
        createRecordDialogOpen={true}
        onCloseCreateRecordDialog={jest.fn()}
        onCreateRecord={jest.fn()}
      />
    );
    expect(screen.getByText("New Record", { selector: "h2, h6, [class*='MuiTypography']" })).toBeInTheDocument();
  });
});

describe("BidirectionalConsistencyBannerUI (in EntityDetailView context)", () => {
  it("renders directly as a standalone component", () => {
    render(
      <BidirectionalConsistencyBannerUI
        sourceField="friends"
        inconsistentRecordCount={2}
        totalChecked={10}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/friends/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 10/)).toBeInTheDocument();
  });
});
