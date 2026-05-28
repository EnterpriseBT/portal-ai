import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";

import { render, screen } from "../../../__tests__/test-utils";

import { BasicsStepUI } from "../BasicsStep.component";
import type { BasicsStepUIProps } from "../BasicsStep.component";
import { EMPTY_CREDENTIALS_DRAFT } from "../utils/rest-api-validation.util";

function makeProps(
  overrides: Partial<BasicsStepUIProps> = {}
): BasicsStepUIProps {
  return {
    name: "",
    baseUrl: "",
    authMode: "none",
    credentials: EMPTY_CREDENTIALS_DRAFT,
    onNameChange: jest.fn(),
    onBaseUrlChange: jest.fn(),
    onAuthModeChange: jest.fn(),
    onCredentialsChange: jest.fn(),
    onBlur: jest.fn(),
    errors: {},
    touched: {},
    serverError: null,
    ...overrides,
  };
}

describe("BasicsStepUI — auth dropdown", () => {
  it("renders the auth dropdown with all four modes selectable", async () => {
    render(<BasicsStepUI {...makeProps()} />);
    const dropdown = screen.getByLabelText(/authentication/i);
    await userEvent.click(dropdown);
    expect(await screen.findByRole("option", { name: /^none$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^api key$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^bearer token$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^basic \(username \+ password\)$/i })
    ).toBeInTheDocument();
  });

  it("calls onAuthModeChange when the user picks a non-default mode", async () => {
    const onAuthModeChange = jest.fn();
    render(<BasicsStepUI {...makeProps({ onAuthModeChange })} />);
    await userEvent.click(screen.getByLabelText(/authentication/i));
    await userEvent.click(await screen.findByRole("option", { name: /^bearer token$/i }));
    expect(onAuthModeChange).toHaveBeenCalledWith("bearer");
  });
});

describe("BasicsStepUI — per-mode sub-form rendering", () => {
  it("renders no credentials sub-form when mode is none", () => {
    render(<BasicsStepUI {...makeProps({ authMode: "none" })} />);
    expect(screen.queryByLabelText(/header or query name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/bearer token/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it("renders the apiKey sub-form when authMode === 'apiKey'", () => {
    render(<BasicsStepUI {...makeProps({ authMode: "apiKey" })} />);
    expect(screen.getByLabelText(/header or query name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key value/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/bearer token/i)).not.toBeInTheDocument();
  });

  it("renders the bearer sub-form when authMode === 'bearer'", () => {
    render(<BasicsStepUI {...makeProps({ authMode: "bearer" })} />);
    // Use selector to disambiguate from the dropdown's displayed value.
    expect(
      screen.getByLabelText(/bearer token/i, { selector: "input" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/api key value/i)).not.toBeInTheDocument();
  });

  it("renders the basic sub-form when authMode === 'basic'", () => {
    render(<BasicsStepUI {...makeProps({ authMode: "basic" })} />);
    expect(
      screen.getByLabelText(/^username/i, { selector: "input" })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^password/i, { selector: "input" })
    ).toBeInTheDocument();
  });
});

describe("BasicsStepUI — name + baseUrl", () => {
  it("renders name and baseUrl values and routes onChange to handlers", async () => {
    const onNameChange = jest.fn();
    const onBaseUrlChange = jest.fn();
    render(
      <BasicsStepUI
        {...makeProps({
          name: "Acme",
          baseUrl: "https://x.test",
          onNameChange,
          onBaseUrlChange,
        })}
      />
    );
    expect(screen.getByLabelText(/connector name/i)).toHaveValue("Acme");
    expect(screen.getByLabelText(/base url/i)).toHaveValue("https://x.test");

    // BasicsStepUI runs `useDialogAutoFocus` against the connector-name
    // input with a 50 ms timer. Wait for that focus to land before we
    // start typing — otherwise on a slow CI worker the deferred focus
    // fires mid-`userEvent.type(baseUrlField, "Y")`, refocuses
    // connector-name, and the keystroke lands in the wrong field
    // (onBaseUrlChange sees 0 calls).
    await waitFor(() =>
      expect(screen.getByLabelText(/connector name/i)).toHaveFocus()
    );

    await userEvent.type(screen.getByLabelText(/connector name/i), "X");
    expect(onNameChange).toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/base url/i), "Y");
    expect(onBaseUrlChange).toHaveBeenCalled();
  });

  it("surfaces field errors after touch", () => {
    render(
      <BasicsStepUI
        {...makeProps({
          errors: { name: "Name is required" },
          touched: { name: true },
        })}
      />
    );
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/connector name/i)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });
});

describe("BasicsStepUI — autofocus", () => {
  it("focuses the connector name field on mount", async () => {
    render(<BasicsStepUI {...makeProps()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/connector name/i)).toHaveFocus();
    });
  });
});
