/**
 * The build-time gate on `dist/.well-known/security.txt` (#613): a missing or
 * malformed file fails `npm run build`, the same way a broken page does.
 */
import { describe, it, expect } from "@jest/globals";

import { renderSecurityTxt } from "../../src/lib/security-txt.js";
import { checkSecurityTxt } from "../check-security-txt.mjs";

const NOW = new Date("2026-10-22T00:00:00Z");
const ORIGIN = "https://portalsai.io";

const valid = () =>
  renderSecurityTxt({
    contactEmail: "security@portalsai.io",
    siteUrl: ORIGIN,
    now: NOW,
  });

const check = (text: string) =>
  checkSecurityTxt(text, { now: NOW, origin: ORIGIN });

describe("checkSecurityTxt", () => {
  it("passes a rendered file", () => {
    expect(check(valid())).toEqual([]);
  });

  it("fails a missing Contact", () => {
    const text = valid().replace(/^Contact:.*\n/m, "");
    expect(check(text)).toEqual([expect.stringContaining("Contact")]);
  });

  it("fails an empty mailto: contact", () => {
    const text = valid().replace(/^Contact:.*$/m, "Contact: mailto:");
    expect(check(text)).toEqual([expect.stringContaining("Contact")]);
  });

  it.each([
    ['x"><script>alert(1)</script>@evil.io'],
    ["security team@portalsai.io"],
    ["<security@portalsai.io>"],
  ])("fails a Contact address carrying markup or spaces: %s", (address) => {
    // Adversarial §2.1: the page escapes it, but security.txt would publish
    // it verbatim to every scanner that reads the file.
    const text = valid().replace(
      /^Contact:.*$/m,
      () => `Contact: mailto:${address}`
    );
    expect(check(text)).toEqual([expect.stringContaining("Contact")]);
  });

  it("fails an Expires in the past", () => {
    const text = valid().replace(
      /^Expires:.*$/m,
      "Expires: 2026-01-01T00:00:00Z"
    );
    expect(check(text)).toEqual([expect.stringContaining("Expires")]);
  });

  it("fails an unparseable Expires", () => {
    const text = valid().replace(/^Expires:.*$/m, "Expires: next spring");
    expect(check(text)).toEqual([expect.stringContaining("Expires")]);
  });

  it("fails a duplicate Expires", () => {
    const text = valid() + "Expires: 2027-01-01T00:00:00Z\n";
    expect(check(text)).toEqual([expect.stringContaining("Expires")]);
  });

  it.each(["Canonical", "Policy"])("fails a missing %s", (name) => {
    // /security/#disclosure is only reachable from security.txt through Policy.
    const text = valid().replace(new RegExp(`^${name}:.*\\n`, "m"), "");
    expect(check(text)).toEqual([expect.stringContaining(name)]);
  });

  it("fails a Canonical or Policy on another origin", () => {
    const text = valid().replace(
      "Canonical: https://portalsai.io",
      "Canonical: https://site-dev.portalsai.io"
    );
    expect(check(text)).toEqual([expect.stringContaining("Canonical")]);
  });
});
