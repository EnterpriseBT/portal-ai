import type { Auth0WebhookPayload, Auth0WebhookSyncResponse } from "@mcp-ui/core/contracts";
import { UUIDv4Factory } from "@mcp-ui/core/utils";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "webhook" });
const idFactory = new UUIDv4Factory();

export class WebhookService {
  static async syncUser(
    payload: Auth0WebhookPayload
  ): Promise<Auth0WebhookSyncResponse> {
    const { user } = payload;
    const usersRepo = DbService.repository.users;

    const existing = await usersRepo.findByAuth0Id(user.user_id);

    if (!existing) {
      const now = Date.now();
      const created = await usersRepo.create({
        id: idFactory.generate(),
        auth0Id: user.user_id,
        email: user.email ?? null,
        name: user.name ?? null,
        picture: user.picture ?? null,
        created: now,
        createdBy: "webhook:auth0",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      logger.info(
        { userId: created.id, auth0Id: user.user_id },
        "Created new user from webhook"
      );

      return { action: "created", userId: created.id };
    }

    const hasChanges =
      (user.email ?? null) !== existing.email ||
      (user.name ?? null) !== existing.name ||
      (user.picture ?? null) !== existing.picture;

    if (!hasChanges) {
      logger.debug(
        { userId: existing.id, auth0Id: user.user_id },
        "User unchanged, skipping update"
      );
      return { action: "unchanged", userId: existing.id };
    }

    await usersRepo.update(existing.id, {
      email: user.email ?? null,
      name: user.name ?? null,
      picture: user.picture ?? null,
      updated: Date.now(),
      updatedBy: "webhook:auth0",
    });

    logger.info(
      { userId: existing.id, auth0Id: user.user_id },
      "Updated user from webhook"
    );

    return { action: "updated", userId: existing.id };
  }
}
