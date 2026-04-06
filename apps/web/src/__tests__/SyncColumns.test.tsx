import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import { SyncColumns } from "../components/SyncColumns.component";

import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

const columns: ColumnDefinitionSummary[] = [
  { key: "name", label: "Name", type: "string", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
  { key: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
];

describe("SyncColumns", () => {
  it("should call setColumns when columns are provided", () => {
    const setColumns = jest.fn();
    render(
      <SyncColumns columns={columns} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).toHaveBeenCalledWith(columns);
  });

  it("should not call setColumns when columns array is empty", () => {
    const setColumns = jest.fn();
    render(
      <SyncColumns columns={[]} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).not.toHaveBeenCalled();
  });

  it("should render children", () => {
    const setColumns = jest.fn();
    render(
      <SyncColumns columns={columns} setColumns={setColumns}>
        <div>child content</div>
      </SyncColumns>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("should call setColumns again when columns change", () => {
    const setColumns = jest.fn();
    const newColumns: ColumnDefinitionSummary[] = [
      { key: "email", label: "Email", type: "string", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null },
    ];

    const { rerender } = render(
      <SyncColumns columns={columns} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).toHaveBeenCalledWith(columns);

    setColumns.mockClear();
    rerender(
      <SyncColumns columns={newColumns} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).toHaveBeenCalledWith(newColumns);
  });

  it("should not call setColumns again when same reference is passed", () => {
    const setColumns = jest.fn();
    const { rerender } = render(
      <SyncColumns columns={columns} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).toHaveBeenCalledTimes(1);

    setColumns.mockClear();
    rerender(
      <SyncColumns columns={columns} setColumns={setColumns}>
        <div>content</div>
      </SyncColumns>,
    );
    expect(setColumns).not.toHaveBeenCalled();
  });
});
