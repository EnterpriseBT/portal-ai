import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockProfile = jest.fn();
const mockCurrent = jest.fn();
const mockUsage = jest.fn();
const mockDelete = jest.fn();
const mockLogout = jest.fn();
const mockMutate = jest.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  }
);

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile, logout: () => ({ logout: mockLogout }) },
    organizations: {
      current: mockCurrent,
      usage: mockUsage,
      delete: mockDelete,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SettingsView } = await import("../views/Settings.view");

// ── Fixtures (DataResult's QueryResultLike shape) ────────────────────

const loaded = <T,>(data: T) => ({
  data,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: true,
});

const profileData = {
  profile: {
    name: "Jane Doe",
    email: "jane@example.com",
    picture: "",
    nickname: null,
  },
  lastLogin: 1_700_000_000_000,
};

const orgData = {
  organization: {
    id: "org-1",
    name: "Acme Corp",
    timezone: "UTC",
    created: 1_700_000_000_000,
    updated: null,
  },
};

const usageData = {
  tier: {
    tier: "standard",
    period: { kind: "monthly", anchorDay: 1 },
    allocations: {
      free: { unitsPerPeriod: null, ratePerMin: null },
      metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
      expensive: { unitsPerPeriod: 100, ratePerMin: 5 },
    },
    perToolCaps: null,
    overage: "hard-deny",
  },
  usage: {
    periodId: "2026-07",
    byClass: {
      free: { used: 0, available: null },
      metered: { used: 30, available: 970 },
      expensive: { used: 0, available: 100 },
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile.mockReturnValue(loaded(profileData));
  mockCurrent.mockReturnValue(loaded(orgData));
  mockUsage.mockReturnValue(loaded(usageData));
  mockDelete.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
  });
});

const openOrganizationTab = async () => {
  render(<SettingsView />);
  await userEvent.click(screen.getByRole("tab", { name: "Organization" }));
};

// ── Tests ────────────────────────────────────────────────────────────

describe("SettingsView — Danger zone (#197 slice 5)", () => {
  it("renders the Danger zone and opens the delete dialog (case 25)", async () => {
    await openOrganizationTab();

    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    const openButton = screen.getByRole("button", {
      name: "Delete organization",
    });

    // The mutation hook is created against the loaded org's id.
    expect(mockDelete).toHaveBeenCalledWith("org-1");

    await userEvent.click(openButton);
    expect(screen.getByText("Delete Organization")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Type "Acme Corp" to confirm/)
    ).toBeInTheDocument();
  });

  it("submits the typed name and logs out on success (case 26)", async () => {
    await openOrganizationTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete organization" })
    );

    await userEvent.type(
      screen.getByLabelText(/Type "Acme Corp" to confirm/),
      "Acme Corp"
    );
    await userEvent.click(screen.getByTestId("confirm-delete-organization"));

    expect(mockMutate).toHaveBeenCalledWith(
      { confirmationName: "Acme Corp" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    // The mock mutate invokes onSuccess synchronously → logout fires.
    expect(mockLogout).toHaveBeenCalled();
  });

  it("does not log out while the mutation has not succeeded (case 26)", async () => {
    mockMutate.mockImplementationOnce(() => undefined); // server rejected
    await openOrganizationTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete organization" })
    );
    await userEvent.type(
      screen.getByLabelText(/Type "Acme Corp" to confirm/),
      "Acme Corp"
    );
    await userEvent.click(screen.getByTestId("confirm-delete-organization"));

    expect(mockMutate).toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
