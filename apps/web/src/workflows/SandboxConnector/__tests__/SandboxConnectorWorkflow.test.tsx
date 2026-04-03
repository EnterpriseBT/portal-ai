import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import(
  "../../../__tests__/test-utils"
);
const { SandboxConnectorWorkflowUI } = await import(
  "../SandboxConnectorWorkflow.component"
);
import type { SandboxConnectorWorkflowUIProps } from "../SandboxConnectorWorkflow.component";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<SandboxConnectorWorkflowUIProps> = {}
): SandboxConnectorWorkflowUIProps {
  return {
    open: true,
    onClose: jest.fn(),
    name: "Sandbox",
    onNameChange: jest.fn(),
    onBlur: jest.fn(),
    onSubmit: jest.fn(),
    isPending: false,
    errors: {},
    touched: false,
    serverError: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SandboxConnectorWorkflowUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders title and content when open", () => {
    render(<SandboxConnectorWorkflowUI {...makeProps()} />);
    expect(screen.getByText("Connect Sandbox")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<SandboxConnectorWorkflowUI {...makeProps({ open: false })} />);
    expect(screen.queryByText("Connect Sandbox")).not.toBeInTheDocument();
  });

  it("renders the name field with provided value", () => {
    render(
      <SandboxConnectorWorkflowUI {...makeProps({ name: "My Sandbox" })} />
    );
    expect(screen.getByLabelText(/Name/)).toHaveValue("My Sandbox");
  });

  it("calls onSubmit on Connect button click", () => {
    const onSubmit = jest.fn();
    render(<SandboxConnectorWorkflowUI {...makeProps({ onSubmit })} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("supports Enter key submission via form submit", () => {
    const onSubmit = jest.fn();
    render(<SandboxConnectorWorkflowUI {...makeProps({ onSubmit })} />);
    const form = screen.getByLabelText(/Name/).closest("form")!;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel click", () => {
    const onClose = jest.fn();
    render(<SandboxConnectorWorkflowUI {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when isPending is true", () => {
    render(
      <SandboxConnectorWorkflowUI {...makeProps({ isPending: true })} />
    );
    expect(
      screen.getByRole("button", { name: "Connecting..." })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders FormAlert when serverError is provided", () => {
    render(
      <SandboxConnectorWorkflowUI
        {...makeProps({
          serverError: {
            message: "Instance already exists",
            code: "CONNECTOR_INSTANCE_DUPLICATE",
          },
        })}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/Instance already exists/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/CONNECTOR_INSTANCE_DUPLICATE/)
    ).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(
      <SandboxConnectorWorkflowUI {...makeProps({ serverError: null })} />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("displays field-level validation error when touched and errors present", () => {
    render(
      <SandboxConnectorWorkflowUI
        {...makeProps({
          touched: true,
          errors: { name: "Name is required" },
        })}
      />
    );
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("sets aria-invalid on name field when validation fails", () => {
    render(
      <SandboxConnectorWorkflowUI
        {...makeProps({
          touched: true,
          errors: { name: "Name is required" },
        })}
      />
    );
    expect(screen.getByLabelText(/Name/)).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("does not show field error when not touched", () => {
    render(
      <SandboxConnectorWorkflowUI
        {...makeProps({
          touched: false,
          errors: { name: "Name is required" },
        })}
      />
    );
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
  });

  it("has required attribute on name field", () => {
    render(<SandboxConnectorWorkflowUI {...makeProps()} />);
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });

  it("auto-links aria-describedby to helper text via MUI", () => {
    render(
      <SandboxConnectorWorkflowUI
        {...makeProps({
          touched: true,
          errors: { name: "Name is required" },
        })}
      />
    );
    expect(screen.getByLabelText(/Name/)).toHaveAttribute(
      "aria-describedby"
    );
  });

  it("calls onNameChange when name field value changes", () => {
    const onNameChange = jest.fn();
    render(
      <SandboxConnectorWorkflowUI {...makeProps({ onNameChange })} />
    );
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "New Name" },
    });
    expect(onNameChange).toHaveBeenCalledWith("New Name");
  });

  it("calls onBlur when name field loses focus", () => {
    const onBlur = jest.fn();
    render(<SandboxConnectorWorkflowUI {...makeProps({ onBlur })} />);
    const nameInput = screen.getByLabelText(/Name/);
    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
