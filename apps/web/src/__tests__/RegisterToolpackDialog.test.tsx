import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const {
  RegisterToolpackDialogUI,
  appendAuthHeaderBoilerplate,
} = await import("../components/RegisterToolpackDialog.component");

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
    // Caption explains what registration does + the HMAC contract.
    const titleBlock = screen.getByTestId("register-toolpack-title");
    expect(titleBlock.textContent).toContain("portal sessions");
    expect(titleBlock.textContent).toContain("HMAC-signs");
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Schema endpoint/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Runtime endpoint/)).toBeInTheDocument();
  });

  it("renders a single tabbed accordion at the bottom for each endpoint's expected shape", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const summary = screen.getByTestId(
      "register-toolpack-endpoint-shapes-summary"
    );
    expect(summary).toBeInTheDocument();

    // Reference section anchors the helper accordions at the bottom.
    expect(
      screen.getByTestId("register-toolpack-reference-section")
    ).toBeInTheDocument();

    fireEvent.click(summary);

    // All three endpoint tabs are present.
    expect(
      screen.getByTestId("register-toolpack-endpoint-shapes-tab-schema")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("register-toolpack-endpoint-shapes-tab-runtime")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("register-toolpack-endpoint-shapes-tab-metadata")
    ).toBeInTheDocument();

    // Default tab is Schema → its block is labeled "GET → response".
    const snippet = screen.getByTestId(
      "register-toolpack-endpoint-shapes-active-snippet"
    );
    expect(snippet.textContent).toContain("GET → response");
    expect(snippet.textContent).toContain('"tools"');

    // Switch to Runtime — the tab carries TWO labeled blocks
    // (request body + response). Both must be visible at once.
    fireEvent.click(
      screen.getByTestId("register-toolpack-endpoint-shapes-tab-runtime")
    );
    expect(snippet.textContent).toContain("POST → request body");
    expect(snippet.textContent).toContain("POST → response");

    // Switch to Metadata — single block, swaps in cleanly.
    fireEvent.click(
      screen.getByTestId("register-toolpack-endpoint-shapes-tab-metadata")
    );
    expect(snippet.textContent).toContain('"summary"');
    expect(snippet.textContent).not.toContain("POST → request body");
  });

  it("seeds the URL fields with example placeholders", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    expect(
      (screen.getByLabelText(/Schema endpoint/) as HTMLInputElement)
        .placeholder
    ).toContain("toolpacks/customer_intel/schema");
    expect(
      (screen.getByLabelText(/Runtime endpoint/) as HTMLInputElement)
        .placeholder
    ).toContain("toolpacks/customer_intel/run");
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

  // ── verification snippets accordion ────────────────────────────

  it("renders the verification-snippets accordion with TS / Python / C# tabs", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);

    const summary = screen.getByTestId(
      "register-toolpack-verify-snippets-summary"
    );
    expect(summary).toBeInTheDocument();
    fireEvent.click(summary);

    // All three tabs are present.
    expect(
      screen.getByTestId("register-toolpack-verify-snippets-tab-typescript")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("register-toolpack-verify-snippets-tab-python")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("register-toolpack-verify-snippets-tab-c-")
    ).toBeInTheDocument();

    // Default tab (TypeScript) shows the timingSafeEqual call.
    const snippet = screen.getByTestId(
      "register-toolpack-verify-snippets-active-snippet"
    );
    expect(snippet.textContent).toContain("crypto.timingSafeEqual");

    // Switch to Python — the snippet body swaps; only one is rendered at a time.
    fireEvent.click(
      screen.getByTestId("register-toolpack-verify-snippets-tab-python")
    );
    expect(snippet.textContent).toContain("hmac.compare_digest");
    expect(snippet.textContent).not.toContain("crypto.timingSafeEqual");

    // Switch to C# — same story.
    fireEvent.click(
      screen.getByTestId("register-toolpack-verify-snippets-tab-c-")
    );
    expect(snippet.textContent).toContain("FixedTimeEquals");
    expect(snippet.textContent).not.toContain("hmac.compare_digest");
  });

  // ── auth-header boilerplate quick-inserts ──────────────────────

  it("clicking a boilerplate chip inserts the templated header into the textarea", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const textarea = screen.getByLabelText(
      /Auth headers/
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    fireEvent.click(screen.getByTestId("auth-headers-boilerplate-bearer-token"));
    expect(textarea.value).toBe("Authorization: Bearer <token>");

    fireEvent.click(screen.getByTestId("auth-headers-boilerplate-api-key"));
    expect(textarea.value).toBe(
      "Authorization: Bearer <token>\nX-Api-Key: <key>"
    );
  });
});

describe("appendAuthHeaderBoilerplate", () => {
  it("returns the template alone when current is empty", () => {
    expect(appendAuthHeaderBoilerplate("", "X-Api-Key: <key>")).toBe(
      "X-Api-Key: <key>"
    );
  });

  it("appends after a single newline, trimming trailing whitespace", () => {
    expect(
      appendAuthHeaderBoilerplate(
        "Authorization: Bearer abc\n",
        "X-Api-Key: <key>"
      )
    ).toBe("Authorization: Bearer abc\nX-Api-Key: <key>");
  });

  it("appends after content that has no trailing newline", () => {
    expect(
      appendAuthHeaderBoilerplate(
        "Authorization: Bearer abc",
        "X-Api-Key: <key>"
      )
    ).toBe("Authorization: Bearer abc\nX-Api-Key: <key>");
  });
});
