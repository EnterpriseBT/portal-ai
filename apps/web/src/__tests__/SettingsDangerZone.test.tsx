import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockProfile = jest.fn();
const mockCurrent = jest.fn();
const mockUsage = jest.fn();
const mockDelete = jest.fn();
const mockLogout = jest.fn();
const mockMutate = jest.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  }
);

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auth: { profile: mockProfile, logout: () => ({ logout: mockLogout }) },
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
      delete: mockDelete,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
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
  "org.audit.read": true,
  "member.role.assign": true,
  "member.invite": true,
  "member.remove": true,
};
const memberCaps = {
  "billing.manage": false,
  "org.delete": false,
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
  mockDelete.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
  });
});

const openOrganizationTab = async () => {
  render(<SettingsView />);
  await userEvent.click(screen.getByRole("tab", { name: "Organization" }));
};

// ── Tests ────────────────────────────────────────────────────────────

describe("SettingsView — Danger zone (#197 slice 5)", () => {
  it("disables Delete for a non-owner (member) — #576 role gating", async () => {
    mockCurrent.mockReturnValue(
      loaded({ ...orgData, roles: ["member"], capabilities: memberCaps })
    );
    await openOrganizationTab();
    expect(
      screen.getByRole("button", { name: "Delete organization" })
    ).toBeDisabled();
  });

  it("renders the Danger zone and opens the delete dialog (case 25)", async () => {
    await openOrganizationTab();

    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    const openButton = screen.getByRole("button", {
      name: "Delete organization",
    });

    // The mutation hook is created against the loaded org's id.
    expect(mockDelete).toHaveBeenCalledWith("org-1");

    await userEvent.click(openButton);
    expect(screen.getByText("Delete Organization")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Type "Acme Corp" to confirm/)
    ).toBeInTheDocument();
  });

  it("submits the typed name and logs out on success (case 26)", async () => {
    await openOrganizationTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete organization" })
    );

    await userEvent.type(
      screen.getByLabelText(/Type "Acme Corp" to confirm/),
      "Acme Corp"
    );
    await userEvent.click(screen.getByTestId("confirm-delete-organization"));

    expect(mockMutate).toHaveBeenCalledWith(
      { confirmationName: "Acme Corp" },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    // The mock mutate invokes onSuccess synchronously → logout fires.
    expect(mockLogout).toHaveBeenCalled();
  });

  it("does not log out while the mutation has not succeeded (case 26)", async () => {
    mockMutate.mockImplementationOnce(() => undefined); // server rejected
    await openOrganizationTab();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete organization" })
    );
    await userEvent.type(
      screen.getByLabelText(/Type "Acme Corp" to confirm/),
      "Acme Corp"
    );
    await userEvent.click(screen.getByTestId("confirm-delete-organization"));

    expect(mockMutate).toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});

describe("SettingsView — Profile roles + groups (#620)", () => {
  it("lists the caller's roles as chips on the Profile tab", () => {
    render(<SettingsView />); // Profile is the default tab
    expect(screen.getByText("Your roles")).toBeInTheDocument();
    expect(screen.getByText("Your groups")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
  });

  it("shows member when the caller is a member", () => {
    mockCurrent.mockReturnValue(
      loaded({ ...orgData, roles: ["member"], capabilities: memberCaps })
    );
    render(<SettingsView />);
    expect(screen.getByText("Your roles")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("#622: lists the caller's groups as chips when they belong to any", () => {
    mockCurrent.mockReturnValue(
      loaded({ ...orgData, roles: ["member"], groups: ["West", "East"] })
    );
    render(<SettingsView />);
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.getByText("East")).toBeInTheDocument();
    expect(
      screen.queryByText(/don't belong to any groups/i)
    ).not.toBeInTheDocument();
  });

  it("#622: shows the empty-groups message when the caller has none", () => {
    render(<SettingsView />); // orgData has no groups
    expect(screen.getByText(/don't belong to any groups/i)).toBeInTheDocument();
  });
});
