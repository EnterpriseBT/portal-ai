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
// #939: the checkout return converges the plan from Stripe.
const mockSync = jest.fn<(body: unknown) => Promise<unknown>>();

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
      // Rename (#907) — inert stub; behavior is covered by
      // SettingsRename.test.tsx.
      update: () => ({
        mutate: jest.fn(),
        reset: jest.fn(),
        isPending: false,
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
      sync: () => ({ mutateAsync: mockSync, isPending: false, error: null }),
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
  roles: ["owner"],
  capabilities: {
    "billing.manage": true,
    "org.delete": true,
    "org.audit.read": true,
    "member.role.assign": true,
    "member.invite": true,
    "member.remove": true,
  },
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
    agentTurns: { perMin: null, perDay: null },
    overage: "hard-deny",
    maxSeats: 5,
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
        agentTurns: { perMin: null, perDay: null },
        overage: "hard-deny",
        entitlements: { builtinToolpacks: [], customToolpacks: true },
        maxSeats: 5,
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
  mockSync
    .mockReset()
    .mockResolvedValue({ tier: "standard", subscription: "live" });
});

// ── case 33 ──────────────────────────────────────────────────────────

describe("checkout return handling", () => {
  it("?billing=success → syncs once, toasts on a live plan, invalidates organizations.root, strips the param", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings?tab=billing&billing=success"
    );
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    render(<SettingsView />, { queryClient });

    await waitFor(() =>
      expect(screen.getByText("Subscription confirmed")).toBeInTheDocument()
    );
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith({});
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organizations.root,
    });
    expect(window.location.search).not.toContain("billing=");
    expect(
      screen.queryByText(/your payment is being processed/i)
    ).not.toBeInTheDocument();
  });

  it("a pending payment shows the processing alert on the billing tab", async () => {
    mockSync.mockResolvedValue({ tier: "standard", subscription: "pending" });
    window.history.replaceState(
      null,
      "",
      "/settings?tab=billing&billing=success"
    );

    render(<SettingsView />);

    expect(
      await screen.findByText(/your payment is being processed/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Subscription confirmed")
    ).not.toBeInTheDocument();
  });

  it("no subscription in Stripe says so and leaves Subscribe alone", async () => {
    mockSync.mockResolvedValue({ tier: "standard", subscription: "none" });
    window.history.replaceState(
      null,
      "",
      "/settings?tab=billing&billing=success"
    );

    render(<SettingsView />);

    expect(
      await screen.findByText(/stripe hasn't confirmed a subscription yet/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/your payment is being processed/i)
    ).not.toBeInTheDocument();
  });

  // #939 adversarial §4: a caller without billing.manage opening the return
  // link is refused; that's not a payment in progress.
  it("a permission refusal toasts it and shows no processing alert", async () => {
    mockSync.mockRejectedValue(
      Object.assign(new Error("You don't have permission to manage billing."), {
        code: "PERMISSION_DENIED",
      })
    );
    window.history.replaceState(
      null,
      "",
      "/settings?tab=billing&billing=success"
    );

    render(<SettingsView />);

    expect(
      await screen.findByText("You don't have permission to manage billing.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/your payment is being processed/i)
    ).not.toBeInTheDocument();
  });

  it("a failed sync toasts the error and still shows the processing alert", async () => {
    mockSync.mockRejectedValue(
      Object.assign(
        new Error("Could not reach Stripe — your plan will update shortly"),
        {
          code: "BILLING_SYNC_FAILED",
        }
      )
    );
    window.history.replaceState(
      null,
      "",
      "/settings?tab=billing&billing=success"
    );

    render(<SettingsView />);

    expect(
      await screen.findByText(/could not reach stripe/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/your payment is being processed/i)
    ).toBeInTheDocument();
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
    expect(mockSync).not.toHaveBeenCalled();
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
