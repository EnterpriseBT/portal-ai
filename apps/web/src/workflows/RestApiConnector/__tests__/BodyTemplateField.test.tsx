import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen } from "../../../__tests__/test-utils";

import { BodyTemplateFieldUI } from "../BodyTemplateField.component";
import type { BodyTemplateFieldUIProps } from "../BodyTemplateField.component";

function makeProps(
  overrides: Partial<BodyTemplateFieldUIProps> = {}
): BodyTemplateFieldUIProps {
  return {
    value: "",
    onChange: jest.fn(),
    ...overrides,
  };
}

describe("BodyTemplateFieldUI", () => {
  it("renders the multi-line body template input", () => {
    render(<BodyTemplateFieldUI {...makeProps({ value: '{"q":1}' })} />);
    const input = screen.getByLabelText(/body template/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('{"q":1}');
  });

  it("calls onChange when the user types", async () => {
    const onChange = jest.fn();
    render(<BodyTemplateFieldUI {...makeProps({ onChange })} />);
    await userEvent.type(screen.getByLabelText(/body template/i), "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders the hint tooltip element listing the closed variable set", () => {
    render(<BodyTemplateFieldUI {...makeProps()} />);
    // The hint tooltip is rendered as an aria-labelled span.
    expect(
      screen.getByLabelText(/template variables hint/i)
    ).toBeInTheDocument();
  });

  it("surfaces the error message after touched=true", () => {
    render(
      <BodyTemplateFieldUI
        {...makeProps({
          error: 'Unknown template variable "lastSyncAt"',
          touched: true,
        })}
      />
    );
    expect(
      screen.getByText(/unknown template variable "lastsyncat"/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/body template/i)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("hides the error when not yet touched", () => {
    render(
      <BodyTemplateFieldUI
        {...makeProps({
          error: 'Unknown template variable "lastSyncAt"',
          touched: false,
        })}
      />
    );
    expect(
      screen.queryByText(/unknown template variable/i)
    ).not.toBeInTheDocument();
  });
});
