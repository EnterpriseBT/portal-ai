import { z } from "zod";

/**
 * Auth0 webhook event types fired by Auth0 Actions.
 */
export const Auth0WebhookEventTypeSchema = z.enum([
  "post_login",
  "post_user_registration",
]);

export type Auth0WebhookEventType = z.infer<typeof Auth0WebhookEventTypeSchema>;

/**
 * User payload included in Auth0 webhook events.
 */
export const Auth0WebhookUserSchema = z.object({
  user_id: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

export type Auth0WebhookUser = z.infer<typeof Auth0WebhookUserSchema>;

/**
 * Full Auth0 webhook payload sent by Auth0 Actions.
 */
export const Auth0WebhookPayloadSchema = z.object({
  event_type: Auth0WebhookEventTypeSchema,
  user: Auth0WebhookUserSchema,
  timestamp: z.string(),
});

export type Auth0WebhookPayload = z.infer<typeof Auth0WebhookPayloadSchema>;

/**
 * Response returned by the webhook sync endpoint.
 */
export const Auth0WebhookSyncResponseSchema = z.object({
  action: z.enum(["created", "updated", "unchanged"]),
  userId: z.string(),
});

export type Auth0WebhookSyncResponse = z.infer<
  typeof Auth0WebhookSyncResponseSchema
>;
