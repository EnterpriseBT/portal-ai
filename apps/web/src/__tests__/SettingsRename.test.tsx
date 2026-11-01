import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockProfile = jest.fn();
const mockCurrent = jest.fn();
const mockUsage = jest.fn();
const mockUpdate = jest.fn();
const mockMutate = jest.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  }
);
const mockReset = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile, logout: () => ({ logout: jest.fn() }) },
    organizations: {
      current: mockCurrent,
      usage: mockUsage,
      usageLedger: () => ({
        data: { entries: [], total: 0 },
        isLoading: false,
        isError: false,
        error: null,
      }),
      update: mockUpdate,
      delete: () => ({
        mutate: jest.fn(),
        reset: jest.fn(),
        isPending: false,
        error: null,
      }),
    },
  },
}));

const { render, screen, waitFor } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { QueryClient } = await import("@tanstack/react-query");
const { queryKeys } = await import("../api/keys");
const { ApiError } = await import("../utils/api.util");
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

const ownerCaps = {
  "billing.manage": true,
  "org.delete": true,
  "org.write": true,
  "org.audit.read": true,
  "member.role.assign": true,
  "member.invite": true,
  "member.remove": true,
};
const memberCaps = {
  "billing.manage": false,
  "org.delete": false,
  "org.write": false,
  "org.audit.read": false,
  "member.role.assign": false,
  "member.invite": false,
  "member.remove": false,
};

const orgData = {
  roles: ["owner"],
  capabilities: ownerCaps,
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
    agentTurns: { perMin: null, perDay: null },
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
  mockUpdate.mockReturnValue({
    mutate: mockMutate,
    reset: mockReset,
    isPending: false,
    error: null,
  });
});

const openOrganizationTab = async (
  queryClient?: InstanceType<typeof QueryClient>
) => {
  render(<SettingsView />, queryClient ? { queryClient } : undefined);
  await userEvent.click(screen.getByRole("tab", { name: "Organization" }));
};

const renameField = () =>
  screen.getByRole("textbox", { name: /organization name/i });

// ── Tests ────────────────────────────────────────────────────────────

describe("SettingsView — Rename organization (#907)", () => {
  it("shows Rename to a caller with org.write", async () => {
    await openOrganizationTab();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    // The mutation hook is created against the loaded org's id.
    expect(mockUpdate).toHaveBeenCalledWith("org-1");
  });

  it("hides Rename from a caller without org.write", async () => {
    mockCurrent.mockReturnValue(
      loaded({ ...orgData, roles: ["member"], capabilities: memberCaps })
    );
    await openOrganizationTab();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("submits the new name, invalidates organizations.root and closes", async () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    await openOrganizationTab(queryClient);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(mockReset).toHaveBeenCalled();

    await userEvent.clear(renameField());
    await userEvent.type(renameField(), "Acme Industries{Enter}");

    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        { name: "Acme Industries" },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      )
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.organizations.root,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.auditLog.root,
    });
    await waitFor(() =>
      expect(screen.queryByText("Rename organization")).toBeNull()
    );
  });

  it("shows a refusal in the dialog's FormAlert and keeps the input", async () => {
    mockUpdate.mockReturnValue({
      mutate: jest.fn(),
      reset: mockReset,
      isPending: false,
      error: new ApiError(
        "You don't have permission to edit the organization.",
        "PERMISSION_DENIED",
        403
      ),
    });
    await openOrganizationTab();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "permission to edit the organization"
    );
    expect(renameField()).toHaveValue("Acme Corp");
  });
});
