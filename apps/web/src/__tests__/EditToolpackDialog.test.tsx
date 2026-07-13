import { jest } from "@jest/globals";
import type { Toolpack } from "@portalai/core/contracts";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { EditToolpackDialogUI } =
  await import("../components/EditToolpackDialog.component");

const customPack: Toolpack = {
  id: "otp-1",
  kind: "custom",
  slug: "customer_intel",
  name: "customer_intel",
  description: "External customer intelligence calls.",
  iconSlug: "Extension",
  tools: [
    {
      name: "lookup_company",
      description: "Look up a company.",
      parameterSchema: { type: "object", properties: {} },
    },
  ],
  endpoints: {
    schema: "https://example.com/schema",
    runtime: "https://example.com/runtime",
  },
  authHeadersStatus: { has: true },
  signingSecretStatus: { has: true },
  schemaFetchedAt: Date.now(),
  metadataFetchedAt: null,
};

const defaultProps = {
  open: true,
  toolpack: customPack,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  onRefresh: jest.fn(),
  onRotateSecret: jest.fn(),
  isPending: false,
  isRefreshing: false,
  isRotatingSecret: false,
  serverError: null,
  refreshError: null,
};

describe("EditToolpackDialogUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the dialog title and pre-fills the form", () => {
    render(<EditToolpackDialogUI {...defaultProps} />);
    expect(screen.getByText("Edit toolpack")).toBeInTheDocument();
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe(
      "customer_intel"
    );
    expect(
      (screen.getByLabelText(/Schema endpoint/) as HTMLInputElement).value
    ).toBe("https://example.com/schema");
  });

  it("does not render when open is false", () => {
    render(<EditToolpackDialogUI {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit toolpack")).not.toBeInTheDocument();
  });

  it("submits only the changed name field when name is the only edit", async () => {
    const onSubmit = jest.fn();
    render(<EditToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "renamed_pack" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ name: "renamed_pack" });
  });

  it("submits the endpoints object when any endpoint URL changes", async () => {
    const onSubmit = jest.fn();
    render(<EditToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
      target: { value: "https://example.com/schema-v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      endpoints: {
        schema: "https://example.com/schema-v2",
        runtime: "https://example.com/runtime",
      },
    });
  });

  it("omits authHeaders from the patch when the field is left blank", async () => {
    const onSubmit = jest.fn();
    render(<EditToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "renamed_pack" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("authHeaders");
  });

  it("blocks save when no fields have changed", async () => {
    const onSubmit = jest.fn();
    render(<EditToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        screen.getByText(/At least one field must change/)
      ).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("invokes onRefresh when the Refresh schema button is clicked", () => {
    const onRefresh = jest.fn();
    render(<EditToolpackDialogUI {...defaultProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: /Refresh schema/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders the refresh error inline without blanking the form", () => {
    render(
      <EditToolpackDialogUI
        {...defaultProps}
        refreshError={{
          message: "Schema fetch failed",
          code: "TOOLPACK_SCHEMA_FETCH_FAILED",
        }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Form fields preserved.
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe(
      "customer_intel"
    );
  });

  it("disables actions while saving", () => {
    render(<EditToolpackDialogUI {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  // Phase 6: rotate signing secret button
  it("invokes onRotateSecret when the Rotate signing secret button is clicked", () => {
    const onRotateSecret = jest.fn();
    render(
      <EditToolpackDialogUI {...defaultProps} onRotateSecret={onRotateSecret} />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Rotate signing secret/ })
    );
    expect(onRotateSecret).toHaveBeenCalledTimes(1);
  });
});
