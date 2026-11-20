import { describe, it, expect } from "@jest/globals";

import { TROUBLESHOOTING_ENTRIES } from "../../content/troubleshooting.util";
import { FAQ_ENTRIES } from "../../content/faq.util";
import {
  GLOSSARY_ENTRIES,
  contentEntrySlug,
} from "../../content/glossary.util";

describe("TROUBLESHOOTING_ENTRIES (#1049)", () => {
  it("has a symptom, a cause and a fix on every entry", () => {
    expect(TROUBLESHOOTING_ENTRIES.length).toBeGreaterThan(0);
    for (const e of TROUBLESHOOTING_ENTRIES) {
      expect(e.symptom.trim()).not.toBe("");
      expect(e.cause.trim()).not.toBe("");
      expect(e.fix.trim()).not.toBe("");
    }
  });

  it("slugs every symptom uniquely and URL-safely", () => {
    const slugs = TROUBLESHOOTING_ENTRIES.map((e) =>
      contentEntrySlug(e.symptom)
    );
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("relates only to FAQ and glossary entries that exist", () => {
    const faq = new Set(FAQ_ENTRIES.map((e) => e.question));
    const glossary = new Set(GLOSSARY_ENTRIES.map((e) => e.term));
    for (const e of TROUBLESHOOTING_ENTRIES) {
      for (const r of e.related ?? []) {
        expect((r.surface === "faq" ? faq : glossary).has(r.title)).toBe(true);
      }
    }
  });
});
