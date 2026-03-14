import type {
  Auth0PostLoginWebhookPayload,
  Auth0PostLoginWebhookSyncResponse,
} from "@portalai/core/contracts";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";
import { UserModel, UserModelFactory } from "@portalai/core/models";
import { SystemUtilities } from "../utils/system.util.js";
import { ApplicationService } from "./application.service.js";

const logger = createLogger({ module: "webhook" });

export class WebhookService {
  static async syncUser(
    payload: Auth0PostLoginWebhookPayload
  ): Promise<Auth0PostLoginWebhookSyncResponse> {
    const usersRepo = DbService.repository.users;
    const existing = await usersRepo
      .findByAuth0Id(payload.user_id)
      .catch((err) => {
        logger.error(
          { auth0Id: payload.user_id, error: err },
          "Database error finding user by Auth0 ID"
        );
        throw new Error("Database error finding user");
      });

    if (!existing) {
      const user = new UserModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          auth0Id: payload.user_id,
          email: payload.email ?? null,
          name: payload.name ?? null,
          picture: payload.picture ?? null,
          lastLogin: SystemUtilities.utc.now().getTime(),
        });

      const created = await ApplicationService.setupOrganization(
        user.parse()
      ).catch((err) => {
        logger.error(
          { auth0Id: payload.user_id, error: err },
          "Error setting up organization for new user"
        );
        throw new Error("Error setting up organization for new user");
      });

      logger.info(
        { userId: created.user.id, auth0Id: payload.user_id },
        "Created new user from webhook"
      );

      return { action: "created", userId: created.user.id };
    }

    const user = new UserModel(existing).update({
      email: payload.email ?? null,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
      lastLogin: SystemUtilities.utc.now().getTime(),
      updated: SystemUtilities.utc.now().getTime(),
      updatedBy: SystemUtilities.id.system,
    });

    await usersRepo.update(existing.id, user.parse()).catch((err) => {
      logger.error(
        { userId: existing.id, auth0Id: payload.user_id, error: err },
        "Database error updating user from webhook"
      );
      throw new Error("Database error updating user");
    });

    logger.info(
      { userId: existing.id, auth0Id: payload.user_id },
      "Updated user from webhook"
    );

    return { action: "updated", userId: existing.id };
  }
}
