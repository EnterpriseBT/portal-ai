import { parseAuthArgs } from "../lib/auth-args.js";

describe("parseAuthArgs", () => {
  it("defaults to the local owner", () => {
    const args = parseAuthArgs([], {});
    expect(args.target.name).toBe("local");
    expect(args.identity).toBeUndefined();
    expect(args.inviteUrl).toBeUndefined();
  });

  it("takes --env, --identity and an invite link on the target's own origin", () => {
    const args = parseAuthArgs(
      [
        "--env",
        "app-dev",
        "--identity",
        "admin",
        "--invite",
        "https://app-dev.portalsai.io/invitations/accept?token=t",
      ],
      {}
    );
    expect(args.target.name).toBe("app-dev");
    expect(args.identity).toBe("admin");
    expect(args.inviteUrl).toBe(
      "https://app-dev.portalsai.io/invitations/accept?token=t"
    );
  });

  // The credential is typed wherever the link leads, so a link must belong
  // to the env whose credential this is.
  it("refuses an invite link on another origin", () => {
    expect(() =>
      parseAuthArgs(
        [
          "--env",
          "prod",
          "--invite",
          "https://app-dev.portalsai.io/invitations/accept?token=t",
        ],
        {}
      )
    ).toThrow(/https:\/\/app\.portalsai\.io/);
  });

  it("refuses an invite link that isn't an accept link", () => {
    expect(() =>
      parseAuthArgs(["--invite", "http://localhost:3000/settings"], {})
    ).toThrow(/invitations\/accept/);
  });

  it("falls back to E2E_IDENTITY", () => {
    expect(parseAuthArgs([], { E2E_IDENTITY: "member" }).identity).toBe(
      "member"
    );
  });
});
