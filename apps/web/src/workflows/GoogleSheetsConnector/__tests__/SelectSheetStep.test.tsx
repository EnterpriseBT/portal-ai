import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "../../../__tests__/test-utils";

import { SelectSheetStep } from "../SelectSheetStep.component";
import type { SelectSheetStepUIProps } from "../SelectSheetStep.component";

function makeProps(
  overrides: Partial<SelectSheetStepUIProps> = {}
): SelectSheetStepUIProps {
  return {
    value: null,
    onSelect: jest.fn(),
    searchFn: jest.fn(async () => []),
    loading: false,
    serverError: null,
    ...overrides,
  };
}

describe("SelectSheetStep", () => {
  it("renders the AsyncSearchableSelect and surfaces options from searchFn", async () => {
    const searchFn = jest.fn(async () => [
      { value: "sheet-1", label: "Q3 Forecast" },
      { value: "sheet-2", label: "Headcount" },
    ]);
    render(
      <SelectSheetStep {...makeProps({ searchFn })} />
    );
    // Initial load happens on mount with empty query.
    await waitFor(() => expect(searchFn).toHaveBeenCalled());
  });

  it("calls onSelect with the chosen spreadsheetId", async () => {
    const onSelect = jest.fn();
    const searchFn = jest.fn(async () => [
      { value: "sheet-1", label: "Q3 Forecast" },
      { value: "sheet-2", label: "Headcount" },
    ]);
    render(
      <SelectSheetStep
        {...makeProps({
          onSelect,
          searchFn,
        })}
      />
    );

    // Open the autocomplete
    const combobox = await screen.findByRole("combobox");
    await userEvent.click(combobox);
    const option = await screen.findByText(/Q3 Forecast/i);
    await userEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith("sheet-1");
  });

  it("shows the empty-results message with reconnect hint", async () => {
    const searchFn = jest.fn(async () => []);
    render(<SelectSheetStep {...makeProps({ searchFn })} />);
    const combobox = await screen.findByRole("combobox");
    await userEvent.click(combobox);
    expect(
      await screen.findByText(/no spreadsheets found/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/right Google account is connected/i)
    ).toBeInTheDocument();
  });

  it("disables the select while a server-side selectSheet call is in flight", () => {
    render(<SelectSheetStep {...makeProps({ loading: true })} />);
    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeDisabled();
  });

  it("renders the FormAlert when serverError is non-null", () => {
    render(
      <SelectSheetStep
        {...makeProps({
          serverError: { message: "Sheets fetch failed", code: "GOOGLE_SHEETS_FETCH_FAILED" },
        })}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/sheets fetch failed/i);
  });
});
