import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen, waitFor } from "../../../__tests__/test-utils";

import { SelectWorkbookStep } from "../SelectWorkbookStep.component";
import type { SelectWorkbookStepUIProps } from "../SelectWorkbookStep.component";

function makeProps(
  overrides: Partial<SelectWorkbookStepUIProps> = {}
): SelectWorkbookStepUIProps {
  return {
    value: null,
    onSelect: jest.fn(),
    searchFn: jest.fn(async () => []),
    loading: false,
    serverError: null,
    ...overrides,
  };
}

describe("SelectWorkbookStep", () => {
  it("calls searchFn on mount with the empty query", async () => {
    const searchFn = jest.fn(async () => [
      { value: "01ABC", label: "Q3 Forecast.xlsx" },
    ]);
    render(<SelectWorkbookStep {...makeProps({ searchFn })} />);
    await waitFor(() => expect(searchFn).toHaveBeenCalled());
  });

  it("calls onSelect with the chosen driveItemId", async () => {
    const onSelect = jest.fn();
    const searchFn = jest.fn(async () => [
      { value: "01ABC", label: "Q3 Forecast.xlsx" },
      { value: "01DEF", label: "Headcount.xlsx" },
    ]);
    render(<SelectWorkbookStep {...makeProps({ onSelect, searchFn })} />);
    const combobox = await screen.findByRole("combobox");
    await userEvent.click(combobox);
    const option = await screen.findByText(/Q3 Forecast\.xlsx/i);
    await userEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith("01ABC");
  });

  it("shows the empty-results message with reconnect hint", async () => {
    const searchFn = jest.fn(async () => []);
    render(<SelectWorkbookStep {...makeProps({ searchFn })} />);
    const combobox = await screen.findByRole("combobox");
    await userEvent.click(combobox);
    expect(await screen.findByText(/no workbooks found/i)).toBeInTheDocument();
    expect(
      screen.getByText(/right Microsoft account is connected/i)
    ).toBeInTheDocument();
  });

  it("disables the select while a server-side select-workbook call is in flight", () => {
    render(<SelectWorkbookStep {...makeProps({ loading: true })} />);
    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeDisabled();
  });

  it("renders the FormAlert when serverError is non-null", () => {
    render(
      <SelectWorkbookStep
        {...makeProps({
          serverError: {
            message: "Workbook fetch failed",
            code: "MICROSOFT_EXCEL_FETCH_FAILED",
          },
        })}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/workbook fetch failed/i);
  });

  it("surfaces the no-OneDrive remedy and its code in the alert", async () => {
    render(
      <SelectWorkbookStep
        {...makeProps({
          serverError: {
            message:
              "This Microsoft account has no OneDrive. Reconnect with a " +
              "personal Microsoft account, or a work account whose tenant " +
              "has OneDrive or SharePoint enabled.",
            code: "MICROSOFT_EXCEL_NO_ONEDRIVE",
          },
        })}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/no OneDrive/i);
    expect(alert.textContent ?? "").toMatch(/reconnect/i);
    expect(alert.textContent ?? "").toContain("MICROSOFT_EXCEL_NO_ONEDRIVE");
  });

  it("stops claiming 'no workbooks found' once a search has failed", async () => {
    // The dropdown cannot assert the drive is empty when the lookup itself
    // errored — that sentence sent users hunting for the wrong problem.
    const searchFn = jest.fn(async () => []);
    render(
      <SelectWorkbookStep
        {...makeProps({
          searchFn,
          serverError: {
            message: "This Microsoft account has no OneDrive.",
            code: "MICROSOFT_EXCEL_NO_ONEDRIVE",
          },
        })}
      />
    );
    const combobox = await screen.findByRole("combobox");
    await userEvent.click(combobox);
    expect(
      await screen.findByText(/workbook search failed/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/no workbooks found/i)).not.toBeInTheDocument();
  });
});
