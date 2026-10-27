import { describe, it, expect, afterEach, jest } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { environment } from "../../environment.js";
import { ApiError } from "../../services/http.service.js";
import {
  buildInviteUrl,
  inviteLinkBase,
} from "../../utils/invite-link.util.js";

describe("invite-link.util (#889)", () => {
  const restores: (() => void)[] = [];

  function setEnv(nodeEnv: string, webAppUrl: string): void {
    const node = jest.replaceProperty(environment, "NODE_ENV", nodeEnv);
    const web = jest.replaceProperty(environment, "WEB_APP_URL", webAppUrl);
    restores.push(
      () => node.restore(),
      () => web.restore()
    );
  }

  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  function refusal(fn: () => unknown): ApiError {
    try {
      fn();
    } catch (err) {
      return err as ApiError;
    }
    throw new Error("expected a refusal");
  }

  it("builds the link on the configured origin in production", () => {
    setEnv("production", "https://app.example");
    expect(buildInviteUrl(inviteLinkBase(), "abc")).toBe(
      "https://app.example/invitations/accept?token=abc"
    );
  });

  it("drops a trailing slash from the origin", () => {
    setEnv("production", "https://app.example/");
    expect(buildInviteUrl(inviteLinkBase(), "abc")).toBe(
      "https://app.example/invitations/accept?token=abc"
    );
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    // Every other loopback spelling the URL parser can hand back.
    "http://127.0.1.1:3000",
    "http://127.0.0.2",
    "http://127.1",
    "http://2130706433",
    "http://[::ffff:127.0.0.1]",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::]",
    "http://0",
    "http://LOCALHOST",
    "http://localhost.",
    "http://web.localhost",
    "ftp://app.example",
    "",
    "not a url",
  ])("refuses %p in production with a 503 the inviter can read", (url) => {
    setEnv("production", url);
    const err = refusal(() => inviteLinkBase());
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe(ApiCode.INVITATION_LINK_UNCONFIGURED);
    expect(err.message).toBe(
      "Invitation links aren't configured on this server"
    );
  });

  it.each(["https://127.example.com", "http://portal.corp:8080"])(
    "accepts %p in production",
    (url) => {
      setEnv("production", url);
      expect(inviteLinkBase()).toBe(url);
    }
  );

  it("allows the localhost default outside production", () => {
    setEnv("development", "http://localhost:3000");
    expect(buildInviteUrl(inviteLinkBase(), "abc")).toBe(
      "http://localhost:3000/invitations/accept?token=abc"
    );
  });
});
