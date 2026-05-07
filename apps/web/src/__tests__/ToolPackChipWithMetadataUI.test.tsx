import { jest } from "@jest/globals";
import type { Toolpack } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { ToolPackChipWithMetadataUI } = await import(
  "../components/ToolPackChipWithMetadata.component"
);

const builtinPack: Toolpack = {
  id: "builtin:data_query",
  kind: "builtin",
  slug: "data_query",
  name: "Data Query",
  description: "Run SQL queries.",
  iconSlug: "Storage",
  tools: [
    {
      name: "sql_query",
      description: "Execute a SQL query.",
      parameterSchema: { type: "object", properties: {} },
    },
  ],
};

describe("ToolPackChipWithMetadataUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Case 113
  it("renders the chip and no open modal when open is false", () => {
    render(
      <ToolPackChipWithMetadataUI
        pack="data_query"
        toolpack={builtinPack}
        open={false}
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />
    );
    // Chip renders with the registry-derived label.
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    // Modal heading not in the document.
    expect(
      screen.queryByRole("heading", { name: "Data Query" })
    ).not.toBeInTheDocument();
  });

  // Case 114
  it("renders the modal with the toolpack content when open is true and toolpack is non-null", () => {
    render(
      <ToolPackChipWithMetadataUI
        pack="data_query"
        toolpack={builtinPack}
        open
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />
    );
    // The pack name appears twice — once in the chip, once as the modal heading.
    expect(screen.getAllByText("Data Query").length).toBeGreaterThanOrEqual(2);
    // Tool name renders inside the modal.
    expect(screen.getByText("sql_query")).toBeInTheDocument();
  });

  // Case 115
  it("calls onOpen when the chip is clicked and toolpack is non-null", () => {
    const onOpen = jest.fn();
    render(
      <ToolPackChipWithMetadataUI
        pack="data_query"
        toolpack={builtinPack}
        open={false}
        onOpen={onOpen}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText("Data Query"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // Case 116
  it("does not call onOpen when toolpack is null", () => {
    const onOpen = jest.fn();
    render(
      <ToolPackChipWithMetadataUI
        pack="data_query"
        toolpack={null}
        open={false}
        onOpen={onOpen}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText("Data Query"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  // Case 117
  it("calls onClose when the modal's close button is clicked", () => {
    const onClose = jest.fn();
    render(
      <ToolPackChipWithMetadataUI
        pack="data_query"
        toolpack={builtinPack}
        open
        onOpen={jest.fn()}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText("Close metadata"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
