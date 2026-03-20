import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityGet = jest.fn();
const mockRecordsList = jest.fn();
const mockRecordsCount = jest.fn();
const mockRecordsSync = jest.fn();

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
      { key: "first_name", label: "First Name", type: "string" as const },
      { key: "email", label: "Email", type: "string" as const },
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
  },
}));

const { render, screen } = await import("./test-utils");
const { EntityDetailViewUI } = await import("../views/EntityDetail.view");

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
    expect(screen.getByText("Connector: My CSV")).toBeInTheDocument();
    expect(screen.getByText("Access mode: import")).toBeInTheDocument();
    expect(screen.getByText("Records: 150")).toBeInTheDocument();
    expect(
      screen.getByText(/Last sync:/)
    ).toBeInTheDocument();
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
});
