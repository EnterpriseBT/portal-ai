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
const mockUsage = jest.fn();
const mockProfile = jest.fn();
const mockCheckout = jest.fn();
const mockPortal = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile },
    organizations: { current: mockCurrent, usage: mockUsage },
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

// A second priced tier, so a subscribed org (on pro) has a switch target.
const scaleTier: BillingTier = {
  slug: "scale",
  displayName: "Scale",
  policy: policy("scale"),
  description: null,
  cta: "subscribe",
  price: { unitAmount: 9900, currency: "usd", interval: "month" },
};

const contactTier: BillingTier = {
  slug: "acme_enterprise",
  displayName: "Acme Enterprise",
  policy: { ...policy("acme_enterprise") },
  description: "Tailored to Acme.",
  cta: "contact",
  price: null,
};

// A managed (unlisted) tier synthesized from usage() — cta "none", no price.
const managedTier: BillingTier = {
  slug: "ent_x",
  displayName: "X Enterprise",
  policy: policy("ent_x"),
  description: null,
  cta: "none",
  price: null,
};

const baseUIProps = {
  state: "unsubscribed" as const,
  isOwner: true,
  currentTierName: "Standard",
  currentTierSlug: "standard",
  tiers: [standardTier, proTier],
  currentPlanTier: null,
  onSubscribe: jest.fn(),
  onSwitch: jest.fn(),
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

  // #241: a contact (custom) tier in the list renders a Contact-support card.
  it("renders a contact tier's Contact support CTA and flags the current plan", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        tiers={[standardTier, proTier, contactTier]}
      />
    );

    expect(
      screen.getByRole("link", { name: /^contact support$/i })
    ).toHaveAttribute("href", "mailto:ben.turner@btdev.io");
    // The current plan (standard) is chip-flagged.
    expect(screen.getByText("Current plan")).toBeInTheDocument();
  });

  // #241: on a custom plan, show ONLY that card (no self-serve upgrade list).
  it("shows only the custom card when the org is on a custom plan", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        tiers={[standardTier, proTier, contactTier]}
        currentTierName="Acme Enterprise"
        currentTierSlug="acme_enterprise"
      />
    );

    expect(
      screen.getByRole("heading", { name: "Acme Enterprise" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Standard" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Pro" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /subscribe/i })
    ).not.toBeInTheDocument();
  });
});

// ── case 29: subscribed ──────────────────────────────────────────────

describe("SubscriptionBillingUI — subscribed (#260)", () => {
  const subscribedProps = {
    ...baseUIProps,
    state: "subscribed" as const,
    currentTierName: "Pro",
    currentTierSlug: "pro",
    tiers: [standardTier, proTier, scaleTier],
  };

  // case 11: the full grid renders (current flagged) + Manage; a non-current
  // priced tier offers "Switch to this plan" (not "Subscribe"); no Subscribe.
  it("renders the grid with Switch on other paid tiers + Manage, current flagged", () => {
    render(<SubscriptionBillingUI {...subscribedProps} />);

    // Grid is shown (Pro current + Scale switchable), not just a single card.
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scale" })).toBeInTheDocument();
    expect(screen.getByText("Current plan")).toBeInTheDocument();

    const switchBtn = screen.getByRole("button", {
      name: /switch to this plan/i,
    });
    expect(switchBtn).toBeEnabled();
    // No "Subscribe" (that's the unsubscribed flow); Manage present.
    expect(
      screen.queryByRole("button", { name: /^subscribe$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /manage subscription/i })
    ).toBeInTheDocument();
  });

  it("clicking Switch calls onSwitch with the tier slug; Manage calls onManage", async () => {
    const onSwitch = jest.fn();
    const onManage = jest.fn();
    render(
      <SubscriptionBillingUI
        {...subscribedProps}
        onSwitch={onSwitch}
        onManage={onManage}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /switch to this plan/i })
    );
    expect(onSwitch).toHaveBeenCalledWith("scale");

    await userEvent.click(
      screen.getByRole("button", { name: /manage subscription/i })
    );
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

  // #257: a managed (unlisted) tier's policy renders read-only under the banner.
  it("renders the current-plan policy card (from usage) below the managed banner", () => {
    render(
      <SubscriptionBillingUI
        {...baseUIProps}
        state="managed"
        currentTierName="X Enterprise"
        currentTierSlug="ent_x"
        currentPlanTier={managedTier}
      />
    );

    expect(screen.getByText(/managed/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "X Enterprise" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Metered tools:/)).toBeInTheDocument();
    // A synthesized `none`-cta card offers no action.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
    // #257: usage() feeds the current-plan card; not gating the tab.
    mockUsage.mockReturnValue(
      loaded({
        tier: policy("standard"),
        usage: { periodId: "2026-07", byClass: {} },
      })
    );
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

  // #257: a managed org (tier absent from the billing list) renders a
  // current-plan card synthesized from usage()'s TierPolicy.
  it("renders the managed current-plan card from usage() when the tier is unlisted", () => {
    mockCheckout.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
      error: null,
    });
    // org.tier "ent_x" is NOT in [standard, pro] → managed state.
    mockCurrent.mockReturnValue(
      loaded({ organization: { ...orgData.organization, tier: "ent_x" } })
    );
    mockUsage.mockReturnValue(
      loaded({
        tier: policy("ent_x"),
        usage: { periodId: "2026-07", byClass: {} },
      })
    );

    render(<SubscriptionBilling />);

    expect(screen.getByText(/managed/i)).toBeInTheDocument();
    // Slug-derived name (usage carries no displayName) + the policy grid.
    expect(screen.getByRole("heading", { name: "Ent X" })).toBeInTheDocument();
    expect(screen.getByText(/Metered tools:/)).toBeInTheDocument();
  });

  // #260 case 12: a subscribed org switches plans via the portal mutation.
  it("switch: opens the portal with the target tier and redirects", async () => {
    mockTiers.mockReturnValue(
      loaded({ tiers: [standardTier, proTier, scaleTier] })
    );
    mockCurrent.mockReturnValue(
      loaded({
        organization: {
          ...orgData.organization,
          tier: "pro",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: "sub_1",
        },
      })
    );
    mockCheckout.mockReturnValue({
      mutateAsync: jest.fn(),
      isPending: false,
      error: null,
    });
    const portalMutate = jest
      .fn<() => Promise<{ url: string }>>()
      .mockResolvedValue({ url: "https://billing.stripe.com/p/switch" });
    mockPortal.mockReturnValue({
      mutateAsync: portalMutate,
      isPending: false,
      error: null,
    });

    render(<SubscriptionBilling />);

    await userEvent.click(
      screen.getByRole("button", { name: /switch to this plan/i })
    );
    await waitFor(() =>
      expect(replaceSpy).toHaveBeenCalledWith(
        "https://billing.stripe.com/p/switch"
      )
    );
    expect(portalMutate).toHaveBeenCalledWith({ tier: "scale" });
  });
});
