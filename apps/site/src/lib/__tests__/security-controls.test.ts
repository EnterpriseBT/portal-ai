/**
 * The /security/ page's claims (#613).
 *
 * A trust page is only worth publishing if it's true, and the failure that
 * prose can't catch on its own is a control removed while its claim stays.
 * So every control names the repo paths it rests on, and this suite fails
 * when one disappears. Wording stays a review concern; `FORBIDDEN_CLAIMS`
 * blocks the specific overclaims discovery found (zero retention, a
 * compliance badge, DR, Redis encryption).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import { FORBIDDEN_CLAIMS, SECURITY_CONTROLS } from "../security-controls.js";
import {
  DATA_AND_AI_PARAGRAPHS,
  DISCLOSURE_PARAGRAPHS,
} from "../security-page.js";

// Resolved from this file, not cwd — jest may run from the package or the root.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.."
);

const EMAIL = "security@example.test";

/** Every sentence the page renders from `src/lib`. */
const renderedProse = (): string[] => [
  ...SECURITY_CONTROLS.flatMap((c) => [c.title, c.claim]),
  ...DATA_AND_AI_PARAGRAPHS,
  ...DISCLOSURE_PARAGRAPHS(EMAIL),
];

describe("SECURITY_CONTROLS", () => {
  it("resolves the repo root (guards the guard)", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "CLAUDE.md"))).toBe(true);
  });

  it("uses unique, anchor-safe ids", () => {
    const ids = SECURITY_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("backs every claim with evidence", () => {
    for (const c of SECURITY_CONTROLS) {
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });

  it.each(SECURITY_CONTROLS.flatMap((c) => c.evidence.map((e) => [c.id, e])))(
    "%s: evidence %s still exists",
    (_id, evidence) => {
      expect(fs.existsSync(path.join(REPO_ROOT, evidence))).toBe(true);
    }
  );
});

describe("FORBIDDEN_CLAIMS", () => {
  it("appear nowhere in the page's prose", () => {
    const hits = renderedProse().flatMap((text) =>
      FORBIDDEN_CLAIMS.filter((phrase) =>
        text.toLowerCase().includes(phrase.toLowerCase())
      ).map((phrase) => `"${phrase}" in: ${text}`)
    );
    expect(hits).toEqual([]);
  });
});

describe("DISCLOSURE_PARAGRAPHS", () => {
  const text = DISCLOSURE_PARAGRAPHS(EMAIL).join(" ");

  it("names the reporting address it is given", () => {
    expect(text).toContain(EMAIL);
  });

  it("states the acknowledgement and remediation commitments", () => {
    expect(text).toContain("5 business days");
    expect(text).toContain("7 days");
    expect(text).toContain("30 days");
  });

  it("offers safe harbor and no bounty", () => {
    expect(text.toLowerCase()).toContain("good faith");
    expect(text.toLowerCase()).toContain("bug bounty");
  });
});

describe("DATA_AND_AI_PARAGRAPHS", () => {
  it("says customer content does not train models", () => {
    expect(DATA_AND_AI_PARAGRAPHS.join(" ")).toMatch(/not used to train/i);
  });
});

describe("the legal pages agree with /security/", () => {
  // Privacy and terms are legal-owned prose in `.astro` files, so they can't
  // import the claims above. These pin the two sentences that contradicted
  // the code when #613 surveyed them, plus the forbidden phrases, against the
  // page source.
  const source = (page: string): string =>
    fs.readFileSync(
      path.join(REPO_ROOT, "apps/site/src/pages", `${page}.astro`),
      "utf8"
    );

  /** The text of one `SECTIONS` entry, from its heading to the next. */
  const section = (page: string, heading: string): string => {
    const text = source(page);
    const start = text.indexOf(`heading: "${heading}"`);
    expect(start).toBeGreaterThan(-1);
    const next = text.indexOf("heading:", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  it("privacy's Security section claims no blanket encryption", () => {
    // Our cache is not encrypted at rest until #852 ships; "encryption in
    // transit and at rest" said it all was.
    expect(section("privacy", "Security")).not.toMatch(
      /encryption in transit and at rest/i
    );
  });

  it("privacy's Security section makes no forbidden claim", () => {
    const text = section("privacy", "Security").toLowerCase();
    for (const phrase of FORBIDDEN_CLAIMS) {
      expect(text).not.toContain(phrase.toLowerCase());
    }
  });

  it("terms don't describe Google as the identity provider", () => {
    // Sign-in runs through Auth0, with Google as one way in and enterprise
    // SSO as another.
    expect(section("terms", "Your account")).not.toMatch(
      /identity provider \(Google\)/
    );
  });
});
