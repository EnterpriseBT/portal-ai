/**
 * Settings ↔ billing integration (#176 slice 5, case 33): the
 * `?billing={success,cancelled}` checkout-return handling and the
 * Subscription & Billing tab mount.
 */

import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockProfile = jest.fn();
const mockCurrent = jest.fn();
const mockUsage = jest.fn();
const mockBillingTiers = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile, logout: () => ({ logout: jest.fn() }) },
    organizations: {
      current: mockCurrent,
      usage: mockUsage,
      // Itemized drill-down (#179) — inert stub; behavior is covered by
      // UsageLedgerDialog.component.test.tsx.
      usageLedger: () => ({
        data: { entries: [], total: 0 },
        isLoading: false,
        isError: false,
        error: null,
      }),
      delete: () => ({ mutate: jest.fn(), isPending: false, error: null }),
    },
    billing: {
      tiers: mockBillingTiers,
      checkout: () => ({
        mutateAsync: jest.fn(),
        isPending: false,
        error: null,
      }),
      portal: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }),
    },
  },
}));

const { render, screen, waitFor } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SettingsView } = await import("../views/Settings.view");
const { queryKeys } = await import("../api/keys");
const { QueryClient } = await import("@tanstack/react-query");

// ── Fixtures ─────────────────────────────────────────────────────────

const loaded = <T,>(data: T) => ({
  data,
  error: null,
  isLoading: false,
  isError: false,
  isSuccess: true,
});

const profileData = {
  profile: { sub: "auth0|u1", name: "Jane Doe", email: "jane@example.com" },
  lastLogin: null,
  userId: "user-1",
};
const orgData = {
  organization: {
    id: "org-1",
    name: "Acme Corp",
    timezone: "UTC",
    ownerUserId: "user-1",
    tier: "standard",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingAnchorDay: null,
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
const tiersData = {
  tiers: [
    {
      slug: "standard",
      displayName: "Standard",
      policy: {
        tier: "standard",
        period: { kind: "monthly", anchorDay: 1 },
        allocations: usageData.tier.allocations,
        perToolCaps: null,
        overage: "hard-deny",
        entitlements: { builtinToolpacks: [], customToolpacks: true },
      },
      description: null,
      cta: "none",
      price: null,
    },
  ],
};

beforeEach(() => {
  mockProfile.mockReturnValue(loaded(profileData));
  mockCurrent.mockReturnValue(loaded(orgData));
  mockUsage.mockReturnValue(loaded(usageData));
  mockBillingTiers.mockReturnValue(loaded(tiersData));
  window.history.replaceState(null, "", "/settings");
});

// ── case 33 ──────────────────────────────────────────────────────────

describe("checkout return handling", () => {
  it("?billing=success → toast + invalidateQueries(organizations.root), param stripped", async () => {
    window.history.replaceState(null, "", "/settings?billing=success");
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    render(<SettingsView />, { queryClient });

    await waitFor(() =>
      expect(
        screen.getByText(/subscription confirmed — your plan updates/i)
      ).toBeInTheDocument()
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organizations.root,
    });
    expect(window.location.search).not.toContain("billing");
  });

  it("?billing=cancelled → neutral toast, no invalidation", async () => {
    window.history.replaceState(null, "", "/settings?billing=cancelled");
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    render(<SettingsView />, { queryClient });

    await waitFor(() =>
      expect(
        screen.getByText(/checkout cancelled — your plan is unchanged/i)
      ).toBeInTheDocument()
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("renders no toast without the param", () => {
    render(<SettingsView />);
    expect(
      screen.queryByText(/subscription confirmed/i)
    ).not.toBeInTheDocument();
  });
});

describe("Subscription & Billing tab", () => {
  it("mounts the billing container when the tab is opened", async () => {
    render(<SettingsView />);

    // Container not mounted while another tab is active.
    expect(mockBillingTiers).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("tab", { name: /subscription & billing/i })
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Standard" })
      ).toBeInTheDocument()
    );
    expect(mockBillingTiers).toHaveBeenCalled();
  });
});
