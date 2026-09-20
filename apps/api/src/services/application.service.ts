import {
  OrganizationModelFactory,
  OrganizationUserModelFactory,
  UserRoleModelFactory,
  ConnectorInstanceModelFactory,
  StationModelFactory,
  StationInstanceModelFactory,
  UserModelFactory,
} from "@portalai/core/models";
import { eq, and, isNull, desc, sql, type SQL } from "drizzle-orm";
import { organizationUsers } from "../db/schema/organization-users.table.js";
import { organizations } from "../db/schema/organizations.table.js";
import { users } from "../db/schema/users.table.js";
import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type {
  UserSelect,
  OrganizationSelect,
  OrganizationUserSelect,
} from "../db/schema/zod.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { SeedService } from "./seed.service.js";
import { AuditService } from "./audit.service.js";
import { SeatService } from "./seat.service.js";
import { SyncLockService } from "./sync-lock.service.js";
import type { ProvisioningFallback } from "../config/sso.config.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "application" });

export class ApplicationService {
  static async getCurrentOrganization(userId: string) {
    const [orgUser] = await db
      .select()
      .from(organizationUsers)
      .where(
        and(
          eq(organizationUsers.userId, userId),
          isNull(organizationUsers.deleted)
        )
      )
      // NULLS LAST: Postgres sorts NULLS FIRST under DESC, so a membership
      // with a null lastLogin would otherwise hijack the current-org pick
      // ahead of a real, stamped one. A null/never-entered membership must
      // never win. (#200)
      .orderBy(sql`${organizationUsers.lastLogin} DESC NULLS LAST`)
      .limit(1);

    if (!orgUser) {
      return null;
    }

    const organization = await DbService.repository.organizations.findById(
      orgUser.organizationId
    );

    return organization ? { organization, organizationUser: orgUser } : null;
  }

  /**
   * The authenticated user's live memberships, each flagged `isCurrent` if it
   * is the org `getCurrentOrganization` resolves. Both the membership and the
   * organization must be live. Ordered created-desc for a stable UI. (#201)
   */
  static async listUserMemberships(userId: string) {
    const rows = await db
      .select({ organization: organizations })
      .from(organizationUsers)
      .innerJoin(
        organizations,
        eq(organizationUsers.organizationId, organizations.id)
      )
      .where(
        and(
          eq(organizationUsers.userId, userId),
          isNull(organizationUsers.deleted),
          isNull(organizations.deleted)
        )
      )
      .orderBy(desc(organizations.created));

    // Flag against the exact row getCurrentOrganization would pick — single
    // source of truth, so the checkmark never disagrees with the served org.
    const current = await ApplicationService.getCurrentOrganization(userId);
    const currentId = current?.organization.id;

    return rows.map((r) => ({
      organization: r.organization,
      isCurrent: r.organization.id === currentId,
    }));
  }

  /**
   * Make `organizationId` the user's current org by bumping the membership's
   * `last_login` to now (the same mechanism as `portalai member switch`).
   * The requester must hold a LIVE membership in the target org — otherwise a
   * typed 403 (`MEMBERSHIP_NOT_FOUND`), the multi-tenancy authz gate. The
   * atomic `updateWhere` (soft-delete-filtered) both gates and bumps: an empty
   * result means no live membership. (#201)
   */
  static async switchOrganization(userId: string, organizationId: string) {
    const updated = await DbService.repository.organizationUsers.updateWhere(
      and(
        eq(organizationUsers.userId, userId),
        eq(organizationUsers.organizationId, organizationId)
      ) as SQL,
      { lastLogin: Date.now() }
    );

    if (updated.length === 0) {
      throw new ApiError(
        403,
        ApiCode.MEMBERSHIP_NOT_FOUND,
        `User is not a member of organization ${organizationId}`
      );
    }

    const organization =
      await DbService.repository.organizations.findById(organizationId);
    if (!organization) {
      throw new ApiError(
        404,
        ApiCode.ORGANIZATION_NOT_FOUND,
        `Organization ${organizationId} not found`
      );
    }

    return { organization, role: updated[0].role };
  }

  /**
   * First-login provisioning — the single idempotent, concurrency-safe path
   * shared by the Auth0 webhook (eager) and `getApplicationMetadata` (the
   * request-path self-heal). Find-or-create the user, then, under an advisory
   * lock keyed by the Auth0 sub, provision a personal owner-org **iff** the
   * user has no live membership. (#583)
   *
   * The unique index on `users.auth0_id` is the hard backstop against duplicate
   * users; the lock is what lets the loser of a first-login race observe the
   * winner's committed org and no-op instead of provisioning a second one.
   *
   * `resolveProfile` is lazy — invoked only when a user row must be created —
   * so the request-path caller pays the Auth0 profile fetch only on a genuine
   * first login, never on every request.
   *
   * This is the first-login *wrapper* (with a no-membership gate), NOT the
   * reusable provisioning core. A future in-UI "create another org" feature
   * calls `provisionOrganizationFor` directly, past this gate — keep the gate
   * here, out of the core.
   */
  static async ensureProvisioned(
    auth0Sub: string,
    resolveProfile: () => Promise<{
      email: string | null;
      name: string | null;
      picture: string | null;
      emailVerified: boolean;
    }>,
    auditCtx?: { sourceIp: string | null; userAgent: string | null },
    fallback: ProvisioningFallback = "personal_org"
  ): Promise<{
    user: UserSelect;
    organization: OrganizationSelect;
    organizationUser: OrganizationUserSelect;
    created: boolean;
  }> {
    return SyncLockService.withProvisioningLock(auth0Sub, async () => {
      // ── User (find-or-create) ──────────────────────────────────────
      let userRow = await DbService.repository.users.findByAuth0Id(auth0Sub);
      let profile: Awaited<ReturnType<typeof resolveProfile>> | null = null;
      if (!userRow) {
        profile = await resolveProfile();
        const model = new UserModelFactory()
          .create(SystemUtilities.id.system)
          .update({
            auth0Id: auth0Sub,
            email: profile.email,
            name: profile.name,
            picture: profile.picture,
            lastLogin: SystemUtilities.utc.now().getTime(),
          });
        const res = await DbService.repository.users.findOrCreateByAuth0Id(
          model.parse()
        );
        userRow = res.user;
      }
      const user = userRow;

      // ── Invited user? (#584) ───────────────────────────────────────
      // Only on a just-created user with a VERIFIED email: accept any pending
      // invitations for that email and join the invited org(s) instead of
      // provisioning a personal org ("invited user joins the invited org
      // only"). Existing-user-no-membership falls through to personal-org
      // provisioning unchanged (they accept via the token endpoint).
      if (profile?.emailVerified && profile.email) {
        const joined = await SeatService.acceptPendingForEmail(
          user,
          profile.email,
          auditCtx ?? { sourceIp: null, userAgent: null }
        );
        if (joined) {
          return {
            user,
            organization: joined.organization,
            organizationUser: joined.organizationUser,
            created: true,
          };
        }
      }

      // ── Org (provision iff no live membership) ─────────────────────
      const current = await ApplicationService.getCurrentOrganization(user.id);
      if (current) {
        return {
          user,
          organization: current.organization,
          organizationUser: current.organizationUser,
          created: false,
        };
      }

      // ── Fallback split by deploy mode (#577) ───────────────────────
      // No membership and no matched invitation: what happens next depends on
      // the mode the caller resolved.
      if (fallback === "deny") {
        // SaaS enterprise-federated identity with no invite — invite-gated, so
        // reject rather than provisioning a personal org (tenant isolation).
        throw new ApiError(
          403,
          ApiCode.SSO_PROVISIONING_NOT_INVITED,
          "This account is not a member of any organization and was not invited"
        );
      }
      if (fallback === "join_single_org") {
        // Self-hosted: join the one org tree as a member. The first user (no
        // org exists yet) falls through to provisioning below and becomes owner.
        const singleton = await ApplicationService.getSingletonOrganization();
        if (singleton) {
          const now = SystemUtilities.utc.now().getTime();
          const orgUser = await SeatService.attachMembership(
            user.id,
            singleton.id,
            "member",
            now
          );
          void AuditService.record({
            organizationId: singleton.id,
            userId: user.id,
            action: "auth.login",
            sourceIp: auditCtx?.sourceIp ?? null,
            userAgent: auditCtx?.userAgent ?? null,
            metadata: { firstLogin: true },
          });
          return {
            user,
            organization: singleton,
            organizationUser: orgUser,
            created: true,
          };
        }
      }

      const provisioned = await DbService.transaction((tx) =>
        ApplicationService.provisionOrganizationInTx(user.id, tx)
      );

      // ── Audit (only on a fresh provision; post-commit, fail-open) ──
      // Lifted from the webhook so both entry points audit identically.
      void AuditService.record({
        organizationId: provisioned.organization.id,
        userId: user.id,
        action: "org.create",
        targetType: "organization",
        targetId: provisioned.organization.id,
        sourceIp: auditCtx?.sourceIp ?? null,
        userAgent: auditCtx?.userAgent ?? null,
      });
      void AuditService.record({
        organizationId: provisioned.organization.id,
        userId: user.id,
        action: "auth.login",
        sourceIp: auditCtx?.sourceIp ?? null,
        userAgent: auditCtx?.userAgent ?? null,
        metadata: { firstLogin: true },
      });

      return {
        user,
        organization: provisioned.organization,
        organizationUser: provisioned.organizationUser,
        created: true,
      };
    });
  }

  /**
   * The single org tree of a self-hosted install (#577). Returns the earliest
   * non-deleted organization, or null when none exists yet (the first user is
   * about to provision it and become its owner).
   */
  static async getSingletonOrganization(): Promise<OrganizationSelect | null> {
    const rows = await db
      .select()
      .from(organizations)
      .where(isNull(organizations.deleted))
      .orderBy(organizations.created)
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Re-homed per-login side-effects (#577). The Auth0 webhook used to refresh
   * the profile and emit an `auth.login` audit row on every login; with the
   * webhook removed, the request path does it — deduped by a login-session
   * marker (auth_time → sid → iat) so neither a token refresh mid-session nor
   * the burst of parallel API calls a single login fires (dashboard load)
   * emits more than one row.
   *
   * The dedup is an **atomic conditional UPDATE**, not a read-then-write: the
   * one request that flips `last_login_session` to this marker wins and emits
   * the login; concurrent siblings match 0 rows and return. Only the winner
   * fetches the profile, so a login costs at most one `userinfo` call. Best-
   * effort — a failure logs and returns, never breaking the request. Callers
   * fire-and-forget (`void`).
   */
  static async recordLoginIfNewSession(
    user: UserSelect,
    organizationId: string,
    organizationUser: OrganizationUserSelect,
    sessionMarker: string | null,
    resolveProfile: () => Promise<{
      email: string | null;
      name: string | null;
      picture: string | null;
      emailVerified: boolean;
    }>,
    auditCtx: { sourceIp: string | null; userAgent: string | null }
  ): Promise<void> {
    // Cheap early-out for the common case (same session as last seen). The
    // atomic update below is the real guard — `user` here can be stale.
    if (!sessionMarker || sessionMarker === user.lastLoginSession) return;
    try {
      const now = SystemUtilities.utc.now().getTime();
      // Claim the new session atomically. `IS DISTINCT FROM` (not `<>`) so a
      // NULL prior value counts as a change (the first login after deploy).
      const won = await DbService.repository.users.updateWhere(
        and(
          eq(users.id, user.id),
          sql`${users.lastLoginSession} IS DISTINCT FROM ${sessionMarker}`
        ) as SQL,
        { lastLogin: now, lastLoginSession: sessionMarker }
      );
      if (won.length === 0) return; // a concurrent request already recorded it

      // Winner only: refresh the profile + emit exactly one auth.login.
      const profile = await resolveProfile().catch(() => null);
      if (profile) {
        await DbService.repository.users.update(user.id, {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
        });
      }
      await DbService.repository.organizationUsers.update(organizationUser.id, {
        lastLogin: now,
      });
      void AuditService.record({
        organizationId,
        userId: user.id,
        action: "auth.login",
        sourceIp: auditCtx.sourceIp,
        userAgent: auditCtx.userAgent,
      });
    } catch (error) {
      logger.warn(
        {
          userId: user.id,
          error: error instanceof Error ? error.message : "unknown",
        },
        "recordLoginIfNewSession failed (non-fatal)"
      );
    }
  }

  /** Provision a full organization for an EXISTING user (#190 — the
   *  portalai CLI's `org create` / `seed org` path). Same transaction body
   *  the webhook uses: org + owner membership + system column definitions +
   *  sandbox instance + default station/toolpack/link + defaultStationId. */
  static async provisionOrganizationFor(
    userId: string,
    opts: { name?: string } = {}
  ) {
    return DbService.transaction(async (tx) =>
      ApplicationService.provisionOrganizationInTx(userId, tx, opts)
    );
  }

  /** CLI seam (#190): resolve an existing user by email, then provision. */
  static async createOrganizationForEmail(email: string, name: string) {
    const user = await DbService.repository.users.findByEmail(email);
    if (!user) {
      throw new Error(`User ${email} not found — users originate in Auth0`);
    }
    return ApplicationService.provisionOrganizationFor(user.id, { name });
  }

  /** CLI seam (#190): idempotent-by-name org fixture with a synthetic owner
   *  (auth0Id "seed|<id>"), optionally adding a real user as a member so the
   *  org is enterable from the app. */
  static async seedOrganization(opts: {
    name: string;
    memberEmail?: string;
    /** Assign this tier slug to the org (idempotent — applied whether the org
     *  is freshly seeded or already exists). Validated against live tiers; a
     *  seeded org has no Stripe subscription, so no desync guard is needed. */
    tier?: string;
  }) {
    const systemId = SystemUtilities.id.system;

    const existing = await DbService.repository.organizations.findByName(
      opts.name
    );
    if (existing) {
      if (opts.tier)
        await ApplicationService.assignOrgTier(existing.id, opts.tier);
      return {
        organizationId: existing.id,
        ownerUserId: existing.ownerUserId,
        tier: opts.tier,
        existing: true as const,
      };
    }

    const member = opts.memberEmail
      ? await DbService.repository.users.findByEmail(opts.memberEmail)
      : null;
    if (opts.memberEmail && !member) {
      throw new Error(`User ${opts.memberEmail} not found`);
    }

    return DbService.transaction(async (tx) => {
      const slug = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const ownerModel = new UserModelFactory().create(systemId).update({
        auth0Id: `seed|${SystemUtilities.id.v4.generate()}`,
        email: `seed+${slug}@portalsai.io`,
        name: `${opts.name} Owner`,
        picture: null,
        lastLogin: null,
      });
      const owner = await DbService.repository.users.create(
        ownerModel.parse(),
        tx
      );

      const provisioned = await ApplicationService.provisionOrganizationInTx(
        owner.id,
        tx,
        { name: opts.name }
      );

      let memberUserId: string | undefined;
      if (member) {
        // lastLogin: 0 (not null) so this membership doesn't hijack the
        // member's current-org selector — the app orders `last_login DESC`
        // and Postgres sorts NULLS FIRST. The user stays in their real org
        // until they `portalai member switch` into this seeded one.
        const memberModel = new OrganizationUserModelFactory()
          .create(systemId)
          .update({
            organizationId: provisioned.organization.id,
            userId: member.id,
            role: "member",
            lastLogin: 0,
          });
        await DbService.repository.organizationUsers.create(
          memberModel.parse(),
          tx
        );
        // #620: the membership's role lives in user_role (enum is a mirror).
        await DbService.repository.userRole.assign(
          member.id,
          provisioned.organization.id,
          "member",
          systemId,
          tx
        );
        memberUserId = member.id;
      }

      if (opts.tier)
        await ApplicationService.assignOrgTier(
          provisioned.organization.id,
          opts.tier,
          tx
        );

      return {
        organizationId: provisioned.organization.id,
        ownerUserId: owner.id,
        memberUserId,
        tier: opts.tier,
        existing: false as const,
      };
    });
  }

  /** Assign a tier slug to an org (seed seam). Validates the slug against live
   *  tiers so a typo fails loudly instead of tripping the FK; skips the Stripe
   *  desync guard that `portalai org set-tier` enforces because a seeded org
   *  never has a subscription. */
  private static async assignOrgTier(
    organizationId: string,
    tier: string,
    client?: DbClient
  ): Promise<void> {
    const row = await DbService.repository.tiers.findBySlug(tier, client);
    if (!row) {
      throw new Error(
        `Tier "${tier}" not found — run \`portalops tier apply\` / \`tier create\` first`
      );
    }
    await DbService.repository.organizations.update(
      organizationId,
      { tier },
      client
    );
  }

  /** The provisioning transaction body — shared by the webhook and CLI paths. */
  private static async provisionOrganizationInTx(
    userId: string,
    tx: Parameters<Parameters<typeof DbService.transaction>[0]>[0],
    opts: { name?: string } = {}
  ) {
    const systemId = SystemUtilities.id.system;

    const orgModel = new OrganizationModelFactory().create(systemId).update({
      name: opts.name ?? `My Organization`,
      timezone: SystemUtilities.timezone,
      ownerUserId: userId,
    });

    const createdOrg = await DbService.repository.organizations.create(
      orgModel.parse(),
      tx
    );

    // link user to org as owner via organization_users table
    const orgUserModel = new OrganizationUserModelFactory()
      .create(systemId)
      .update({
        organizationId: createdOrg.id,
        userId,
        role: "owner",
        lastLogin: SystemUtilities.utc.now().getTime(),
      });

    const createdOrgUser = await DbService.repository.organizationUsers.create(
      orgUserModel.parse(),
      tx
    );

    const { stationId } =
      await ApplicationService.provisionOrganizationWorkspace(
        createdOrg.id,
        tx
      );

    // #620: assign the owner their role via the user_role join (the seeded
    // roles were created by provisionOrganizationWorkspace above). Deterministic
    // id matches the enum→user_role backfill so the two paths never collide.
    await DbService.repository.userRole.create(
      new UserRoleModelFactory()
        .create(systemId)
        .update({
          id: `sysur:${userId}:${createdOrg.id}:owner`,
          userId,
          organizationId: createdOrg.id,
          roleId: `sysrole:${createdOrg.id}:owner`,
        })
        .parse(),
      tx
    );

    return {
      organization: { ...createdOrg, defaultStationId: stationId },
      organizationUser: createdOrgUser,
    };
  }

  /**
   * The scaffolding every organization gets: system column definitions, a
   * Sandbox connector instance, a default station wired to it, and the
   * station's default toolpack.
   *
   * Extracted from provisioning (#295) because `ResetService` re-runs it
   * after its cascade — a reset org must be indistinguishable from a fresh
   * one, and hand-copying these steps into reset is how they drift. Safe to
   * re-run: `seedSystemColumnDefinitions` upserts by key, and reset has
   * already deleted the station/instance rows this recreates.
   *
   * Returns the new station id, or null when the `sandbox` connector
   * definition is missing (an unseeded database — warn and carry on).
   */
  static async provisionOrganizationWorkspace(
    organizationId: string,
    tx: Parameters<Parameters<typeof DbService.transaction>[0]>[0]
  ): Promise<{ stationId: string | null }> {
    const systemId = SystemUtilities.id.system;

    // ── System column definitions ────────────────────────────────────
    await new SeedService().seedSystemColumnDefinitions(organizationId, tx);

    // ── RBAC system roles + policies (#598) ──────────────────────────
    // The data-driven equivalent of #576's role switch. Existing orgs get
    // these from the paired backfill migration; this covers new orgs + reset.
    await new SeedService().seedRbacSystemPolicies(organizationId, tx);

    // ── Sandbox auto-provisioning ──────────────────────────────────
    const sandboxDef =
      await DbService.repository.connectorDefinitions.findBySlug("sandbox", tx);

    if (!sandboxDef) {
      logger.warn(
        { organizationId },
        "Sandbox connector definition not found — skipping auto-provisioning"
      );
      return { stationId: null };
    }

    // Create connector instance — inherits capability flags from the
    // sandbox definition's ceiling.
    const instanceModel = new ConnectorInstanceModelFactory()
      .create(systemId)
      .update({
        connectorDefinitionId: sandboxDef.id,
        organizationId,
        name: "Sandbox",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: { ...sandboxDef.capabilityFlags },
      });

    const createdInstance =
      await DbService.repository.connectorInstances.create(
        instanceModel.parse(),
        tx
      );

    // Create default station
    const stationModel = new StationModelFactory().create(systemId).update({
      organizationId,
      name: "My Station",
      description: "Default organization sandbox station",
    });

    const createdStation = await DbService.repository.stations.create(
      stationModel.parse(),
      tx
    );

    // Seed the default toolpack for the new station.
    await DbService.repository.stationToolpacks.replaceForStation(
      createdStation.id,
      { builtinSlugs: ["data_query"] },
      { userId: systemId },
      tx
    );

    // Link via station_instances
    const stationInstanceModel = new StationInstanceModelFactory()
      .create(systemId)
      .update({
        stationId: createdStation.id,
        connectorInstanceId: createdInstance.id,
      });

    await DbService.repository.stationInstances.create(
      stationInstanceModel.parse(),
      tx
    );

    // Set defaultStationId on organization
    await DbService.repository.organizations.update(
      organizationId,
      { defaultStationId: createdStation.id },
      tx
    );

    logger.info(
      {
        organizationId,
        connectorInstanceId: createdInstance.id,
        stationId: createdStation.id,
      },
      "Sandbox auto-provisioning complete"
    );

    return { stationId: createdStation.id };
  }
}
