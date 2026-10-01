const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { AttachmentChipUI } =
  await import("../components/AttachmentChip.component");

describe("AttachmentChipUI (#674)", () => {
  it("renders a readable chip with its label, primary and unlocked", () => {
    render(<AttachmentChipUI kind="view" label="Q3 orders" canRead />);
    const chip = screen.getByText("Q3 orders").closest(".MuiChip-root")!;
    expect(chip).toHaveClass("MuiChip-colorPrimary");
    expect(screen.queryByTestId("LockOutlinedIcon")).not.toBeInTheDocument();
  });

  it.each([
    ["view", "You don't have access to this view"],
    ["connector", "You don't have access to this connector"],
  ] as const)(
    "renders an unreadable %s with its real name, error colour, a lock, tooltip and aria-label",
    async (kind, text) => {
      render(<AttachmentChipUI kind={kind} label="Secret" canRead={false} />);
      const chip = screen.getByTestId("attachment-chip-no-access");
      expect(chip).toHaveTextContent("Secret");
      expect(chip).toHaveClass("MuiChip-colorError");
      expect(chip).toHaveClass("MuiChip-outlined");
      expect(screen.getByTestId("LockOutlinedIcon")).toBeInTheDocument();
      expect(chip).toHaveAttribute("aria-label", `Secret: ${text}`);
      fireEvent.mouseOver(chip);
      await waitFor(() =>
        expect(screen.getByRole("tooltip")).toHaveTextContent(text)
      );
    }
  );

  it("is not clickable when unreadable", () => {
    render(<AttachmentChipUI kind="view" label="Secret" canRead={false} />);
    const chip = screen.getByTestId("attachment-chip-no-access");
    expect(chip).not.toHaveClass("MuiChip-clickable");
    expect(chip).not.toHaveAttribute("role", "button");
  });
});
