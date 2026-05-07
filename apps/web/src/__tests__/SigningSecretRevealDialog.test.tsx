import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { SigningSecretRevealDialogUI } = await import(
  "../components/SigningSecretRevealDialog.component"
);

describe("SigningSecretRevealDialogUI (phase 6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the warning + secret in a read-only field when open with a secret", () => {
    render(
      <SigningSecretRevealDialogUI
        open
        signingSecret="whsec_test_abc123"
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("signing-secret-warning")).toBeInTheDocument();
    const input = screen.getByTestId(
      "signing-secret-input"
    ) as HTMLInputElement;
    expect(input.value).toBe("whsec_test_abc123");
    expect(input.readOnly).toBe(true);
  });

  it("does not render when open is false", () => {
    render(
      <SigningSecretRevealDialogUI
        open={false}
        signingSecret="whsec_test_abc123"
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTestId("signing-secret-input")).not.toBeInTheDocument();
  });

  it("does not render when signingSecret is null", () => {
    render(
      <SigningSecretRevealDialogUI
        open
        signingSecret={null}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTestId("signing-secret-input")).not.toBeInTheDocument();
  });

  it("invokes onClose when the Done button is clicked", () => {
    const onClose = jest.fn();
    render(
      <SigningSecretRevealDialogUI
        open
        signingSecret="whsec_x"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("copies the secret to the clipboard when the copy button is clicked", async () => {
    const writeText = jest.fn<(t: string) => Promise<void>>().mockResolvedValue(
      undefined
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <SigningSecretRevealDialogUI
        open
        signingSecret="whsec_test_xyz"
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("signing-secret-copy"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("whsec_test_xyz");
    });
  });
});
