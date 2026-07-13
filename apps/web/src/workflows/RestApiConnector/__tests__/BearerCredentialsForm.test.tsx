import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";

import { render, screen } from "../../../__tests__/test-utils";

import { BearerCredentialsFormUI } from "../BearerCredentialsForm.component";
import type { BearerCredentialsFormUIProps } from "../BearerCredentialsForm.component";

function makeProps(
  overrides: Partial<BearerCredentialsFormUIProps> = {}
): BearerCredentialsFormUIProps {
  return {
    token: "",
    onTokenChange: jest.fn(),
    onBlur: jest.fn(),
    errors: {},
    touched: {},
    ...overrides,
  };
}

describe("BearerCredentialsFormUI", () => {
  it("renders the token field as a password input", () => {
    render(<BearerCredentialsFormUI {...makeProps()} />);
    const input = screen.getByLabelText(/bearer token/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "password");
  });

  it("calls onTokenChange when the user types", async () => {
    const onTokenChange = jest.fn();
    render(<BearerCredentialsFormUI {...makeProps({ onTokenChange })} />);
    await userEvent.type(screen.getByLabelText(/bearer token/i), "abc");
    expect(onTokenChange).toHaveBeenCalled();
  });

  it("calls onBlur when the user leaves the token field", async () => {
    const onBlur = jest.fn();
    render(<BearerCredentialsFormUI {...makeProps({ onBlur })} />);
    const input = screen.getByLabelText(/bearer token/i);
    await userEvent.click(input);
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledWith("token");
  });

  it("surfaces field-level errors and marks the field aria-invalid after touch", () => {
    render(
      <BearerCredentialsFormUI
        {...makeProps({
          errors: { token: "Bearer token is required" },
          touched: { token: true },
        })}
      />
    );
    expect(screen.getByText(/bearer token is required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bearer token/i)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("focuses the token field on mount", async () => {
    render(<BearerCredentialsFormUI {...makeProps()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/bearer token/i)).toHaveFocus();
    });
  });
});
