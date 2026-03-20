import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorEntities: { get: jest.fn() },
    entityRecords: { get: jest.fn() },
  },
}));

const { render, screen } = await import("./test-utils");
const { EntityRecordDetailViewUI } = await import(
  "../views/EntityRecordDetail.view"
);

// ── Fixtures ─────────────────────────────────────────────────────────

import type { ConnectorEntity, EntityRecord } from "@portalai/core/models";
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
});
