import { User } from "@portalai/core/models";
import {
  OrganizationModelFactory,
  OrganizationUserModelFactory,
  ConnectorInstanceModelFactory,
  StationModelFactory,
  StationInstanceModelFactory,
  UserModelFactory,
} from "@portalai/core/models";
import { eq, and, isNull, sql } from "drizzle-orm";
import { organizationUsers } from "../db/schema/organization-users.table.js";
import { db } from "../db/client.js";
import { DbService } from "./db.service.js";
import { SeedService } from "./seed.service.js";
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

  /** Webhook path (Auth0 post-login, new user): create the user, then run
   *  the full provisioning transaction. Signature unchanged (#190 refactor). */
  static async setupOrganization(owner: User) {
    return DbService.transaction(async (tx) => {
      const createdUser = await DbService.repository.users
        .create(owner, tx)
        .catch((err) => {
          logger.error({ error: err }, "Database error creating user");
          throw new Error("Database error creating user");
        });

      const provisioned = await ApplicationService.provisionOrganizationInTx(
        createdUser.id,
        tx
      );
      return { user: createdUser, ...provisioned };
    });
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
  static async seedOrganization(opts: { name: string; memberEmail?: string }) {
    const systemId = SystemUtilities.id.system;

    const existing = await DbService.repository.organizations.findByName(
      opts.name
    );
    if (existing) {
      return {
        organizationId: existing.id,
        ownerUserId: existing.ownerUserId,
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
            lastLogin: 0,
          });
        await DbService.repository.organizationUsers.create(
          memberModel.parse(),
          tx
        );
        memberUserId = member.id;
      }

      return {
        organizationId: provisioned.organization.id,
        ownerUserId: owner.id,
        memberUserId,
        existing: false as const,
      };
    });
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
          lastLogin: SystemUtilities.utc.now().getTime(),
        });

      const createdOrgUser =
        await DbService.repository.organizationUsers.create(
          orgUserModel.parse(),
          tx
        );

      // ── System column definitions ────────────────────────────────────
      await new SeedService().seedSystemColumnDefinitions(createdOrg.id, tx);

      // ── Sandbox auto-provisioning ──────────────────────────────────
      const sandboxDef =
        await DbService.repository.connectorDefinitions.findBySlug(
          "sandbox",
          tx
        );

      if (!sandboxDef) {
        logger.warn(
          { organizationId: createdOrg.id },
          "Sandbox connector definition not found — skipping auto-provisioning"
        );
        return {
          organization: createdOrg,
          organizationUser: createdOrgUser,
        };
      }

      // Create connector instance — inherits capability flags from the
      // sandbox definition's ceiling.
      const instanceModel = new ConnectorInstanceModelFactory()
        .create(systemId)
        .update({
          connectorDefinitionId: sandboxDef.id,
          organizationId: createdOrg.id,
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
        organizationId: createdOrg.id,
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
        createdOrg.id,
        { defaultStationId: createdStation.id },
        tx
      );

      logger.info(
        {
          userId,
          organizationId: createdOrg.id,
          connectorInstanceId: createdInstance.id,
          stationId: createdStation.id,
        },
        "Sandbox auto-provisioning complete"
      );

      return {
        organization: { ...createdOrg, defaultStationId: createdStation.id },
        organizationUser: createdOrgUser,
      };
  }
}
