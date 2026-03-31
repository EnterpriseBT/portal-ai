import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockResolve = jest.fn();
const mockListByEntity = jest.fn();
const mockEntityGroupsGet = jest.fn();

const noopMutation = { mutate: jest.fn(), isPending: false, error: null };

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorEntities: { get: jest.fn(() => ({ data: { connectorEntity: { connectorInstanceId: "" } } })) },
    entityRecords: { get: jest.fn(), delete: () => noopMutation },
    entityGroups: {
      listByEntity: mockListByEntity,
      get: mockEntityGroupsGet,
      resolve: mockResolve,
    },
    connectorInstances: { get: () => ({ data: null }) },
    connectorDefinitions: { get: () => ({ data: null }) },
  },
  queryKeys: {
    entityRecords: { root: ["entityRecords"] },
  },
}));

const { render, screen } = await import("./test-utils");
const { EntityRecordDetailViewUI, RelatedRecordsSection } = await import(
  "../views/EntityRecordDetail.view"
);

// ── Fixtures ─────────────────────────────────────────────────────────

import type { ConnectorEntity, EntityRecord, EntityGroup } from "@portalai/core/models";
import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

const stubEntity: ConnectorEntity = {
  id: "ent-1",
  organizationId: "org-1",
  connectorInstanceId: "inst-1",
  key: "contacts",
  label: "Contacts",
  created: 1700000000000,
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubRecord: EntityRecord = {
  id: "rec-1",
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  data: {},
  normalizedData: {
    name: "Alice Johnson",
    age: 32,
    active: true,
    meta: { tier: "gold" },
    tags: ["admin", "editor"],
    email: "alice@example.com",
  },
  sourceId: "SRC-001",
  checksum: "abc123",
  syncedAt: 1718438400000,
  created: 1700000000000,
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubColumns: ColumnDefinitionSummary[] = [
  { key: "name", label: "Full Name", type: "string" },
  { key: "age", label: "Age", type: "number" },
  { key: "active", label: "Active", type: "boolean" },
  { key: "meta", label: "Meta", type: "json" },
  { key: "tags", label: "Tags", type: "array" },
];

const stubGroup: EntityGroup = {
  id: "grp-1",
  organizationId: "org-1",
  name: "People",
  description: "Cross-entity people group",
  created: 1700000000000,
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubGroup2: EntityGroup = {
  id: "grp-2",
  organizationId: "org-1",
  name: "Email Identities",
  description: null,
  created: 1700000000000,
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("EntityRecordDetailViewUI", () => {
  it("renders entity label in breadcrumbs", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.getByText("Contacts")).toBeInTheDocument();
  });

  it("renders record sourceId in breadcrumbs", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.getByText("Record SRC-001")).toBeInTheDocument();
  });

  it("renders all metadata fields", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.getByText("rec-1")).toBeInTheDocument();
    expect(screen.getByText("SRC-001")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("renders column labels in the fields section", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.getByText("Full Name")).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders string field value", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
  });

  it("renders json field as a <pre> code block", () => {
    const { container } = render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    const pres = Array.from(container.querySelectorAll("pre"));
    const jsonPre = pres.find((el) => el.textContent?.includes("gold"));
    expect(jsonPre).toBeTruthy();
  });

  it("renders array field as a <pre> code block", () => {
    const { container } = render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    const pres = Array.from(container.querySelectorAll("pre"));
    const arrayPre = pres.find((el) => el.textContent?.includes("admin"));
    expect(arrayPre).toBeTruthy();
  });

  it("renders — for columns missing from normalizedData", () => {
    const extraColumn: ColumnDefinitionSummary = {
      key: "missing_field",
      label: "Missing",
      type: "string",
    };
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={[...stubColumns, extraColumn]}
      />
    );
    expect(screen.getByText("Missing")).toBeInTheDocument();
    // EntityRecordFieldValue renders — for null/undefined (may be multiple in the page)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders entity group names in the metadata section", () => {
    mockEntityGroupsGet.mockReturnValue({ data: undefined, isLoading: true });
    mockResolve.mockReturnValue({ data: undefined, isLoading: false });

    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
        groups={[stubGroup, stubGroup2]}
      />
    );
    const metadataRow = screen.getByTestId("entity-groups-metadata");
    expect(metadataRow).toBeInTheDocument();
    expect(metadataRow).toHaveTextContent("People");
    expect(metadataRow).toHaveTextContent("Email Identities");
  });

  it("renders Related Records section when entity has group memberships", () => {
    mockEntityGroupsGet.mockReturnValue({ data: undefined, isLoading: true });
    mockResolve.mockReturnValue({ data: undefined, isLoading: false });

    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
        groups={[stubGroup, stubGroup2]}
      />
    );
    expect(screen.getByTestId("related-records-section")).toBeInTheDocument();
    expect(screen.getByText("Related Records")).toBeInTheDocument();
  });

  it("hides entity groups from metadata when no group memberships", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
        groups={[]}
      />
    );
    expect(screen.queryByTestId("entity-groups-metadata")).not.toBeInTheDocument();
  });

  it("hides Related Records section when entity has no group memberships", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
        groups={[]}
      />
    );
    expect(screen.queryByTestId("related-records-section")).not.toBeInTheDocument();
    expect(screen.queryByText("Related Records")).not.toBeInTheDocument();
  });

  it("hides Related Records section when groups prop is omitted", () => {
    render(
      <EntityRecordDetailViewUI
        entity={stubEntity}
        record={stubRecord}
        columns={stubColumns}
      />
    );
    expect(screen.queryByTestId("related-records-section")).not.toBeInTheDocument();
  });
});

describe("RelatedRecordsSection — identity resolution", () => {
  const stubMember = {
    id: "mem-1",
    organizationId: "org-1",
    entityGroupId: "grp-1",
    connectorEntityId: "ent-1",
    linkFieldMappingId: "fm-1",
    linkFieldMappingSourceField: "email",
    connectorEntityLabel: "Contacts",
    isPrimary: true,
    created: 1700000000000,
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };

  const mockGroupDetail = (overrides?: Partial<typeof stubMember>) => {
    mockEntityGroupsGet.mockReturnValue({
      data: {
        entityGroup: {
          ...stubGroup,
          members: [{ ...stubMember, ...overrides }],
        },
      },
      isLoading: false,
    });
  };

  beforeEach(() => {
    mockEntityGroupsGet.mockReset();
    mockResolve.mockReset();
  });

  it("automatically resolves identity when linkValue is available", () => {
    mockGroupDetail();
    mockResolve.mockReturnValue({ data: undefined, isLoading: false });

    render(
      <RelatedRecordsSection
        groups={[stubGroup]}
        record={stubRecord}
        connectorEntityId="ent-1"
      />
    );

    // resolve should have been called automatically with the link value
    expect(mockResolve).toHaveBeenCalledWith(
      "grp-1",
      { linkValue: "alice@example.com" },
      { enabled: true }
    );
  });

  it("displays grouped results with primary member distinguished", () => {
    mockGroupDetail();
    mockResolve.mockReturnValue({
      data: {
        results: [
          {
            connectorEntityId: "ent-2",
            connectorEntityLabel: "HubSpot Users",
            isPrimary: false,
            records: [{ ...stubRecord, id: "rec-2", sourceId: "HS-042" }],
          },
        ],
      },
      isLoading: false,
    });

    render(
      <RelatedRecordsSection
        groups={[stubGroup]}
        record={stubRecord}
        connectorEntityId="ent-1"
      />
    );

    // Results should appear automatically (no button click needed)
    expect(screen.getByText("HubSpot Users")).toBeInTheDocument();
    expect(screen.getByText(/HS-042/)).toBeInTheDocument();
  });

  it("displays 'No matching records found' when resolve returns empty results", () => {
    mockGroupDetail({ isPrimary: false });
    mockResolve.mockReturnValue({
      data: { results: [] },
      isLoading: false,
    });

    render(
      <RelatedRecordsSection
        groups={[stubGroup]}
        record={stubRecord}
        connectorEntityId="ent-1"
      />
    );

    // Empty results message should appear automatically
    expect(screen.getByText("No matching records found")).toBeInTheDocument();
  });
});
