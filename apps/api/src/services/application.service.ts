import { User } from "@mcp-ui/core/models";
import {
  OrganizationModelFactory,
  OrganizationUserModelFactory,
} from "@mcp-ui/core/models";
import { eq, desc, and, isNull } from "drizzle-orm";
import { organizationUsers } from "../db/schema/organization-users.table.js";
import { db } from "../db/client.js";
import { DbService } from "./db.service.js";
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
      .orderBy(desc(organizationUsers.lastLogin))
      .limit(1);

    if (!orgUser) {
      return null;
    }

    const organization = await DbService.repository.organizations.findById(
      orgUser.organizationId
    );

    return organization ? { organization, organizationUser: orgUser } : null;
  }

  static async setupOrganization(owner: User) {
    const systemId = SystemUtilities.id.system;

    return DbService.transaction(async (tx) => {
      // create new user
      const createdUser = await DbService.repository.users
        .create(owner, tx)
        .catch((err) => {
          logger.error({ error: err }, "Database error creating user");
          throw new Error("Database error creating user");
        });

      // create new org, use owner.id as ownerUserId and name organization '{owner}'s Organization'
      const orgModel = new OrganizationModelFactory().create(systemId).update({
        name: `My Organization`,
        timezone: SystemUtilities.timezone,
        ownerUserId: createdUser.id,
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
          userId: createdUser.id,
          lastLogin: SystemUtilities.utc.now().getTime(),
        });

      const createdOrgUser =
        await DbService.repository.organizationUsers.create(
          orgUserModel.parse(),
          tx
        );

      logger.info(
        {
          userId: createdUser.id,
          organizationId: createdOrg.id,
          organizationUserId: createdOrgUser.id,
        },
        "Organization setup complete"
      );

      return {
        user: createdUser,
        organization: createdOrg,
        organizationUser: createdOrgUser,
      };
    });
  }
}
