import { jest } from "@jest/globals";

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { FilterSqlEditorUI } =
  await import("../components/FilterSqlEditor.component");

const props = () => ({
  value: "amount > cost",
  onChange: jest.fn(),
  onBlur: jest.fn(),
  touched: false,
  columnKeys: ["amount", "cost"],
  readOnly: false,
  suggest: {
    prompt: "",
    onPromptChange: jest.fn(),
    onSuggest: jest.fn(),
    pending: false,
    serverError: null,
    warning: null,
  },
  preview: {
    onRun: jest.fn(),
    pending: false,
    serverError: null,
    result: null,
  },
});

describe("FilterSqlEditorUI (#644)", () => {
  it("renders a required SQL field and the column keys", () => {
    render(<FilterSqlEditorUI {...props()} />);
    expect(screen.getByRole("textbox", { name: /sql filter/i })).toBeRequired();
    expect(screen.getByText("Columns: amount, cost")).toBeInTheDocument();
  });

  it("reports edits", async () => {
    const p = props();
    render(<FilterSqlEditorUI {...p} value="" />);
    await userEvent.type(
      screen.getByRole("textbox", { name: /sql filter/i }),
      "a"
    );
    expect(p.onChange).toHaveBeenCalledWith("a");
  });

  it("shows a field error only once touched, with aria-invalid", () => {
    const { rerender } = render(
      <FilterSqlEditorUI {...props()} error="Filter is required" />
    );
    expect(screen.queryByText("Filter is required")).not.toBeInTheDocument();
    rerender(
      <FilterSqlEditorUI {...props()} error="Filter is required" touched />
    );
    expect(screen.getByText("Filter is required")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /sql filter/i })
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("suggests from a description, only once there is one", async () => {
    const p = props();
    const { rerender } = render(<FilterSqlEditorUI {...p} />);
    expect(screen.getByRole("button", { name: "Suggest" })).toBeDisabled();
    rerender(
      <FilterSqlEditorUI
        {...p}
        suggest={{ ...p.suggest, prompt: "loss makers" }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
    expect(p.suggest.onSuggest).toHaveBeenCalled();
  });

  it("shows the suggester's pending state, failure and revision warning", () => {
    const p = props();
    render(
      <FilterSqlEditorUI
        {...p}
        suggest={{
          ...p.suggest,
          prompt: "x",
          pending: true,
          serverError: {
            message: "Couldn't suggest a filter",
            code: "CURATED_VIEW_FILTER_SUGGEST_FAILED",
          },
          warning: "The first suggestion was refused",
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Suggesting…" })).toBeDisabled();
    expect(screen.getByText(/Couldn't suggest a filter/)).toBeInTheDocument();
    expect(
      screen.getByText("The first suggestion was refused")
    ).toBeInTheDocument();
  });

  it("runs the preview", async () => {
    const p = props();
    render(<FilterSqlEditorUI {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Run preview" }));
    expect(p.preview.onRun).toHaveBeenCalled();
  });

  it("can't preview an empty filter", () => {
    render(<FilterSqlEditorUI {...props()} value="  " />);
    expect(screen.getByRole("button", { name: "Run preview" })).toBeDisabled();
  });

  it("is read-only with no assist when the plan no longer includes SQL filters", () => {
    render(<FilterSqlEditorUI {...props()} readOnly />);
    expect(
      screen.getByRole("textbox", { name: /sql filter/i })
    ).toHaveAttribute("readonly");
    expect(
      screen.queryByRole("button", { name: "Suggest" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/no longer includes SQL filters/)
    ).toBeInTheDocument();
  });
});
