/**
 * RFC 9116 `/.well-known/security.txt` (#613), rendered at build time so its
 * `Contact:` is the SSM-sourced SECURITY_EMAIL and its `Expires:` (required by
 * the RFC) moves forward with every build instead of lapsing on a hand-edited
 * date.
 */
import { describe, it, expect } from "@jest/globals";

import { SECURITY_TXT_TTL_DAYS, renderSecurityTxt } from "../security-txt.js";

const NOW = new Date("2026-10-22T12:34:56.789Z");

const render = (over: { siteUrl?: string; contactEmail?: string } = {}) =>
  renderSecurityTxt({
    contactEmail: "security@portalsai.io",
    siteUrl: "https://portalsai.io",
    now: NOW,
    ...over,
  });

describe("renderSecurityTxt", () => {
  it("emits the fields in a fixed order", () => {
    expect(render()).toBe(
      [
        "Contact: mailto:security@portalsai.io",
        "Expires: 2027-04-20T12:34:56Z",
        "Preferred-Languages: en",
        "Canonical: https://portalsai.io/.well-known/security.txt",
        "Policy: https://portalsai.io/security/#disclosure",
        "",
      ].join("\n")
    );
  });

  it("expires 180 days after the build, at second precision", () => {
    expect(SECURITY_TXT_TTL_DAYS).toBe(180);
    const expires = /^Expires: (.+)$/m.exec(render())?.[1];
    expect(expires).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(new Date(expires!).getTime() - NOW.getTime()).toBeLessThanOrEqual(
      180 * 86_400_000
    );
    expect(new Date(expires!).getTime() - NOW.getTime()).toBeGreaterThan(
      180 * 86_400_000 - 1000
    );
  });

  it("does not double the slash after a trailing-slash site URL", () => {
    expect(render({ siteUrl: "https://portalsai.io/" })).toContain(
      "Canonical: https://portalsai.io/.well-known/security.txt"
    );
  });

  it("uses LF line endings and ends with a newline", () => {
    const text = render();
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("writes the contact as a mailto: URI", () => {
    expect(render({ contactEmail: "qa@portalsai.io" })).toMatch(
      /^Contact: mailto:qa@portalsai\.io$/m
    );
  });
});
