import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { SelectSheetStep } from "../SelectSheetStep.component";
import type { SelectSheetStepUIProps } from "../SelectSheetStep.component";

function makeProps(
  overrides: Partial<SelectSheetStepUIProps> = {}
): SelectSheetStepUIProps {
  return {
    value: null,
    valueLabel: null,
    onOpenPicker: jest.fn(),
    pickerLoading: false,
    loading: false,
    pickerUnavailable: false,
    accountMismatch: null,
    serverError: null,
    ...overrides,
  };
}

describe("SelectSheetStep", () => {
  it("offers a choose-a-spreadsheet affordance and opens the Picker on click", async () => {
    const onOpenPicker = jest.fn();
    render(<SelectSheetStep {...makeProps({ onOpenPicker })} />);

    await userEvent.click(
      screen.getByRole("button", { name: /choose a spreadsheet/i })
    );

    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("names the picked spreadsheet once one is chosen", () => {
    render(
      <SelectSheetStep
        {...makeProps({ value: "1abcXYZ", valueLabel: "Q3 Forecast" })}
      />
    );

    expect(screen.getByText("Q3 Forecast")).toBeInTheDocument();
  });

  it("blames the configuration, not the user's Google account, when the Picker cannot load", () => {
    render(<SelectSheetStep {...makeProps({ pickerUnavailable: true })} />);

    // The old copy — "No spreadsheets found — make sure the right Google
    // account is connected" — pointed the user at their own account for what
    // is our misconfiguration. It must not come back.
    expect(
      screen.queryByText(/no spreadsheets found/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/right Google account is connected/i)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /could not load|configuration/i
    );
  });

  it("names both addresses on an account mismatch and still allows a retry", () => {
    render(
      <SelectSheetStep
        {...makeProps({
          accountMismatch: {
            expected: "alice@example.com",
            authorized: "bob@example.com",
          },
        })}
      />
    );

    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("alice@example.com");
    expect(alert).toContain("bob@example.com");
    // Retrying means authorizing again, so the affordance stays live.
    expect(
      screen.getByRole("button", { name: /choose a spreadsheet/i })
    ).toBeEnabled();
  });

  it("disables the affordance while the sheet is being fetched, and says so", () => {
    render(<SelectSheetStep {...makeProps({ loading: true })} />);

    expect(
      screen.getByRole("button", { name: /choose a spreadsheet/i })
    ).toBeDisabled();
    expect(screen.getByTestId("select-sheet-loading")).toBeInTheDocument();
  });

  it("disables the affordance while the Picker script loads, without the fetching-contents panel", () => {
    render(<SelectSheetStep {...makeProps({ pickerLoading: true })} />);

    expect(
      screen.getByRole("button", { name: /choose a spreadsheet/i })
    ).toBeDisabled();
    // That panel describes streaming rows into the cache — wrong story for a
    // script load, which is why the two states are separate props.
    expect(
      screen.queryByTestId("select-sheet-loading")
    ).not.toBeInTheDocument();
  });

  it("renders the FormAlert when serverError is non-null", () => {
    render(
      <SelectSheetStep
        {...makeProps({
          serverError: {
            message: "Sheets fetch failed",
            code: "GOOGLE_SHEETS_FETCH_FAILED",
          },
        })}
      />
    );

    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /sheets fetch failed/i
    );
  });

  it("renders no alert when nothing is wrong", () => {
    render(<SelectSheetStep {...makeProps()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
