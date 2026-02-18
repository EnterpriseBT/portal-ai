import { User } from "@mcp-ui/core/models";
import {
  OrganizationModelFactory,
  OrganizationUserModelFactory,
} from "@mcp-ui/core/models";
import { DbService } from "./db.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "application" });

export class ApplicationService {
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
