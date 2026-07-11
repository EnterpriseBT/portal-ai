import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks (module-load side effects + repositories) ──────────────────

jest.unstable_mockModule("../../db/client.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) },
  closeDatabase: async () => {},
}));

const repos = {
  users: {
    create: jest.fn<(row: { id: string }, tx: unknown) => Promise<{ id: string }>>(),
    findByEmail: jest.fn<(email: string) => Promise<{ id: string } | null>>(),
  },
  organizations: {
    create: jest.fn<(row: Record<string, unknown>, tx: unknown) => Promise<Record<string, unknown>>>(),
    update: jest.fn<() => Promise<unknown>>(),
    findByName: jest.fn<(name: string) => Promise<{ id: string; ownerUserId: string } | null>>(),
  },
  organizationUsers: {
    create: jest.fn<(row: Record<string, unknown>, tx: unknown) => Promise<Record<string, unknown>>>(),
  },
  connectorDefinitions: {
    findBySlug: jest.fn<() => Promise<{ id: string; capabilityFlags: Record<string, boolean> } | null>>(),
  },
  connectorInstances: {
    create: jest.fn<(row: Record<string, unknown>, tx: unknown) => Promise<{ id: string }>>(),
  },
  stations: {
    create: jest.fn<(row: Record<string, unknown>, tx: unknown) => Promise<{ id: string }>>(),
  },
  stationToolpacks: {
    replaceForStation: jest.fn<() => Promise<void>>(),
  },
  stationInstances: {
    create: jest.fn<(row: Record<string, unknown>, tx: unknown) => Promise<unknown>>(),
  },
};
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: repos,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn("TX"),
  },
}));

const mockSeedCols = jest.fn<(orgId: string, tx: unknown) => Promise<void>>();
jest.unstable_mockModule("../../services/seed.service.js", () => ({
  SeedService: class {
    seedSystemColumnDefinitions = mockSeedCols;
  },
}));

const { ApplicationService } = await import(
  "../../services/application.service.js"
);

// ── Fixtures ─────────────────────────────────────────────────────────

const SANDBOX = { id: "def-sandbox", capabilityFlags: { read: true, write: true } };

const wireHappyPath = () => {
  repos.users.create.mockImplementation(async (row) => ({ ...row, id: row.id ?? "u-new" }));
  repos.organizations.create.mockImplementation(async (row) => ({ ...row }));
  repos.organizationUsers.create.mockImplementation(async (row) => ({ ...row }));
  repos.connectorDefinitions.findBySlug.mockResolvedValue(SANDBOX);
  repos.connectorInstances.create.mockImplementation(async () => ({ id: "ci-1" }));
  repos.stations.create.mockImplementation(async () => ({ id: "st-1" }));
  repos.stationToolpacks.replaceForStation.mockResolvedValue(undefined);
  repos.stationInstances.create.mockResolvedValue({});
  repos.organizations.update.mockResolvedValue({});
  mockSeedCols.mockResolvedValue(undefined);
};

beforeEach(() => {
  for (const group of Object.values(repos)) {
    for (const fn of Object.values(group)) (fn as jest.Mock).mockReset();
  }
  mockSeedCols.mockReset();
  wireHappyPath();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("provisionOrganizationFor (the shared transaction body)", () => {
  it("provisions the FULL set for an existing user: org, membership, column defs, sandbox, station, toolpack, link, defaultStationId", async () => {
    const out = await ApplicationService.provisionOrganizationFor("u-77", {
      name: "Acme",
    });

    const org = repos.organizations.create.mock.calls[0][0];
    expect(org).toMatchObject({ name: "Acme", ownerUserId: "u-77", tier: "standard" });
    expect(org.id).toBeTruthy(); // factory-minted

    const membership = repos.organizationUsers.create.mock.calls[0][0];
    expect(membership).toMatchObject({ organizationId: org.id, userId: "u-77" });

    expect(mockSeedCols).toHaveBeenCalledWith(org.id, "TX");
    expect(repos.connectorInstances.create.mock.calls[0][0]).toMatchObject({
      connectorDefinitionId: "def-sandbox",
      organizationId: org.id,
      name: "Sandbox",
    });
    expect(repos.stations.create.mock.calls[0][0]).toMatchObject({
      organizationId: org.id,
      name: "My Station",
    });
    expect(repos.stationToolpacks.replaceForStation).toHaveBeenCalledWith(
      "st-1",
      { builtinSlugs: ["data_query"] },
      expect.anything(),
      "TX"
    );
    expect(repos.stationInstances.create.mock.calls[0][0]).toMatchObject({
      stationId: "st-1",
      connectorInstanceId: "ci-1",
    });
    expect(repos.organizations.update).toHaveBeenCalledWith(
      org.id,
      { defaultStationId: "st-1" },
      "TX"
    );
    expect(out.organization.defaultStationId).toBe("st-1");
    // No user was created — the owner already existed.
    expect(repos.users.create).not.toHaveBeenCalled();
  });

  it("missing sandbox definition → early return, still org + membership + column defs", async () => {
    repos.connectorDefinitions.findBySlug.mockResolvedValue(null);
    const out = await ApplicationService.provisionOrganizationFor("u-77");
    expect(repos.organizations.create).toHaveBeenCalled();
    expect(mockSeedCols).toHaveBeenCalled();
    expect(repos.stations.create).not.toHaveBeenCalled();
    expect(out.organization).toBeDefined();
  });
});

describe("setupOrganization (webhook parity)", () => {
  it("creates the user FIRST, then runs the same provisioning; returns { user, organization, organizationUser }", async () => {
    const owner = { id: "u-hook", auth0Id: "google-oauth2|1", email: "x@y.z" };
    const out = await ApplicationService.setupOrganization(owner as never);
    expect(repos.users.create).toHaveBeenCalledWith(owner, "TX");
    expect(out.user.id).toBe("u-hook");
    expect(out.organization).toBeDefined();
    expect(out.organizationUser).toBeDefined();
    expect(repos.organizations.create.mock.calls[0][0]).toMatchObject({
      name: "My Organization",
      ownerUserId: "u-hook",
    });
  });
});

describe("createOrganizationForEmail", () => {
  it("unknown email → throws (users originate in Auth0)", async () => {
    repos.users.findByEmail.mockResolvedValue(null);
    await expect(
      ApplicationService.createOrganizationForEmail("nobody@x.io", "Acme")
    ).rejects.toThrow(/not found/);
    expect(repos.organizations.create).not.toHaveBeenCalled();
  });

  it("known email → provisions with the given name", async () => {
    repos.users.findByEmail.mockResolvedValue({ id: "u-ben" });
    await ApplicationService.createOrganizationForEmail("ben@portalsai.io", "Acme");
    expect(repos.organizations.create.mock.calls[0][0]).toMatchObject({
      name: "Acme",
      ownerUserId: "u-ben",
    });
  });
});

describe("seedOrganization", () => {
  it("idempotent: a live org with the name short-circuits without creating anything", async () => {
    repos.organizations.findByName.mockResolvedValue({ id: "o-1", ownerUserId: "u-o" });
    const out = await ApplicationService.seedOrganization({ name: "QA Org" });
    expect(out).toEqual({ organizationId: "o-1", ownerUserId: "u-o", existing: true });
    expect(repos.users.create).not.toHaveBeenCalled();
    expect(repos.organizations.create).not.toHaveBeenCalled();
  });

  it("creates a synthetic owner (seed|…) then provisions; --member-email adds the real user", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.users.findByEmail.mockResolvedValue({ id: "u-ben" });

    const out = await ApplicationService.seedOrganization({
      name: "QA Org",
      memberEmail: "ben@portalsai.io",
    });

    const owner = repos.users.create.mock.calls[0][0] as Record<string, string>;
    expect(owner.auth0Id).toMatch(/^seed\|/);
    expect(owner.email).toBe("seed+qa-org@portalsai.io");

    expect(repos.organizations.create.mock.calls[0][0]).toMatchObject({ name: "QA Org" });
    // second membership row = the real member (first is the owner's)
    const memberships = repos.organizationUsers.create.mock.calls.map((c) => c[0]);
    expect(memberships).toHaveLength(2);
    expect(memberships[1]).toMatchObject({ userId: "u-ben" });
    expect(out.existing).toBe(false);
    if (out.existing === false) {
      expect(out.memberUserId).toBe("u-ben");
    }
  });

  it("unknown --member-email → throws before any creation", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.users.findByEmail.mockResolvedValue(null);
    await expect(
      ApplicationService.seedOrganization({ name: "QA", memberEmail: "no@x.io" })
    ).rejects.toThrow(/not found/);
    expect(repos.users.create).not.toHaveBeenCalled();
  });
});
