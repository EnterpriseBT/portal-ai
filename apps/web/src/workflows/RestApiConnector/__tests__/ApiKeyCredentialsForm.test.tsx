import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { ApiKeyCredentialsFormUI } from "../ApiKeyCredentialsForm.component";
import type { ApiKeyCredentialsFormUIProps } from "../ApiKeyCredentialsForm.component";

function makeProps(
  overrides: Partial<ApiKeyCredentialsFormUIProps> = {}
): ApiKeyCredentialsFormUIProps {
  return {
    keyName: "",
    placement: "header",
    value: "",
    onKeyNameChange: jest.fn(),
    onPlacementChange: jest.fn(),
    onValueChange: jest.fn(),
    onBlur: jest.fn(),
    errors: {},
    touched: {},
    ...overrides,
  };
}

describe("ApiKeyCredentialsFormUI", () => {
  it("renders the three apiKey fields", () => {
    render(<ApiKeyCredentialsFormUI {...makeProps()} />);
    expect(screen.getByLabelText(/header or query name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^placement/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key value/i)).toBeInTheDocument();
  });

  it("calls onKeyNameChange when the user types into the keyName field", async () => {
    const onKeyNameChange = jest.fn();
    render(
      <ApiKeyCredentialsFormUI {...makeProps({ onKeyNameChange })} />
    );
    await userEvent.type(
      screen.getByLabelText(/header or query name/i),
      "X-API-Key"
    );
    expect(onKeyNameChange).toHaveBeenCalled();
  });

  it("calls onValueChange when the user types into the value field", async () => {
    const onValueChange = jest.fn();
    render(<ApiKeyCredentialsFormUI {...makeProps({ onValueChange })} />);
    await userEvent.type(screen.getByLabelText(/api key value/i), "secret");
    expect(onValueChange).toHaveBeenCalled();
  });

  it("masks the value field (password input)", () => {
    render(<ApiKeyCredentialsFormUI {...makeProps()} />);
    const input = screen.getByLabelText(/api key value/i);
    expect(input).toHaveAttribute("type", "password");
  });

  it("surfaces field-level errors and marks invalid fields aria-invalid after touch", () => {
    render(
      <ApiKeyCredentialsFormUI
        {...makeProps({
          errors: { keyName: "Header or query name is required" },
          touched: { keyName: true },
        })}
      />
    );
    expect(
      screen.getByText(/header or query name is required/i)
    ).toBeInTheDocument();
    const input = screen.getByLabelText(/header or query name/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not show errors when fields aren't touched", () => {
    render(
      <ApiKeyCredentialsFormUI
        {...makeProps({
          errors: { keyName: "Header or query name is required" },
          touched: {},
        })}
      />
    );
    expect(
      screen.queryByText(/header or query name is required/i)
    ).not.toBeInTheDocument();
  });
});
