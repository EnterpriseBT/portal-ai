import type {
  Auth0WebhookPayload,
  Auth0WebhookSyncResponse,
} from "@mcp-ui/core/contracts";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";
import { UserModelFactory } from "@mcp-ui/core/models";
import { SystemUtilities } from "../utils/system.util.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

const logger = createLogger({ module: "webhook" });

export class WebhookService {
  static async syncUser(
    payload: Auth0WebhookPayload
  ): Promise<Auth0WebhookSyncResponse> {
    const usersRepo = DbService.repository.users;
    const existing = await usersRepo.findByAuth0Id(payload.user_id);
    if (!existing) {
      const user = new UserModelFactory()
        .create(SystemUtilities.id.system)
        .update({
          auth0Id: payload.user_id,
          email: payload.email ?? null,
          name: payload.name ?? null,
          picture: payload.picture ?? null,
        });

      const validation = user.validate();
      if (validation.error) {
        logger.error(
          { auth0Id: payload.user_id },
          "Validation failed for new user from webhook"
        );
        throw new ApiError(
          400,
          ApiCode.WEBHOOK_INVALID_PAYLOAD,
          "User validation failed"
        );
      }

      const created = await usersRepo.create(validation.data);

      logger.info(
        { userId: created.id, auth0Id: payload.user_id },
        "Created new user from webhook"
      );

      return { action: "created", userId: created.id };
    }

    const hasChanges =
      (payload.email ?? null) !== existing.email ||
      (payload.name ?? null) !== existing.name ||
      (payload.picture ?? null) !== existing.picture;

    if (!hasChanges) {
      logger.debug(
        { userId: existing.id, auth0Id: payload.user_id },
        "User unchanged, skipping update"
      );
      return { action: "unchanged", userId: existing.id };
    }

    await usersRepo.update(existing.id, {
      email: payload.email ?? null,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
      updated: Date.now(),
      updatedBy: SystemUtilities.id.system,
    });

    logger.info(
      { userId: existing.id, auth0Id: payload.user_id },
      "Updated user from webhook"
    );

    return { action: "updated", userId: existing.id };
  }
}
