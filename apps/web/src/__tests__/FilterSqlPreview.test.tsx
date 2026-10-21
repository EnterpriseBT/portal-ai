const { render, screen } = await import("./test-utils");
const { FilterSqlPreviewUI } =
  await import("../components/FilterSqlPreview.component");

const columns = [
  { key: "name", normalizedKey: "name", label: "Name", type: "string" },
  { key: "payload", normalizedKey: "payload", label: "Payload", type: "json" },
] as never;

describe("FilterSqlPreviewUI (#644)", () => {
  it("renders nothing before the first run", () => {
    const { container } = render(
      <FilterSqlPreviewUI pending={false} serverError={null} result={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading state while it runs", () => {
    render(<FilterSqlPreviewUI pending serverError={null} result={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/running the filter/i);
  });

  it("shows a refusal as an alert", () => {
    render(
      <FilterSqlPreviewUI
        pending={false}
        serverError={{
          message: "unknown column: salary",
          code: "CURATED_VIEW_INVALID_FILTER_SQL",
        }}
        result={null}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "unknown column: salary"
    );
  });

  it("says so when no rows match", () => {
    render(
      <FilterSqlPreviewUI
        pending={false}
        serverError={null}
        result={{ columns, records: [], hasMore: false }}
      />
    );
    expect(screen.getByText("No rows match this filter.")).toBeInTheDocument();
  });

  it("renders the rows, JSON as text, and says when more match", () => {
    render(
      <FilterSqlPreviewUI
        pending={false}
        serverError={null}
        result={{
          columns,
          records: [{ _record_id: "r1", name: "near", payload: { a: 1 } }],
          hasMore: true,
        }}
      />
    );
    expect(screen.getByText("near")).toBeInTheDocument();
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.getByText(/More rows match/)).toBeInTheDocument();
  });
});
