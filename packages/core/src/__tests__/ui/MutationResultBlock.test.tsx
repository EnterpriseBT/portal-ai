import React from "react";
import { render, screen } from "@testing-library/react";
import { MutationResultBlock } from "../../ui/MutationResultBlock";
import type { MutationResultContentBlock } from "../../contracts/portal.contract.js";

describe("MutationResultBlock", () => {
  it("renders single-item result without count", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "created",
      entity: "record",
      entityId: "r-1",
      summary: { sourceId: "abc-123" },
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("record")).toBeInTheDocument();
    expect(screen.getByText(/sourceId: abc-123/)).toBeInTheDocument();
  });

  it("renders bulk result with count > 1", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "created",
      entity: "record",
      count: 5,
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("5 records")).toBeInTheDocument();
  });

  it("renders bulk delete with count", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "deleted",
      entity: "field mapping",
      count: 3,
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.getByText("3 field mappings")).toBeInTheDocument();
  });

  it("renders summary text in parentheses for bulk result", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "created",
      entity: "record",
      count: 5,
      summary: { entityLabel: "Customers" },
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("5 records")).toBeInTheDocument();
    expect(screen.getByText(/entityLabel: Customers/)).toBeInTheDocument();
  });

  it("renders count=1 as single-item display", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "updated",
      entity: "column definition",
      count: 1,
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("column definition")).toBeInTheDocument();
  });

  it("backward compat: old shape with entityId still renders", () => {
    const content: MutationResultContentBlock = {
      type: "mutation-result",
      operation: "updated",
      entity: "record",
      entityId: "r-1",
      summary: { sourceId: "abc" },
    };
    render(<MutationResultBlock content={content} />);

    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("record")).toBeInTheDocument();
  });
});
