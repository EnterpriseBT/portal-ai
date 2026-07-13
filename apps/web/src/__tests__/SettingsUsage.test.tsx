import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockProfile = jest.fn();
const mockCurrent = jest.fn();
const mockUsage = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile, logout: () => ({ logout: jest.fn() }) },
    organizations: {
      current: mockCurrent,
      usage: mockUsage,
      // Danger zone (#197) — inert stub; behavior is covered by
      // SettingsDangerZone.test.tsx.
      delete: () => ({ mutate: jest.fn(), isPending: false, error: null }),
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SettingsView } = await import("../views/Settings.view");

// ── Query-result helpers (DataResult's QueryResultLike shape) ─────────

const loaded = <T,>(data: T) => ({
  data,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: true,
});
const loading = () => ({
  data: undefined,
  error: null,
  isLoading: true,
  isError: false,
  isSuccess: false,
});
const errored = (message: string) => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  isError: true,
  isSuccess: false,
});

// ── Fixtures ─────────────────────────────────────────────────────────

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
  mockProfile.mockReturnValue(loaded(profileData));
  mockCurrent.mockReturnValue(loaded(orgData));
  mockUsage.mockReturnValue(loaded(usageData));
});

const openOrganizationTab = async () => {
  render(<SettingsView />);
  await userEvent.click(screen.getByRole("tab", { name: "Organization" }));
};

// ── Tests ────────────────────────────────────────────────────────────

describe("SettingsView — Organization tier + usage (#172 slice 4)", () => {
  it("renders the Subscription Tier row with a presentable label", async () => {
    await openOrganizationTab();
    expect(screen.getByText("Subscription Tier")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("renders used/available per class; an unlimited class shows Unlimited", async () => {
    await openOrganizationTab();
    expect(screen.getByText("30 used · 970 available")).toBeInTheDocument();
    // `free` is unlimited on the standard tier
    expect(screen.getByText("0 used · Unlimited")).toBeInTheDocument();
  });

  it("does not crash while the usage query is loading", async () => {
    mockUsage.mockReturnValue(loading());
    await openOrganizationTab();
    expect(
      screen.getByRole("heading", { name: "Settings" })
    ).toBeInTheDocument();
  });

  it("does not crash when the usage query errors", async () => {
    mockUsage.mockReturnValue(errored("boom"));
    await openOrganizationTab();
    expect(
      screen.getByRole("heading", { name: "Settings" })
    ).toBeInTheDocument();
  });
});
