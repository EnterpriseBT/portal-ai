import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";

import { render, screen } from "../../../__tests__/test-utils";

import { BasicCredentialsFormUI } from "../BasicCredentialsForm.component";
import type { BasicCredentialsFormUIProps } from "../BasicCredentialsForm.component";

function makeProps(
  overrides: Partial<BasicCredentialsFormUIProps> = {}
): BasicCredentialsFormUIProps {
  return {
    username: "",
    password: "",
    onUsernameChange: jest.fn(),
    onPasswordChange: jest.fn(),
    onBlur: jest.fn(),
    errors: {},
    touched: {},
    ...overrides,
  };
}

describe("BasicCredentialsFormUI", () => {
  it("renders username + password fields", () => {
    render(<BasicCredentialsFormUI {...makeProps()} />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it("masks the password field", () => {
    render(<BasicCredentialsFormUI {...makeProps()} />);
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "type",
      "password"
    );
  });

  it("calls onUsernameChange + onPasswordChange when the user types", async () => {
    const onUsernameChange = jest.fn();
    const onPasswordChange = jest.fn();
    render(
      <BasicCredentialsFormUI
        {...makeProps({ onUsernameChange, onPasswordChange })}
      />
    );
    await userEvent.type(screen.getByLabelText(/username/i), "u");
    await userEvent.type(screen.getByLabelText(/password/i), "p");
    expect(onUsernameChange).toHaveBeenCalled();
    expect(onPasswordChange).toHaveBeenCalled();
  });

  it("surfaces both field errors after touch", () => {
    render(
      <BasicCredentialsFormUI
        {...makeProps({
          errors: {
            username: "Username is required",
            password: "Password is required",
          },
          touched: { username: true, password: true },
        })}
      />
    );
    expect(screen.getByText(/username is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
  });

  it("focuses the username field on mount", async () => {
    render(<BasicCredentialsFormUI {...makeProps()} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^username/i)).toHaveFocus();
    });
  });
});
