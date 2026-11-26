import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { PinTileUI } = await import("../components/PinTile.component");

const pin = { id: "r1", title: "Q3 variance" };

describe("PinTileUI", () => {
  it("links its h3 title to the pinned result and shows its content", async () => {
    const { container } = render(
      <PinTileUI pin={pin} status="ready">
        <p>Block content</p>
      </PinTileUI>
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Q3 variance" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Q3 variance" })).toHaveAttribute(
      "href",
      "/portal-results/r1"
    );
    expect(screen.getByText("Block content")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows loading instead of its content", async () => {
    const { container } = render(
      <PinTileUI pin={pin} status="loading">
        <p>Block content</p>
      </PinTileUI>
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading Q3 variance…"
    );
    expect(screen.queryByText("Block content")).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows its error with a Retry for this pin", async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();
    const { container } = render(
      <PinTileUI pin={pin} status="error" onRetry={onRetry} />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load this result."
    );
    await user.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledWith("r1");
    await expectNoAxeViolations(container);
  });

  it("offers no Retry unless it failed", () => {
    render(<PinTileUI pin={pin} status="ready" onRetry={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});
