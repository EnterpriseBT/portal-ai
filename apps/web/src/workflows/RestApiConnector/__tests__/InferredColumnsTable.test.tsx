import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import {
  render,
  screen,
  act,
  expectNoAxeViolations,
} from "../../../__tests__/test-utils";

import { InferredColumnsTableUI } from "../InferredColumnsTable.component";
import type { InferredColumnsTableUIProps } from "../InferredColumnsTable.component";
import type { ColumnRowDraft } from "../utils/rest-api-validation.util";
import type { SearchResult } from "../../../api/types";

function row(overrides: Partial<ColumnRowDraft> = {}): ColumnRowDraft {
  return {
    sourceField: "id",
    normalizedKey: "id",
    required: true,
    samples: ["abc", "def"],
    ...overrides,
  };
}

function makeColumnDefinitionSearchStub(): SearchResult {
  return {
    onSearch: jest.fn(async () => []),
    onSearchPending: false,
    onSearchError: null,
    getById: jest.fn(async () => null),
    getByIdPending: false,
    getByIdError: null,
    labelMap: {},
  };
}

function makeProps(
  overrides: Partial<InferredColumnsTableUIProps> = {}
): InferredColumnsTableUIProps {
  return {
    rows: [row()],
    onChange: jest.fn(),
    onAdoptSuggestion: jest.fn(),
    onAddRow: jest.fn(),
    onRemoveRow: jest.fn(),
    errors: {},
    columnDefinitionSearch: makeColumnDefinitionSearchStub(),
    ...overrides,
  };
}

describe("InferredColumnsTableUI", () => {
  it("renders a Column definition picker per row", () => {
    render(
      <InferredColumnsTableUI
        {...makeProps({
          rows: [row({ sourceField: "id", normalizedKey: "id" })],
        })}
      />
    );
    // The table header surfaces the new column-def column.
    expect(
      screen.getByRole("columnheader", { name: /column definition/i })
    ).toBeInTheDocument();
    // The cell renders a combobox-backed picker; querying by role
    // verifies AsyncSearchableSelect mounted regardless of its
    // labeling internals.
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("renders one row per column with the source field + samples", () => {
    render(
      <InferredColumnsTableUI
        {...makeProps({
          rows: [
            row({ sourceField: "id", normalizedKey: "id" }),
            row({
              sourceField: "name",
              normalizedKey: "name",
              samples: ["Alice"],
            }),
          ],
        })}
      />
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(/abc, def/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("renders the empty-state hint when rows is empty", () => {
    render(<InferredColumnsTableUI {...makeProps({ rows: [] })} />);
    expect(screen.getByText(/no columns yet/i)).toBeInTheDocument();
  });

  it("calls onChange with the new normalizedKey when the user types", async () => {
    const onChange = jest.fn();
    render(<InferredColumnsTableUI {...makeProps({ onChange })} />);
    const input = screen.getByLabelText(/normalized key for id/i);
    await userEvent.type(input, "_x");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]!;
    expect(lastCall[0]).toBe(0);
  });

  it("renders the SuggestionChip when the row carries a suggestion + adopts on click", async () => {
    const onAdoptSuggestion = jest.fn();
    render(
      <InferredColumnsTableUI
        {...makeProps({
          rows: [
            row({
              sourceField: "email",
              normalizedKey: "email",
              suggestion: {
                columnDefinitionId: "cd-1",
                suggestedNormalizedKey: "user_email",
                suggestedSemanticType: "string",
                confidence: 0.9,
                rationale: "Email-shaped",
              },
            }),
          ],
          onAdoptSuggestion,
        })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /adopt suggestion user_email/i })
    );
    expect(onAdoptSuggestion).toHaveBeenCalledWith(0);
  });

  it("calls onAddRow when the Add column button is clicked", async () => {
    const onAddRow = jest.fn();
    render(<InferredColumnsTableUI {...makeProps({ onAddRow })} />);
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(onAddRow).toHaveBeenCalled();
  });

  it("calls onRemoveRow with the row index when the remove icon is clicked", async () => {
    const onRemoveRow = jest.fn();
    render(<InferredColumnsTableUI {...makeProps({ onRemoveRow })} />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove column id/i })
    );
    expect(onRemoveRow).toHaveBeenCalledWith(0);
  });

  it("renders the row-level error message when present", () => {
    render(
      <InferredColumnsTableUI
        {...makeProps({
          errors: { "row-0-normalizedKey": "Duplicate normalized key" },
        })}
      />
    );
    expect(screen.getByText(/duplicate normalized key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/normalized key for id/i)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("renders a missing column definition on the row's picker (#838)", () => {
    render(
      <InferredColumnsTableUI
        {...makeProps({
          errors: { "row-0-columnDefinitionId": "Pick a column definition" },
        })}
      />
    );
    const picker = screen.getByRole("combobox");
    expect(picker).toHaveAttribute("aria-invalid", "true");
    expect(picker).toBeRequired();
    expect(
      screen.getByText("Pick a column definition", { selector: "p" })
    ).toBeInTheDocument();
  });
});

// #794: a row of inline edits per column, so the table is an APG grid. A
// text field owns its arrow keys once entered.
describe("InferredColumnsTableUI grid (#794)", () => {
  const at = (row: number, col: number) =>
    document.querySelector(`[data-grid-cell="${row}:${col}"]`) as HTMLElement;

  it("is a named grid with one tab stop and a named actions column", () => {
    render(<InferredColumnsTableUI {...makeProps()} />);
    const grid = screen.getByRole("grid", { name: "Inferred columns" });
    expect(
      grid.querySelectorAll('[data-grid-cell][tabindex="0"]')
    ).toHaveLength(1);
    expect(
      screen.getByRole("columnheader", { name: "Actions" })
    ).toBeInTheDocument();
  });

  it("edits a key from the keyboard: arrows to it, Enter in, Escape out", async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<InferredColumnsTableUI {...makeProps({ onChange })} />);
    act(() => at(0, 0).focus());
    // Column 0 is the read-only source field; the key is next to it.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(at(1, 0)).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const keyCell = document.activeElement as HTMLElement;
    await user.keyboard("{Enter}");
    const input = screen.getByLabelText(/normalized key for id/i);
    expect(input).toHaveFocus();
    await user.keyboard("{ArrowLeft}x");
    expect(onChange).toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(keyCell).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(<InferredColumnsTableUI {...makeProps()} />);
    await expectNoAxeViolations(container);
  });
});
