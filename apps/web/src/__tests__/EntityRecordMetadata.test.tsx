import { render, screen } from "./test-utils";
import { EntityRecordMetadata } from "../components/EntityRecordMetadata.component";
import type { EntityRecord } from "@portalai/core/models";

const stubRecord: EntityRecord = {
  id: "rec-abc-123",
  organizationId: "org-1",
  connectorEntityId: "ent-xyz-456",
  data: {},
  normalizedData: {},
  sourceId: "SRC-001",
  checksum: "deadbeef1234",
  syncedAt: 1718438400000,
  origin: "sync",
  validationErrors: null,
  isValid: true,
  created: 1700000000000,
  createdBy: "system",
  updated: 1710000000000,
  updatedBy: "user-1",
  deleted: null,
  deletedBy: null,
};

describe("EntityRecordMetadata", () => {
  it("renders the record id", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    expect(screen.getByText("rec-abc-123")).toBeInTheDocument();
  });

  it("renders the sourceId", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    expect(screen.getByText("SRC-001")).toBeInTheDocument();
  });

  it("renders the checksum", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    expect(screen.getByText("deadbeef1234")).toBeInTheDocument();
  });

  it("renders the connectorEntityId", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    expect(screen.getByText("ent-xyz-456")).toBeInTheDocument();
  });

  it("renders the origin", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    expect(screen.getByText("sync")).toBeInTheDocument();
  });

  it("renders syncedAt as formatted datetime", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    // syncedAt = 1718438400000 → 2024-06-15
    const cells = screen.getAllByText(/2024-06/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders created as formatted datetime", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    // created = 1700000000000 → 2023-11-14
    const cells = screen.getAllByText(/2023-11/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders updated as formatted datetime when present", () => {
    render(<EntityRecordMetadata record={stubRecord} />);
    // updated = 1710000000000 → 2024-03-10
    const cells = screen.getAllByText(/2024-03/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders — when updated is null", () => {
    const record = { ...stubRecord, updated: null, updatedBy: null };
    render(<EntityRecordMetadata record={record} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders — when syncedAt is null", () => {
    const record = { ...stubRecord, syncedAt: null as unknown as number };
    render(<EntityRecordMetadata record={record} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
