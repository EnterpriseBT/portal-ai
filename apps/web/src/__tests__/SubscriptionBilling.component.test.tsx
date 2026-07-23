/**
 * Unit tests for the Subscription & Billing tab (#176 slice 5, cases
 * 28–32). Cases 28–31 drive the pure `SubscriptionBillingUI` through props
 * (no SDK/provider mocks — Component File Policy); case 32 exercises the
 * container's redirect + error wiring with a mocked SDK.
 */

import { jest } from "@jest/globals";
import type { BillingTier } from "@portalai/core/contracts";

// ── Container mocks (case 32 only; UI cases never touch these) ────────

const mockTiers = jest.fn();
const mockCurrent = jest.fn();
const mockProfile = jest.fn();
const mockCheckout = jest.fn();
const mockPortal = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile },
    organizations: { current: mockCurrent },
    billing: {
      tiers: mockTiers,
      checkout: mockCheckout,
      portal: mockPortal,
    },
  },
}));

const { render, screen, waitFor } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { SubscriptionBilling, SubscriptionBillingUI } =
  await import("../components/SubscriptionBilling.component");

// ── Fixtures ─────────────────────────────────────────────────────────

const policy = (tier: string) => ({
  tier,
  period: { kind: "monthly" as const, anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 2500, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 300, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny" as const,
  entitlements: { builtinToolpacks: ["data_query"], customToolpacks: true },
});

const standardTier: BillingTier = {
  slug: "standard",
  displayName: "Standard",
  policy: policy("standard"),
  description: null,
  cta: "none",
  price: null,
};

const proTier: BillingTier = {
  slug: "pro",
  displayName: "Pro",
  policy: policy("pro"),
  description: null,
  cta: "subscribe",
  price: { unitAmount: 4900, currency: "usd", interval: "month" },
};

const baseUIProps = {
  state: "unsubscribed" as const,
  isOwner: true,
  currentTierName: "Standard",
  tiers: [standardTier, proTier],
  onSubscribe: jest.fn(),
  onManage: jest.fn(),
  isPending: false,
  serverError: null,
};

// ── case 28: unsubscribed owner ──────────────────────────────────────

describe("SubscriptionBillingUI — unsubscribed", () => {
  it("renders the plan list with Subscribe enabled on purchasable tiers only", () => {
    render(<SubscriptionBillingUI {...baseUIProps} />);

    expect(
      screen.getByRole("heading", { name: "Standard" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();

    // Exactly one Subscribe button — the purchasable tier's.
    const subscribeButtons = screen.getAllByRole("button", {
      name: /subscribe/i,
    });
    expect(subscribeButtons).toHaveLength(1);
    expect(subscribeButtons[0]).toBeEnabled();
  });

  // #217: display-only tax footnote under the plan list.
  it("renders the tax footnote on the plan list", () => {
    render(<SubscriptionBillingUI {...baseUIProps} />);
    expect(
      screen.getByText("Prices exclude tax, which is calculated at checkout.")
    ).toBeInTheDocument();
  });

  it("shows the formatted price and an em-dash for null-degraded prices", () => {
    const degraded: BillingTier = { ...proTier, price: null };
    const { rerender } = render(<SubscriptionBillingUI {...baseUIProps} />);
    expect(screen.getByText(/\$49(\.00)?/)).toBeInTheDocument();

    rerender(
      <SubscriptionBillingUI
        {...baseUIProps}
        tiers={[standardTier, degraded]}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("invokes onSubscribe with the tier slug", async () => {
    const onSubscribe = jest.fn();
    render(
      <SubscriptionBillingUI {...baseUIProps} onSubscribe={onSubscribe} />
    );

    await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    expect(onSubscribe).toHaveBeenCalledWith("pro");
  });
});

// ── case 29: subscribed ──────────────────────────────────────────────

describe("SubscriptionBillingUI — subscribed", () => {
  it("shows the current plan and Manage subscription; hides the plan list", async () => {
    const onManage = jest.fn();
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        state="subscribed"
        currentTierName="Pro"
        onManage={onManage}
      />
    );

    expect(screen.getByText(/pro/i)).toBeInTheDocument();
    const manage = screen.getByRole("button", {
      name: /manage subscription/i,
    });
    expect(manage).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /subscribe$/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Standard")).not.toBeInTheDocument();

    await userEvent.click(manage);
    expect(onManage).toHaveBeenCalled();
  });
});

// ── case 30: managed ─────────────────────────────────────────────────

describe("SubscriptionBillingUI — managed", () => {
  it("renders the managed-plan notice and no action buttons", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        state="managed"
        currentTierName="Enterprise Acme"
      />
    );

    expect(screen.getByText(/managed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ── case 31: non-owner ───────────────────────────────────────────────

describe("SubscriptionBillingUI — non-owner", () => {
  it("disables Subscribe with the owner-only tooltip", async () => {
    render(<SubscriptionBillingUI {...baseUIProps} isOwner={false} />);

    const subscribe = screen.getByRole("button", { name: /subscribe/i });
    expect(subscribe).toBeDisabled();

    await userEvent.hover(subscribe.parentElement as HTMLElement);
    await waitFor(() =>
      expect(
        screen.getByText(/only the organization owner can manage billing/i)
      ).toBeInTheDocument()
    );
  });

  it("disables Manage subscription for a subscribed org", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        state="subscribed"
        isOwner={false}
      />
    );
    expect(
      screen.getByRole("button", { name: /manage subscription/i })
    ).toBeDisabled();
  });
});

// ── error surface ────────────────────────────────────────────────────

describe("SubscriptionBillingUI — server error", () => {
  it("renders FormAlert with the error and code", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        serverError={{
          message: "Could not start checkout — please try again",
          code: "BILLING_CHECKOUT_FAILED",
        }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not start checkout/i
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "BILLING_CHECKOUT_FAILED"
    );
  });

  it("renders no alert when serverError is null", () => {
    render(<SubscriptionBillingUI {...baseUIProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ── case 32: container redirect + error wiring ───────────────────────

describe("SubscriptionBilling container", () => {
  const loaded = <T,>(data: T) => ({
    data,
    error: null,
    isLoading: false,
    isError: false,
    isSuccess: true,
  });

  const orgData = {
    organization: {
      id: "org-1",
      name: "Acme Corp",
      ownerUserId: "user-1",
      tier: "standard",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      billingAnchorDay: null,
    },
  };
  const profileData = {
    profile: { sub: "auth0|u1", name: "Jane" },
    lastLogin: null,
    userId: "user-1",
  };

  let replaceSpy: jest.Mock;

  beforeEach(() => {
    mockTiers.mockReturnValue(loaded({ tiers: [standardTier, proTier] }));
    mockCurrent.mockReturnValue(loaded(orgData));
    mockProfile.mockReturnValue(loaded(profileData));
    mockPortal.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
      error: null,
    });

    replaceSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, replace: replaceSpy },
      writable: true,
    });
  });

  it("redirects to the checkout URL via window.location.replace on success", async () => {
    const mutateAsync = jest
      .fn<() => Promise<{ url: string }>>()
      .mockResolvedValue({ url: "https://checkout.stripe.com/c/sess_1" });
    mockCheckout.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: null,
    });

    render(<SubscriptionBilling />);

    await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/sess_1"
      )
    );
    expect(mutateAsync).toHaveBeenCalledWith({ tier: "pro" });
  });

  it("surfaces a server error through FormAlert and does not redirect", async () => {
    const mutateAsync = jest
      .fn<() => Promise<{ url: string }>>()
      .mockRejectedValue(new Error("boom"));
    mockCheckout.mockReturnValue({
      mutateAsync,
      isPending: false,
      error: {
        message: "Could not start checkout — please try again",
        code: "BILLING_CHECKOUT_FAILED",
      },
    });

    render(<SubscriptionBilling />);

    await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "BILLING_CHECKOUT_FAILED"
      )
    );
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
