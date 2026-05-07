import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const { ToolpackMetadataModalUI } = await import(
  "../components/ToolpackMetadataModal.component"
);

const fixturePack = {
  id: "builtin:data_query",
  kind: "builtin" as const,
  slug: "data_query",
  name: "Data Query",
  description: "Run SQL queries.",
  iconSlug: "Storage",
  tools: [
    {
      name: "sql_query",
      description: "Execute a SQL query.",
      parameterSchema: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
      },
      examples: [
        {
          title: "Aggregate orders",
          input: { sql: "SELECT COUNT(*) FROM orders" },
        },
      ],
    },
  ],
};

describe("ToolpackMetadataModalUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Case 54
  it("renders pack name, description, and tool sections", () => {
    render(
      <ToolpackMetadataModalUI
        toolpack={fixturePack}
        open
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Run SQL queries.")).toBeInTheDocument();
    expect(screen.getByText("sql_query")).toBeInTheDocument();
    expect(screen.getByText("Execute a SQL query.")).toBeInTheDocument();
  });

  // Case 55
  it("renders the parameterSchema as JSON text", () => {
    render(
      <ToolpackMetadataModalUI
        toolpack={fixturePack}
        open
        onClose={jest.fn()}
      />
    );

    const schemaBlock = screen.getByTestId("toolpack-tool-schema");
    expect(schemaBlock.textContent).toContain('"type": "object"');
    expect(schemaBlock.textContent).toContain('"sql"');
  });

  // Case 56
  it("renders examples when present", () => {
    render(
      <ToolpackMetadataModalUI
        toolpack={fixturePack}
        open
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText("Aggregate orders")).toBeInTheDocument();
  });

  // Case 57
  it("renders a placeholder when a tool has no examples", () => {
    const noExamples = {
      ...fixturePack,
      tools: [
        {
          ...fixturePack.tools[0],
          examples: undefined,
        },
      ],
    };
    render(
      <ToolpackMetadataModalUI
        toolpack={noExamples}
        open
        onClose={jest.fn()}
      />
    );

    expect(screen.getByText("No examples provided.")).toBeInTheDocument();
  });

  it("does not render content when toolpack is null", () => {
    render(
      <ToolpackMetadataModalUI
        toolpack={null}
        open={false}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByText("Data Query")).not.toBeInTheDocument();
  });
});
