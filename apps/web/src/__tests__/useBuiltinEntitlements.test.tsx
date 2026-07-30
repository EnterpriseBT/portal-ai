import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockUsage = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: { usage: mockUsage },
  },
}));

const { render, screen } = await import("./test-utils");
const { useBuiltinEntitlements } =
  await import("../utils/use-builtin-entitlements.util");
const { ALL_BUILTIN_SLUGS } = await import("../utils/tool-packs.util");

// ── Query-result helpers ─────────────────────────────────────────────

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
const errored = () => ({
  data: undefined,
  error: new Error("boom"),
  isLoading: false,
  isError: true,
  isSuccess: false,
});

const usagePayload = (builtinToolpacks: string[]) => ({
  tier: {
    tier: "standard",
    entitlements: { builtinToolpacks, customToolpacks: false },
  },
  usage: { periodId: "2026-07", byClass: {} },
});

/** Probe that renders the hook's output so assertions read off the DOM. */
const Probe = () => {
  const { entitledSlugs, isEntitled, isLoading } = useBuiltinEntitlements();
  return (
    <div>
      <span data-testid="slugs">{[...entitledSlugs].sort().join(",")}</span>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="entity-mgmt">
        {String(isEntitled("entity_management"))}
      </span>
      <span data-testid="custom-ref">{String(isEntitled("org:abc"))}</span>
    </div>
  );
};

beforeEach(() => {
  mockUsage.mockReset();
});

describe("useBuiltinEntitlements (#284)", () => {
  it("returns the tier's entitled built-in slugs when the query has resolved", () => {
    mockUsage.mockReturnValue(
      loaded(usagePayload(["data_query", "web_search"]))
    );

    render(<Probe />);

    expect(screen.getByTestId("slugs").textContent).toBe(
      "data_query,web_search"
    );
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("entity-mgmt").textContent).toBe("false");
    // The custom axis is not this hook's business.
    expect(screen.getByTestId("custom-ref").textContent).toBe("true");
  });

  it("fails open while the query is loading — every built-in reads as entitled", () => {
    mockUsage.mockReturnValue(loading());

    render(<Probe />);

    expect(screen.getByTestId("slugs").textContent).toBe(
      [...ALL_BUILTIN_SLUGS].sort().join(",")
    );
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("entity-mgmt").textContent).toBe("true");
  });

  it("fails open on a payload whose tier carries no entitlements", () => {
    // A partial usage payload (older response shape, partially hydrated
    // cache) must degrade to fail-open, not throw inside the mounting view.
    mockUsage.mockReturnValue(loaded({ tier: { tier: "standard" } }));

    render(<Probe />);

    expect(screen.getByTestId("slugs").textContent).toBe(
      [...ALL_BUILTIN_SLUGS].sort().join(",")
    );
    expect(screen.getByTestId("entity-mgmt").textContent).toBe("true");
  });

  it("fails open when the query errors — a failed side query never forbids work", () => {
    mockUsage.mockReturnValue(errored());

    render(<Probe />);

    expect(screen.getByTestId("slugs").textContent).toBe(
      [...ALL_BUILTIN_SLUGS].sort().join(",")
    );
    expect(screen.getByTestId("entity-mgmt").textContent).toBe("true");
  });
});
