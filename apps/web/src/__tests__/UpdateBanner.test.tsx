import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

// ── Mocks ───────────────────────────────────────────────────────────

const mockUseAppVersion = jest.fn<() => { updateAvailable: boolean; dismiss: () => void }>();

jest.unstable_mockModule("../utils/app-version.util", () => ({
  useAppVersion: mockUseAppVersion,
}));

const { render, screen } = await import("./test-utils");
const { UpdateBannerUI, UpdateBanner } = await import(
  "../components/UpdateBanner.component"
);

// ── UpdateBannerUI (pure) ───────────────────────────────────────────

describe("UpdateBannerUI", () => {
  it("renders the alert with reload and dismiss buttons when open", () => {
    render(
      <UpdateBannerUI open={true} onReload={jest.fn()} onDismiss={jest.fn()} />
    );

    expect(screen.getByText("A new version is available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss" })
    ).toBeInTheDocument();
  });

  it("does not render the alert when open is false", () => {
    render(
      <UpdateBannerUI
        open={false}
        onReload={jest.fn()}
        onDismiss={jest.fn()}
      />
    );

    expect(
      screen.queryByText("A new version is available.")
    ).not.toBeInTheDocument();
  });

  it("calls onReload when the reload button is clicked", async () => {
    const user = userEvent.setup();
    const onReload = jest.fn();
    render(
      <UpdateBannerUI open={true} onReload={onReload} onDismiss={jest.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const user = userEvent.setup();
    const onDismiss = jest.fn();
    render(
      <UpdateBannerUI open={true} onReload={jest.fn()} onDismiss={onDismiss} />
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ── UpdateBanner (container) ────────────────────────────────────────

describe("UpdateBanner", () => {
  it("renders the banner when an update is available", () => {
    mockUseAppVersion.mockReturnValue({
      updateAvailable: true,
      dismiss: jest.fn(),
    });

    render(<UpdateBanner />);
    expect(screen.getByText("A new version is available.")).toBeInTheDocument();
  });

  it("does not render the banner when no update is available", () => {
    mockUseAppVersion.mockReturnValue({
      updateAvailable: false,
      dismiss: jest.fn(),
    });

    render(<UpdateBanner />);
    expect(
      screen.queryByText("A new version is available.")
    ).not.toBeInTheDocument();
  });

  it("calls dismiss from the hook when Dismiss is clicked", async () => {
    const user = userEvent.setup();
    const dismiss = jest.fn();
    mockUseAppVersion.mockReturnValue({ updateAvailable: true, dismiss });

    render(<UpdateBanner />);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
