import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks (module-load side effects + repositories) ──────────────────

jest.unstable_mockModule("../../db/client.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
  },
  closeDatabase: async () => {},
  // Pulled in transitively via SyncLockService (application.service imports it
  // for ensureProvisioned). This unit suite doesn't exercise the lock, so a
  // stub that just satisfies the import binding is enough.
  reserveConnection: async () => ({
    unsafe: async () => [{ locked: true }],
    release: () => {},
  }),
}));

const repos = {
  users: {
    create:
      jest.fn<(row: { id: string }, tx: unknown) => Promise<{ id: string }>>(),
    findByEmail: jest.fn<(email: string) => Promise<{ id: string } | null>>(),
  },
  organizations: {
    create:
      jest.fn<
        (
          row: Record<string, unknown>,
          tx: unknown
        ) => Promise<Record<string, unknown>>
      >(),
    update: jest.fn<() => Promise<unknown>>(),
    findById:
      jest.fn<(id: string, tx?: unknown) => Promise<Record<string, unknown>>>(),
    findByName:
      jest.fn<
        (name: string) => Promise<{ id: string; ownerUserId: string } | null>
      >(),
  },
  tiers: {
    findBySlug:
      jest.fn<
        (slug: string, client?: unknown) => Promise<{ slug: string } | null>
      >(),
  },
  organizationUsers: {
    create:
      jest.fn<
        (
          row: Record<string, unknown>,
          tx: unknown
        ) => Promise<Record<string, unknown>>
      >(),
    // #620: seedOrganization.ensureMembership upserts (looks up first).
    findByOrganizationAndUser:
      jest.fn<
        (orgId: string, userId: string) => Promise<unknown | undefined>
      >(),
    update: jest.fn<() => Promise<unknown>>(),
  },
  // #620: provisioning writes the owner's role via the user_role join.
  userRole: {
    create:
      jest.fn<
        (row: Record<string, unknown>, tx: unknown) => Promise<unknown>
      >(),
    assign:
      jest.fn<
        (
          userId: string,
          orgId: string,
          role: string,
          actor: string,
          tx?: unknown
        ) => Promise<void>
      >(),
  },
  connectorDefinitions: {
    findBySlug: jest.fn<
      () => Promise<{
        id: string;
        capabilityFlags: Record<string, boolean>;
      } | null>
    >(),
  },
  connectorInstances: {
    create:
      jest.fn<
        (row: Record<string, unknown>, tx: unknown) => Promise<{ id: string }>
      >(),
  },
  stations: {
    create:
      jest.fn<
        (row: Record<string, unknown>, tx: unknown) => Promise<{ id: string }>
      >(),
  },
  stationToolpacks: {
    replaceForStation: jest.fn<() => Promise<void>>(),
  },
  stationInstances: {
    create:
      jest.fn<
        (row: Record<string, unknown>, tx: unknown) => Promise<unknown>
      >(),
  },
};
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: repos,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn("TX"),
  },
}));

const mockSeedCols = jest.fn<(orgId: string, tx: unknown) => Promise<void>>();
const mockSeedRbac = jest.fn<(orgId: string, tx: unknown) => Promise<void>>();
jest.unstable_mockModule("../../services/seed.service.js", () => ({
  SeedService: class {
    seedSystemColumnDefinitions = mockSeedCols;
    seedRbacSystemPolicies = mockSeedRbac;
  },
}));

const { ApplicationService } =
  await import("../../services/application.service.js");
const { PROVISIONED_STATIONS } =
  await import("../../constants/provisioned-stations.constants.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");
const { SystemUtilities } = await import("../../utils/system.util.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const SANDBOX = {
  id: "def-sandbox",
  capabilityFlags: { read: true, write: true },
};

const wireHappyPath = () => {
  repos.users.create.mockImplementation(async (row) => ({
    ...row,
    id: row.id ?? "u-new",
  }));
  repos.organizations.create.mockImplementation(async (row) => ({ ...row }));
  repos.organizationUsers.create.mockImplementation(async (row) => ({
    ...row,
  }));
  repos.connectorDefinitions.findBySlug.mockResolvedValue(SANDBOX);
  repos.connectorInstances.create.mockImplementation(async () => ({
    id: "ci-1",
  }));
  // One id per provisioned station, in creation order.
  let stationSeq = 0;
  repos.stations.create.mockImplementation(async () => ({
    id: `st-${++stationSeq}`,
  }));
  // The org as stored once provisioning is done.
  repos.organizations.findById.mockImplementation(async (id) => ({
    ...(repos.organizations.create.mock.calls[0]?.[0] ?? {}),
    id,
  }));
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
  it("provisions the FULL set for an existing user: org, membership, column defs, sandbox, both stations, their packs and the sandbox link, and no default station (#848, #1114)", async () => {
    await ApplicationService.provisionOrganizationFor("u-77", {
      name: "Acme",
    });

    const org = repos.organizations.create.mock.calls[0][0];
    expect(org).toMatchObject({
      name: "Acme",
      ownerUserId: "u-77",
      tier: "standard",
    });
    expect(org.id).toBeTruthy(); // factory-minted

    const membership = repos.organizationUsers.create.mock.calls[0][0];
    expect(membership).toMatchObject({
      organizationId: org.id,
      userId: "u-77",
    });

    expect(mockSeedCols).toHaveBeenCalledWith(org.id, "TX");

    // One Sandbox instance, shared by whichever stations attach it.
    expect(repos.connectorInstances.create).toHaveBeenCalledTimes(1);
    expect(repos.connectorInstances.create.mock.calls[0][0]).toMatchObject({
      connectorDefinitionId: "def-sandbox",
      organizationId: org.id,
      name: "Sandbox",
    });

    // One station per PROVISIONED_STATIONS entry, system-owned, in order.
    expect(repos.stations.create).toHaveBeenCalledTimes(
      PROVISIONED_STATIONS.length
    );
    PROVISIONED_STATIONS.forEach((expected, i) => {
      expect(repos.stations.create.mock.calls[i][0]).toMatchObject({
        organizationId: org.id,
        name: expected.name,
        description: expected.description,
        createdBy: SystemUtilities.id.system,
      });
      expect(repos.stationToolpacks.replaceForStation).toHaveBeenCalledWith(
        `st-${i + 1}`,
        { builtinSlugs: [...expected.builtinSlugs] },
        { userId: SystemUtilities.id.system },
        "TX"
      );
    });
    expect(repos.stationToolpacks.replaceForStation).toHaveBeenCalledTimes(
      PROVISIONED_STATIONS.length
    );

    // The Sandbox is linked only to the station that asks for it (Playground).
    expect(repos.stationInstances.create).toHaveBeenCalledTimes(1);
    expect(repos.stationInstances.create.mock.calls[0][0]).toMatchObject({
      stationId: "st-2",
      connectorInstanceId: "ci-1",
    });

    // #1114: provisioning writes no default station.
    for (const call of repos.organizations.update.mock.calls as unknown[][]) {
      expect(call[1]).not.toHaveProperty("defaultStationId");
    }
    // The returned org is the stored row, re-read after provisioning.
    expect(repos.organizations.findById).toHaveBeenCalledWith(org.id, "TX");
    // No user was created — the owner already existed.
    expect(repos.users.create).not.toHaveBeenCalled();
  });

  it("provisionOrganizationWorkspace resolves to nothing (#848)", async () => {
    await expect(
      ApplicationService.provisionOrganizationWorkspace("org-9", "TX" as never)
    ).resolves.toBeUndefined();
  });

  it("missing sandbox definition → throws and creates no instance, station or link (#848)", async () => {
    repos.connectorDefinitions.findBySlug.mockResolvedValue(null);
    await expect(
      ApplicationService.provisionOrganizationFor("u-77")
    ).rejects.toMatchObject({
      status: 500,
      code: ApiCode.ORGANIZATION_PROVISIONING_FAILED,
    });
    expect(repos.connectorInstances.create).not.toHaveBeenCalled();
    expect(repos.stations.create).not.toHaveBeenCalled();
    expect(repos.stationToolpacks.replaceForStation).not.toHaveBeenCalled();
    expect(repos.stationInstances.create).not.toHaveBeenCalled();
    expect(repos.organizations.update).not.toHaveBeenCalled();
  });
});

// The former `setupOrganization` (create-user + provision) is removed (#583);
// its create-then-provision behavior now lives in `ensureProvisioned` and is
// covered by the ensureProvisioned integration tests, which exercise the real
// advisory lock + find-or-create against Postgres (not mockable meaningfully
// here). This unit suite keeps its coverage of the provisioning core below.

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
    await ApplicationService.createOrganizationForEmail(
      "ben@portalsai.io",
      "Acme"
    );
    expect(repos.organizations.create.mock.calls[0][0]).toMatchObject({
      name: "Acme",
      ownerUserId: "u-ben",
    });
  });
});

describe("seedOrganization", () => {
  it("idempotent: a live org with the name short-circuits without creating anything", async () => {
    repos.organizations.findByName.mockResolvedValue({
      id: "o-1",
      ownerUserId: "u-o",
    });
    const out = await ApplicationService.seedOrganization({ name: "QA Org" });
    expect(out).toEqual({
      organizationId: "o-1",
      ownerUserId: "u-o",
      existing: true,
    });
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

    expect(repos.organizations.create.mock.calls[0][0]).toMatchObject({
      name: "QA Org",
    });
    // second membership row = the real member (first is the owner's)
    const memberships = repos.organizationUsers.create.mock.calls.map(
      (c) => c[0]
    );
    expect(memberships).toHaveLength(2);
    expect(memberships[1]).toMatchObject({ userId: "u-ben" });
    expect(out.existing).toBe(false);
    if (out.existing === false) {
      expect(out.memberUserId).toBe("u-ben");
    }
  });

  it("owner-email uses a real owner; admin/member-email add real users with those roles (#620)", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.users.findByEmail.mockImplementation(
      async (email: string) =>
        ({
          "owner@portalsai.io": { id: "u-owner" },
          "admin@portalsai.io": { id: "u-admin" },
          "member@portalsai.io": { id: "u-member" },
        })[email] ?? null
    );
    repos.organizationUsers.findByOrganizationAndUser.mockResolvedValue(
      undefined
    );

    const out = await ApplicationService.seedOrganization({
      name: "QA Org",
      ownerEmail: "owner@portalsai.io",
      adminEmail: "admin@portalsai.io",
      memberEmail: "member@portalsai.io",
    });

    // No synthetic owner is minted when a real owner-email is given.
    expect(repos.users.create).not.toHaveBeenCalled();
    // The org is provisioned under the real owner.
    expect(out.existing).toBe(false);
    if (out.existing === false) {
      expect(out.ownerUserId).toBe("u-owner");
      expect(out.adminUserId).toBe("u-admin");
      expect(out.memberUserId).toBe("u-member");
    }
    // Each role is written to user_role with its role name.
    const assigns = (
      repos.userRole.assign.mock.calls as unknown as unknown[][]
    ).map((c) => ({ userId: c[0], role: c[2] }));
    expect(assigns).toEqual(
      expect.arrayContaining([
        { userId: "u-admin", role: "admin" },
        { userId: "u-member", role: "member" },
      ])
    );
  });

  it("unknown --member-email → throws before any creation", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.users.findByEmail.mockResolvedValue(null);
    await expect(
      ApplicationService.seedOrganization({
        name: "QA",
        memberEmail: "no@x.io",
      })
    ).rejects.toThrow(/not found/);
    expect(repos.users.create).not.toHaveBeenCalled();
  });

  it("--tier assigns the tier to a freshly-seeded org after validating the slug (#537)", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.tiers.findBySlug.mockResolvedValue({ slug: "demo" });

    const out = await ApplicationService.seedOrganization({
      name: "QA Org",
      tier: "demo",
    });

    expect(repos.tiers.findBySlug).toHaveBeenCalledWith(
      "demo",
      expect.anything()
    );
    // organizations.update({ tier }) on the provisioned org id
    const tierUpdate = (
      repos.organizations.update.mock.calls as unknown as unknown[][]
    ).find((c) => (c[1] as { tier?: string } | undefined)?.tier === "demo");
    expect(tierUpdate).toBeDefined();
    expect(out.existing).toBe(false);
    if (out.existing === false) expect(out.tier).toBe("demo");
  });

  it("--tier on an EXISTING org is applied idempotently (#537)", async () => {
    repos.organizations.findByName.mockResolvedValue({
      id: "o-1",
      ownerUserId: "u-o",
    });
    repos.tiers.findBySlug.mockResolvedValue({ slug: "demo" });

    const out = await ApplicationService.seedOrganization({
      name: "QA Org",
      tier: "demo",
    });

    expect(repos.organizations.update).toHaveBeenCalledWith(
      "o-1",
      { tier: "demo" },
      undefined
    );
    expect(out).toMatchObject({
      organizationId: "o-1",
      tier: "demo",
      existing: true,
    });
  });

  it("--tier with an unknown slug throws and never touches the org (#537)", async () => {
    repos.organizations.findByName.mockResolvedValue(null);
    repos.tiers.findBySlug.mockResolvedValue(null);

    await expect(
      ApplicationService.seedOrganization({ name: "QA Org", tier: "nope" })
    ).rejects.toThrow(/Tier "nope" not found/);
  });
});
