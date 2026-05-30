import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { PaginationFieldsUI } from "../PaginationFields.component";
import type { PaginationFieldsUIProps } from "../PaginationFields.component";
import {
  EMPTY_PAGINATION_DRAFT,
  type PaginationDraft,
} from "../utils/rest-api-validation.util";

function makeProps(
  overrides: Partial<PaginationFieldsUIProps> = {}
): PaginationFieldsUIProps {
  return {
    draft: { ...EMPTY_PAGINATION_DRAFT },
    onChange: jest.fn(),
    onBlur: jest.fn(),
    errors: {},
    touched: {},
    ...overrides,
  };
}

describe("PaginationFieldsUI — strategy dropdown", () => {
  it("renders all four strategy options", async () => {
    render(<PaginationFieldsUI {...makeProps()} />);
    await userEvent.click(screen.getByLabelText(/pagination strategy/i));
    expect(await screen.findByRole("option", { name: /^none/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /page \/ offset/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^cursor$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^link header/i })).toBeInTheDocument();
  });

  it("calls onChange with the chosen strategy", async () => {
    const onChange = jest.fn();
    render(<PaginationFieldsUI {...makeProps({ onChange })} />);
    await userEvent.click(screen.getByLabelText(/pagination strategy/i));
    await userEvent.click(await screen.findByRole("option", { name: /^cursor$/i }));
    expect(onChange).toHaveBeenCalledWith("strategy", "cursor");
  });
});

describe("PaginationFieldsUI — per-strategy sub-form rendering", () => {
  it("renders no sub-form fields when strategy is none", () => {
    render(<PaginationFieldsUI {...makeProps()} />);
    expect(screen.queryByLabelText(/parameter name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cursor parameter name/i)).not.toBeInTheDocument();
  });

  it("renders pageOffset inputs", () => {
    const draft: PaginationDraft = {
      ...EMPTY_PAGINATION_DRAFT,
      strategy: "pageOffset",
    };
    render(<PaginationFieldsUI {...makeProps({ draft })} />);
    // Label depends on `style` (page → "Page parameter name", offset →
    // "Offset parameter name"). EMPTY_PAGINATION_DRAFT defaults to
    // "page".
    expect(
      screen.getByLabelText(/^page parameter name/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^page size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^start page/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/stop when a page returns fewer records/i)
    ).toBeInTheDocument();
  });

  it("renders offset-style inputs with the offset-specific labels", () => {
    const draft: PaginationDraft = {
      ...EMPTY_PAGINATION_DRAFT,
      strategy: "pageOffset",
      style: "offset",
    };
    render(<PaginationFieldsUI {...makeProps({ draft })} />);
    expect(
      screen.getByLabelText(/^offset parameter name/i),
    ).toBeInTheDocument();
    // pageSizeParam loses the "(optional)" suffix in offset mode.
    expect(
      screen.getByLabelText(/^page-size parameter name$/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^page-size parameter name \(optional\)/i),
    ).not.toBeInTheDocument();
  });

  it("calls onChange when the user updates pageSize", async () => {
    const onChange = jest.fn();
    const draft: PaginationDraft = {
      ...EMPTY_PAGINATION_DRAFT,
      strategy: "pageOffset",
    };
    render(<PaginationFieldsUI {...makeProps({ draft, onChange })} />);
    const input = screen.getByLabelText(/^page size/i);
    await userEvent.clear(input);
    await userEvent.type(input, "25");
    expect(onChange).toHaveBeenCalledWith("pageSize", expect.any(Number));
  });

  it("renders cursor inputs", () => {
    const draft: PaginationDraft = {
      ...EMPTY_PAGINATION_DRAFT,
      strategy: "cursor",
    };
    render(<PaginationFieldsUI {...makeProps({ draft })} />);
    expect(screen.getByLabelText(/cursor parameter name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cursor placement/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cursor response path/i)).toBeInTheDocument();
  });

  it("renders the linkHeader info caption (no fields)", () => {
    const draft: PaginationDraft = {
      ...EMPTY_PAGINATION_DRAFT,
      strategy: "linkHeader",
    };
    render(<PaginationFieldsUI {...makeProps({ draft })} />);
    expect(screen.getByText(/follows the response/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/parameter name/i)).not.toBeInTheDocument();
  });
});
