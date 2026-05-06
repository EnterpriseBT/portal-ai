import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { RegisterToolpackDialogUI } = await import(
  "../components/RegisterToolpackDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Name/), {
    target: { value: "customer_intel" },
  });
  fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
    target: { value: "https://example.com/schema" },
  });
  fireEvent.change(screen.getByLabelText(/Runtime endpoint/), {
    target: { value: "https://example.com/runtime" },
  });
}

describe("RegisterToolpackDialogUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the dialog title and required fields", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    expect(screen.getByText("Register toolpack")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Schema endpoint/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Runtime endpoint/)).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} open={false} />);
    expect(screen.queryByText("Register toolpack")).not.toBeInTheDocument();
  });

  it("calls onSubmit with a valid body", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "customer_intel",
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
      },
    });
  });

  it("submits with parsed auth headers when supplied", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Auth headers/), {
      target: {
        value: "X-Api-Key: secret\nAuthorization: Bearer abc",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      authHeaders: {
        "X-Api-Key": "secret",
        Authorization: "Bearer abc",
      },
    });
  });

  it("blocks submit and surfaces a validation error on a malformed name", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "Bad Name" },
    });
    fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
      target: { value: "https://example.com/schema" },
    });
    fireEvent.change(screen.getByLabelText(/Runtime endpoint/), {
      target: { value: "https://example.com/runtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Name/).getAttribute("aria-invalid")
      ).toBe("true");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit and surfaces a validation error on a malformed URL", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "ok" },
    });
    fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
      target: { value: "not-a-url" },
    });
    fireEvent.change(screen.getByLabelText(/Runtime endpoint/), {
      target: { value: "https://example.com/runtime" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Schema endpoint/).getAttribute("aria-invalid")
      ).toBe("true");
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("flags malformed auth-headers input", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Auth headers/), {
      target: { value: "no-colon-here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Malformed header on line 1/)
      ).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables actions when isPending", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: /Registering/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders FormAlert when serverError is supplied", () => {
    render(
      <RegisterToolpackDialogUI
        {...defaultProps}
        serverError={{
          message: "Schema fetch failed",
          code: "TOOLPACK_SCHEMA_FETCH_FAILED",
        }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
