import { render, screen } from "@testing-library/react";
import { MutationResultBlock } from "../../ui/MutationResultBlock";
import type { MutationResultContentBlock } from "../../contracts/portal.contract.js";

describe("MutationResultBlock", () => {
  describe("Single variant", () => {
    it("renders '{Operation} {entity}' with no summary", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "created",
        entity: "record",
        item: { entityId: "r-1" },
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(screen.getByText("record")).toBeInTheDocument();
      expect(screen.queryByText(/\(.*\)/)).not.toBeInTheDocument();
    });

    it("renders the item's summary in parentheses when present", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "created",
        entity: "record",
        item: { entityId: "r-1", summary: { sourceId: "abc-123" } },
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(screen.getByText("record")).toBeInTheDocument();
      expect(screen.getByText(/sourceId: abc-123/)).toBeInTheDocument();
    });

    it("renders each operation label correctly", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "deleted",
        entity: "field mapping",
        item: { entityId: "fm-1" },
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("Deleted")).toBeInTheDocument();
      expect(screen.getByText("field mapping")).toBeInTheDocument();
    });
  });

  describe("Bulk variant", () => {
    it("renders '{Operation} {count} {entity}s' for plain bulk result", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "created",
        entity: "record",
        count: 5,
        items: [
          { entityId: "r-1" },
          { entityId: "r-2" },
          { entityId: "r-3" },
          { entityId: "r-4" },
          { entityId: "r-5" },
        ],
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("Created")).toBeInTheDocument();
      expect(screen.getByText("5 records")).toBeInTheDocument();
    });

    it("renders 'Deleted 3 field mappings' for bulk delete", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "deleted",
        entity: "field mapping",
        count: 3,
        items: [{ entityId: "fm-1" }, { entityId: "fm-2" }, { entityId: "fm-3" }],
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("Deleted")).toBeInTheDocument();
      expect(screen.getByText("3 field mappings")).toBeInTheDocument();
    });

    it("does not render per-item summaries inline for bulk results", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "created",
        entity: "record",
        count: 2,
        items: [
          { entityId: "r-1", summary: { sourceId: "a" } },
          { entityId: "r-2", summary: { sourceId: "b" } },
        ],
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("2 records")).toBeInTheDocument();
      expect(screen.queryByText(/sourceId/)).not.toBeInTheDocument();
    });

    it("pluralizes entities that already end in 's' without double-pluralizing", () => {
      const content: MutationResultContentBlock = {
        type: "mutation-result",
        operation: "updated",
        entity: "records",
        count: 4,
        items: [
          { entityId: "r-1" },
          { entityId: "r-2" },
          { entityId: "r-3" },
          { entityId: "r-4" },
        ],
      };
      render(<MutationResultBlock content={content} />);

      expect(screen.getByText("4 records")).toBeInTheDocument();
    });
  });
});
