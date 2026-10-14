import { describe, it, expect } from "@jest/globals";
import { DERIVED_KEY_MAX_LENGTH } from "@portalai/spreadsheet-parsing";

import {
  DESCRIPTION_MAX_LENGTH,
  KEY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  clipToLength,
  descriptionField,
  keyField,
  nameField,
  planTextLimitIssues,
  tooLongMessage,
} from "../../contracts/text-limits.contract.js";
import type { LayoutPlan } from "../../contracts/spreadsheet-parsing.contract.js";

const firstMessage = (r: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (r.success ? undefined : r.error!.issues[0]!.message);

describe("text limits (#801)", () => {
  it("the parser derives keys to the same limit", () => {
    // spreadsheet-parsing can't import core, so it keeps its own copy.
    expect(DERIVED_KEY_MAX_LENGTH).toBe(KEY_MAX_LENGTH);
  });

  it("pins the three limits", () => {
    expect(NAME_MAX_LENGTH).toBe(120);
    expect(DESCRIPTION_MAX_LENGTH).toBe(2000);
    expect(KEY_MAX_LENGTH).toBe(58);
  });

  describe("nameField", () => {
    it("accepts exactly the limit and rejects one more", () => {
      expect(nameField().safeParse("a".repeat(120)).success).toBe(true);
      const r = nameField().safeParse("a".repeat(121));
      expect(firstMessage(r)).toBe("Name must be 120 characters or fewer");
    });

    it("trims, and a whitespace-only name is required", () => {
      expect(nameField().parse("  Ops  ")).toBe("Ops");
      expect(firstMessage(nameField().safeParse("   "))).toBe(
        "Name is required"
      );
    });

    it("measures the limit after trimming", () => {
      expect(nameField().safeParse(` ${"a".repeat(120)} `).success).toBe(true);
    });

    it("names the field in both messages", () => {
      expect(firstMessage(nameField("Label").safeParse(""))).toBe(
        "Label is required"
      );
      expect(firstMessage(nameField("Label").safeParse("a".repeat(121)))).toBe(
        "Label must be 120 characters or fewer"
      );
    });
  });

  describe("descriptionField", () => {
    it("accepts exactly the limit and rejects one more", () => {
      expect(descriptionField().safeParse("a".repeat(2000)).success).toBe(true);
      expect(firstMessage(descriptionField().safeParse("a".repeat(2001)))).toBe(
        "Description must be 2000 characters or fewer"
      );
    });

    it("keeps the user's text as written", () => {
      expect(descriptionField().parse("  line\n")).toBe("  line\n");
      expect(descriptionField().safeParse("").success).toBe(true);
    });
  });

  describe("keyField", () => {
    it("accepts exactly the limit and rejects one more", () => {
      expect(keyField().safeParse("k".repeat(58)).success).toBe(true);
      expect(
        firstMessage(keyField("Normalized key").safeParse("k".repeat(59)))
      ).toBe("Normalized key must be 58 characters or fewer");
    });

    it("composes a caller's pattern", () => {
      const schema = keyField().regex(/^[a-z][a-z0-9_]*$/, "Bad key");
      expect(schema.safeParse("ok_key").success).toBe(true);
      expect(firstMessage(schema.safeParse("Bad-Key"))).toBe("Bad key");
    });
  });

  it("tooLongMessage reads as the builders' copy", () => {
    expect(tooLongMessage("Title", 120)).toBe(
      "Title must be 120 characters or fewer"
    );
  });

  describe("clipToLength", () => {
    it("leaves a value within the limit alone", () => {
      expect(clipToLength("Google Sheets (a@b.co)", 120)).toBe(
        "Google Sheets (a@b.co)"
      );
      expect(clipToLength("a".repeat(120), 120)).toBe("a".repeat(120));
    });

    it("never splits a character made of two UTF-16 units", () => {
      // An emoji straddling the cut: a code-unit slice would leave half of it.
      // The emoji would end at unit 120, leaving no room for the ellipsis,
      // so it's dropped whole.
      const clipped = clipToLength(
        `${"a".repeat(118)}😀${"b".repeat(10)}`,
        120
      );
      expect(clipped).toBe(`${"a".repeat(118)}…`);
      expect(nameField().safeParse(clipped).success).toBe(true);
      const fits = clipToLength(`${"a".repeat(117)}😀${"b".repeat(10)}`, 120);
      expect(fits).toBe(`${"a".repeat(117)}😀…`);
      expect(fits).toHaveLength(120);
      // No lone surrogate anywhere.
      expect(clipped).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      );
    });

    it("clips to exactly the limit with a trailing ellipsis", () => {
      const clipped = clipToLength("a".repeat(300), 120);
      expect(clipped).toHaveLength(120);
      expect(clipped.endsWith("…")).toBe(true);
    });
  });

  describe("planTextLimitIssues", () => {
    const plan = (regions: unknown[]): LayoutPlan =>
      ({ regions }) as unknown as LayoutPlan;
    const region = (
      targetEntityDefinitionId: string,
      normalizedKeys: (string | undefined)[] = []
    ) => ({
      targetEntityDefinitionId,
      columnBindings: normalizedKeys.map((normalizedKey) =>
        normalizedKey === undefined ? {} : { normalizedKey }
      ),
    });

    it("tolerates a stored plan with no regions or bindings", () => {
      // A stored plan is raw JSON; the commit-by-id path doesn't parse it.
      expect(planTextLimitIssues({} as unknown as LayoutPlan)).toEqual([]);
      expect(
        planTextLimitIssues(plan([{ targetEntityDefinitionId: "e" }]))
      ).toEqual([]);
    });

    it("returns no issues for a plan within the limits", () => {
      expect(
        planTextLimitIssues(
          plan([region("e".repeat(58), ["name", undefined, "k".repeat(58)])])
        )
      ).toEqual([]);
    });

    it("reports an over-length entity key at its plan path", () => {
      expect(
        planTextLimitIssues(plan([region("ok"), region("e".repeat(59))]))
      ).toEqual([
        {
          path: ["regions", 1, "targetEntityDefinitionId"],
          message: "Entity key must be 58 characters or fewer",
        },
      ]);
    });

    it("reports an over-length binding key override at its plan path", () => {
      expect(
        planTextLimitIssues(plan([region("ok", ["fine", "k".repeat(59)])]))
      ).toEqual([
        {
          path: ["regions", 0, "columnBindings", 1, "normalizedKey"],
          message: "Normalized key must be 58 characters or fewer",
        },
      ]);
    });
  });
});
