/**
 * #1076: New Station is gated like every other create (#708), and
 * `?create=station` (the command palette's New station) opens its dialog.
 */
import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";

let mockGate: ActionGate = { kind: "allow" };
let mockCapabilitiesKnown = true;

const inert = () => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isSuccess: false,
  error: null,
  isPending: false,
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  reset: jest.fn(),
  onSearch: async () => [],
});
const domain = () =>
  new Proxy({} as Record<string, unknown>, { get: () => inert });

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: new Proxy({} as Record<string, unknown>, { get: () => domain() }),
  queryKeys: new Proxy({}, { get: () => ({ root: ["root"] }) }),
}));
jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => mockGate,
}));
jest.unstable_mockModule("../utils/use-capabilities.util", () => ({
  useCapabilities: () => ({
    capabilitiesKnown: mockCapabilitiesKnown,
    canOnResource: () => true,
    can: () => true,
  }),
}));
jest.unstable_mockModule("../utils/use-builtin-entitlements.util", () => ({
  useBuiltinEntitlements: () => ({
    entitledSlugs: new Set<string>(),
    customPacksEntitled: false,
    isEntitled: () => true,
  }),
}));

const { render, screen, waitFor, expectNoAxeViolations } =
  await import("./test-utils");
const { StationsView } = await import("../views/Stations.view");

beforeEach(() => {
  mockGate = { kind: "allow" };
  mockCapabilitiesKnown = true;
});

describe("StationsView (#1076)", () => {
  it("disables New Station with its hint when create is refused", async () => {
    mockGate = { kind: "disable", reason: "Ask for access to create stations" };
    const { container } = render(<StationsView />);
    const button = screen.getByRole("button", { name: "New Station" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(
      "Ask for access to create stations"
    );
    await expectNoAxeViolations(container);
  });

  it("hides New Station when the caller can't see stations' creates", () => {
    mockGate = { kind: "hide" };
    render(<StationsView />);
    expect(screen.queryByRole("button", { name: "New Station" })).toBeNull();
  });

  it("opens the New Station dialog from ?create=station", async () => {
    render(<StationsView />, { initialEntry: "/stations?create=station" });
    expect(
      await screen.findByRole("dialog", { name: "New Station" })
    ).toBeInTheDocument();
  });

  it("doesn't open it from ?create=station when create is refused", async () => {
    mockGate = { kind: "disable", reason: "Ask for access to create stations" };
    render(<StationsView />, { initialEntry: "/stations?create=station" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New Station" })).toBeVisible()
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
