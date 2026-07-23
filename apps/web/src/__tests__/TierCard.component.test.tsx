/**
 * Unit tests for the pure `TierCardUI` (#241, cases 23–26). Props-only — no
 * SDK/provider/router mocks (Component File Policy).
 */

import { jest } from "@jest/globals";
import type { BillingTier } from "@portalai/core/contracts";

const { render, screen, waitFor } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TierCardUI } = await import("../components/TierCard.component");

// ── Fixtures ─────────────────────────────────────────────────────────

const policy = (tier: string): BillingTier["policy"] => ({
  tier,
  period: { kind: "monthly", anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 2500, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 300, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny",
  entitlements: { builtinToolpacks: ["data_query"], customToolpacks: true },
});

const subscribeTier: BillingTier = {
  slug: "pro",
  displayName: "Pro",
  policy: policy("pro"),
  description: "Everything in Standard, plus more.",
  cta: "subscribe",
  price: { unitAmount: 4900, currency: "usd", interval: "month" },
};

const contactTier: BillingTier = {
  slug: "acme_enterprise",
  displayName: "Acme Enterprise",
  policy: policy("acme_enterprise"),
  description: "Tailored to Acme.",
  cta: "contact",
  price: null,
};

const noneTier: BillingTier = {
  slug: "standard",
  displayName: "Standard",
  policy: policy("standard"),
  description: null,
  cta: "none",
  price: null,
};

const base = {
  isCurrentPlan: false,
  isOwner: true,
  isPending: false,
  onSubscribe: jest.fn(),
};

// ── case 23: subscribe tier ──────────────────────────────────────────

describe("TierCardUI — subscribe", () => {
  it("renders the policy grid and an enabled owner Subscribe button", () => {
    render(<TierCardUI {...base} tier={subscribeTier} />);

    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    expect(
      screen.getByText("Everything in Standard, plus more.")
    ).toBeInTheDocument();
    // Grid dimensions present.
    expect(screen.getByText(/Metered tools:/)).toBeInTheDocument();
    expect(
      screen.getByText(/2,500 units \/ period · 20 \/ min/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Data Query/)).toBeInTheDocument();

    const subscribe = screen.getByRole("button", { name: /subscribe/i });
    expect(subscribe).toBeEnabled();
  });

  it("disables Subscribe with the owner-only tooltip for a non-owner", async () => {
    render(<TierCardUI {...base} tier={subscribeTier} isOwner={false} />);

    const subscribe = screen.getByRole("button", { name: /subscribe/i });
    expect(subscribe).toBeDisabled();

    await userEvent.hover(subscribe.parentElement as HTMLElement);
    await waitFor(() =>
      expect(
        screen.getByText(/only the organization owner can manage billing/i)
      ).toBeInTheDocument()
    );
  });

  it("invokes onSubscribe with the slug", async () => {
    const onSubscribe = jest.fn();
    render(
      <TierCardUI {...base} tier={subscribeTier} onSubscribe={onSubscribe} />
    );
    await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    expect(onSubscribe).toHaveBeenCalledWith("pro");
  });

  it("does NOT offer Subscribe on the current plan (only the chip)", () => {
    render(<TierCardUI {...base} tier={subscribeTier} isCurrentPlan />);

    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /subscribe/i })
    ).not.toBeInTheDocument();
  });
});

// ── case 24: contact tier as an upgrade teaser (not current) ─────────

describe("TierCardUI — contact (upgrade teaser)", () => {
  it("shows title + blurb + Contact support, and HIDES the policy grid", () => {
    render(<TierCardUI {...base} tier={contactTier} />);

    expect(
      screen.getByRole("heading", { name: "Acme Enterprise" })
    ).toBeInTheDocument();
    expect(screen.getByText("Tailored to Acme.")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /^contact support$/i });
    expect(link).toHaveAttribute("href", "mailto:ben.turner@btdev.io");

    // Grid is hidden for a teaser.
    expect(screen.queryByText(/Metered tools:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /subscribe/i })
    ).not.toBeInTheDocument();
  });
});

// ── case 25: contact tier as the current plan ────────────────────────

describe("TierCardUI — contact (current plan)", () => {
  it("shows the full grid and the manage/update CTA", () => {
    render(<TierCardUI {...base} tier={contactTier} isCurrentPlan />);

    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText(/Metered tools:/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /contact support to manage\/update your plan/i,
      })
    ).toBeInTheDocument();
  });
});

// ── case 26: none tier (free default) ────────────────────────────────

describe("TierCardUI — none (free default)", () => {
  it("shows a current-plan chip, no CTA, and no blurb when description is null", () => {
    render(<TierCardUI {...base} tier={noneTier} isCurrentPlan />);

    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    // Free default: grid shown, but no action affordance.
    expect(screen.getByText(/Metered tools:/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // No blurb paragraph (description is null).
    expect(screen.queryByText("Tailored to Acme.")).not.toBeInTheDocument();
  });
});
