import { jest } from "@jest/globals";
import type { Toolpack } from "@portalai/core/contracts";

// ── Mocks ───────────────────────────────────────────────────────────

const mockListResult = jest.fn<() => unknown>();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    toolpacks: {
      list: mockListResult,
    },
  },
  queryKeys: { toolpacks: { root: ["toolpacks"] } },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { ToolPackChipWithMetadata } = await import(
  "../components/ToolPackChipWithMetadata.component"
);

// ── Helpers ─────────────────────────────────────────────────────────

const customPack: Toolpack = {
  id: "otp-1",
  kind: "custom",
  slug: "customer_intel",
  name: "Customer Intel",
  description: "External customer intelligence.",
  iconSlug: "Extension",
  tools: [
    {
      name: "lookup_company",
      description: "Look up a company.",
      parameterSchema: { type: "object", properties: {} },
    },
  ],
  endpoints: {
    schema: "https://example.com/schema",
    runtime: "https://example.com/runtime",
  },
  authHeadersStatus: { has: false },
  signingSecretStatus: { has: true },
  schemaFetchedAt: 1700000000000,
  metadataFetchedAt: null,
};

describe("ToolPackChipWithMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Case 118
  it("resolves a built-in slug from the registry even before the list query lands", () => {
    // Simulate the list query still loading (no `data`).
    mockListResult.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    });

    render(<ToolPackChipWithMetadata pack="data_query" />);

    // Click should open the modal with the registry's metadata.
    fireEvent.click(screen.getByText("Data Query"));
    // Modal heading + chip both show the name.
    expect(screen.getAllByText("Data Query").length).toBeGreaterThanOrEqual(2);
  });

  // Case 119
  it("resolves an org:<uuid> ref from the mocked list payload and opens the modal on click", () => {
    mockListResult.mockReturnValue({
      data: { toolpacks: [customPack], total: 1 },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    });

    render(<ToolPackChipWithMetadata pack="org:otp-1" />);

    // The chip shows the resolved label, not the raw ref.
    expect(screen.getByText("Customer Intel")).toBeInTheDocument();
    // Click opens the modal.
    fireEvent.click(screen.getByText("Customer Intel"));
    // Tool name from the custom pack renders inside the modal.
    expect(screen.getByText("lookup_company")).toBeInTheDocument();
  });

  it("renders a non-clickable chip for an unresolvable org:<uuid> ref", () => {
    mockListResult.mockReturnValue({
      data: { toolpacks: [], total: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    });

    render(<ToolPackChipWithMetadata pack="org:does-not-exist" />);

    // Chip renders with the raw ref as the label fallback.
    expect(screen.getByText("org:does-not-exist")).toBeInTheDocument();
    // Click does not open the modal — heading still absent.
    fireEvent.click(screen.getByText("org:does-not-exist"));
    expect(
      screen.queryByLabelText("Close metadata")
    ).not.toBeInTheDocument();
  });
});
