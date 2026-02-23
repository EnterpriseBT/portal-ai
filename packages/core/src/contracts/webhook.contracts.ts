import { z } from "zod";

/**
 * Full Auth0 webhook payload sent by Auth0 Actions.
 */
export const Auth0PostLoginWebhookPayloadSchema = z.object({
  user_id: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type Auth0PostLoginWebhookPayload = z.infer<
  typeof Auth0PostLoginWebhookPayloadSchema
>;

/**
 * Response returned by the webhook sync endpoint.
 */
export const Auth0PostLoginWebhookSyncResponseSchema = z.object({
  action: z.enum(["created", "updated"]),
  userId: z.string(),
});

export type Auth0PostLoginWebhookSyncResponse = z.infer<
  typeof Auth0PostLoginWebhookSyncResponseSchema
>;
