import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Auth0WebhookPayload } from "@mcp-ui/core/contracts";
import { environment } from "../../environment.js";

// Mock DbService
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      users: {
        findByAuth0Id: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  },
}));

const { DbService } = await import("../../services/db.service.js");
const { WebhookService } = await import("../../services/webhook.service.js");

const mockUsersRepo = DbService.repository.users as jest.Mocked<
  typeof DbService.repository.users
>;

describe("WebhookService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("syncUser", () => {
    const basePayload: Auth0WebhookPayload = {
      user_id: "auth0|abc123",
      email: "test@example.com",
      name: "Test User",
      picture: "https://example.com/avatar.png",
    };

    it("should create a new user when not found by auth0Id", async () => {
      mockUsersRepo.findByAuth0Id.mockResolvedValue(undefined);
      mockUsersRepo.create.mockResolvedValue({
        id: "generated-id",
        auth0Id: "auth0|abc123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = await WebhookService.syncUser(basePayload);

      expect(result.action).toBe("created");
      expect(result.userId).toBe("generated-id");
      expect(mockUsersRepo.findByAuth0Id).toHaveBeenCalledWith("auth0|abc123");
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          auth0Id: "auth0|abc123",
          email: "test@example.com",
          name: "Test User",
          picture: "https://example.com/avatar.png",
          createdBy: environment.SYSTEM_ID!,
          created: expect.any(Number),
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        })
      );
    });

    it("should return unchanged when user exists with same data", async () => {
      mockUsersRepo.findByAuth0Id.mockResolvedValue({
        id: "existing-id",
        auth0Id: "auth0|abc123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = await WebhookService.syncUser(basePayload);

      expect(result.action).toBe("unchanged");
      expect(result.userId).toBe("existing-id");
      expect(mockUsersRepo.create).not.toHaveBeenCalled();
      expect(mockUsersRepo.update).not.toHaveBeenCalled();
    });

    it("should update user when fields have changed", async () => {
      mockUsersRepo.findByAuth0Id.mockResolvedValue({
        id: "existing-id",
        auth0Id: "auth0|abc123",
        email: "old@example.com",
        name: "Old Name",
        picture: null,
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      mockUsersRepo.update.mockResolvedValue({
        id: "existing-id",
        auth0Id: "auth0|abc123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: Date.now(),
        updatedBy: environment.SYSTEM_ID!,
        deleted: null,
        deletedBy: null,
      });

      const result = await WebhookService.syncUser(basePayload);

      expect(result.action).toBe("updated");
      expect(result.userId).toBe("existing-id");
      expect(mockUsersRepo.update).toHaveBeenCalledWith(
        "existing-id",
        expect.objectContaining({
          email: "test@example.com",
          name: "Test User",
          picture: "https://example.com/avatar.png",
          updatedBy: environment.SYSTEM_ID!,
        })
      );
    });

    it("should handle user with no email, name, or picture", async () => {
      const minimalPayload: Auth0WebhookPayload = {
        user_id: "auth0|minimal",
      };

      mockUsersRepo.findByAuth0Id.mockResolvedValue(undefined);
      mockUsersRepo.create.mockResolvedValue({
        id: "new-id",
        auth0Id: "auth0|minimal",
        email: null,
        name: null,
        picture: null,
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      const result = await WebhookService.syncUser(minimalPayload);

      expect(result.action).toBe("created");
      expect(mockUsersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          auth0Id: "auth0|minimal",
          email: null,
          name: null,
          picture: null,
        })
      );
    });

    it("should detect change when email goes from null to a value", async () => {
      mockUsersRepo.findByAuth0Id.mockResolvedValue({
        id: "existing-id",
        auth0Id: "auth0|abc123",
        email: null,
        name: "Test User",
        picture: "https://example.com/avatar.png",
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });

      mockUsersRepo.update.mockResolvedValue({
        id: "existing-id",
        auth0Id: "auth0|abc123",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/avatar.png",
        created: Date.now(),
        createdBy: environment.SYSTEM_ID!,
        updated: Date.now(),
        updatedBy: environment.SYSTEM_ID!,
        deleted: null,
        deletedBy: null,
      });

      const result = await WebhookService.syncUser(basePayload);

      expect(result.action).toBe("updated");
      expect(mockUsersRepo.update).toHaveBeenCalled();
    });
  });
});
