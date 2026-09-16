import { Auth0PostLoginWebhookPayloadSchema } from "../../contracts/webhook.contract.js";

describe("Auth0PostLoginWebhookPayloadSchema", () => {
  it("requires user_id and accepts the optional profile/context fields", () => {
    expect(
      Auth0PostLoginWebhookPayloadSchema.safeParse({ user_id: "auth0|1" })
        .success
    ).toBe(true);
    expect(Auth0PostLoginWebhookPayloadSchema.safeParse({}).success).toBe(
      false
    );
  });

  it("accepts email_verified (#584) as an optional boolean", () => {
    const ok = Auth0PostLoginWebhookPayloadSchema.safeParse({
      user_id: "auth0|1",
      email: "a@b.com",
      email_verified: true,
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.email_verified).toBe(true);

    expect(
      Auth0PostLoginWebhookPayloadSchema.safeParse({
        user_id: "auth0|1",
        email_verified: "yes",
      }).success
    ).toBe(false);
  });
});
