import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor, pressEnter } =
  await import("./test-utils");
const { RegisterToolpackDialogUI, appendAuthHeaderBoilerplate } =
  await import("../components/RegisterToolpackDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;

/** The secret field, once the open effect has generated its value. */
async function secretField(): Promise<HTMLInputElement> {
  const field = screen.getByLabelText(/Signing secret/) as HTMLInputElement;
  await waitFor(() => expect(field.value).toMatch(SECRET_PATTERN));
  return field;
}

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
      (screen.getByLabelText(/Schema endpoint/) as HTMLInputElement).placeholder
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
      signingSecret: expect.stringMatching(SECRET_PATTERN),
    });
  });

  // ── signing secret (#911) ──────────────────────────────────────

  it("prefills a valid, required signing secret", async () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const field = await secretField();
    expect(field).toBeRequired();
    expect(field.value).toMatch(SECRET_PATTERN);
    expect(
      screen.getByText(
        /Set this secret on your toolpack server before registering/
      )
    ).toBeInTheDocument();
  });

  it("generates a new secret on Regenerate", async () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const field = await secretField();
    const first = field.value;
    fireEvent.click(
      screen.getByRole("button", { name: "Generate a new signing secret" })
    );
    expect(field.value).toMatch(SECRET_PATTERN);
    expect(field.value).not.toBe(first);
  });

  it("copies the secret to the clipboard", async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const field = await secretField();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy signing secret" })
    );
    expect(writeText).toHaveBeenCalledWith(field.value);
    // The button confirms the copy.
    expect(
      await screen.findByRole("button", { name: "Copied" })
    ).toBeInTheDocument();
  });

  // A secret the builder may already have set on their server survives a
  // Cancel and reopen (a failed attempt's retry).
  it("keeps the secret when the dialog is closed and reopened", async () => {
    const { rerender } = render(<RegisterToolpackDialogUI {...defaultProps} />);
    const first = (await secretField()).value;
    rerender(<RegisterToolpackDialogUI {...defaultProps} open={false} />);
    rerender(<RegisterToolpackDialogUI {...defaultProps} open />);
    expect((await secretField()).value).toBe(first);
  });

  it("blocks submit on a malformed secret and marks the field invalid", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    const field = await secretField();
    fireEvent.change(field, { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a pasted secret as typed", async () => {
    const onSubmit = jest.fn();
    const pasted = "whsec_" + "p".repeat(43);
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    fireEvent.change(await secretField(), { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ signingSecret: pasted });
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
      expect(screen.getByLabelText(/Name/).getAttribute("aria-invalid")).toBe(
        "true"
      );
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

  // #615 / #801: the description's 2000-character limit used to block
  // submit with no visible error — the field had no error display at all.
  it("shows the description's length limit as a field error and blocks submit", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: "customer_intel" },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "x".repeat(2001) },
    });
    fireEvent.change(screen.getByLabelText(/Schema endpoint/), {
      target: { value: "https://example.com/schema" },
    });
    fireEvent.change(screen.getByLabelText(/Runtime endpoint/), {
      target: { value: "https://example.com/runtime" },
    });
    fireEvent.blur(screen.getByLabelText(/Description/));
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Description/).getAttribute("aria-invalid")
      ).toBe("true");
    });
    expect(screen.getByText(/2000/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() =>
      expect(
        screen.getByLabelText(/Description/).getAttribute("aria-invalid")
      ).toBe("true")
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("doesn't flag the description when focus leaves it for Cancel", () => {
    const onClose = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onClose={onClose} />);
    const description = screen.getByLabelText(/Description/);
    fireEvent.change(description, { target: { value: "x".repeat(2001) } });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.blur(description, { relatedTarget: cancel });
    expect(description.getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalled();
  });

  // #914: the Name field shows readable messages, never the raw regex.
  it("shows 'Name is required' for an empty name and a plain pattern message for an invalid one", async () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const name = screen.getByLabelText(/Name/);
    fireEvent.blur(name);
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid string|must match pattern/)).toBeNull();

    fireEvent.change(name, { target: { value: "Bad Name" } });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Name must start with a lowercase letter and use only lowercase letters, digits and underscores"
        )
      ).toBeInTheDocument()
    );
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

  // #911: the secret is set on the server before registering, so every
  // snippet verifies every request, the catalog GETs included.
  it("verifies every request, GETs included, in every snippet", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    fireEvent.click(
      screen.getByTestId("register-toolpack-verify-snippets-summary")
    );
    const snippet = screen.getByTestId(
      "register-toolpack-verify-snippets-active-snippet"
    );
    for (const tab of ["typescript", "python", "c-"]) {
      fireEvent.click(
        screen.getByTestId(`register-toolpack-verify-snippets-tab-${tab}`)
      );
      expect(snippet.textContent).toMatch(/Verify every request/);
      expect(snippet.textContent).not.toMatch(/Let GETs through/);
      expect(snippet.textContent).not.toMatch(/"GET"|IsGet/);
    }
  });

  // ── auth-header boilerplate quick-inserts ──────────────────────

  it("clicking a boilerplate chip inserts the templated header into the textarea", () => {
    render(<RegisterToolpackDialogUI {...defaultProps} />);
    const textarea = screen.getByLabelText(
      /Auth headers/
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    fireEvent.click(
      screen.getByTestId("auth-headers-boilerplate-bearer-token")
    );
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

  // #789: a real Enter in a field registers, exactly like Register.
  it("registers on a real Enter in a field", async () => {
    const onSubmit = jest.fn();
    render(<RegisterToolpackDialogUI {...defaultProps} onSubmit={onSubmit} />);
    fillRequired();
    await pressEnter(screen.getByLabelText(/Runtime endpoint/));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
