import { describe, it, expect } from "@jest/globals";

import { HelpBlockContentSchema } from "../../contracts/help-block.contract.js";

const ref = (n: number) => ({
  surface: "faq" as const,
  slug: `q-${n}`,
  title: `Q ${n}`,
  url: `/help?tab=faq#faq-entry-q-${n}`,
});

describe("HelpBlockContentSchema (#1049)", () => {
  const valid = {
    type: "help" as const,
    query: "q",
    entries: [{ ...ref(1), body: "A." }],
    candidates: [ref(2)],
    noMatch: false,
    helpUrl: "/help?tab=getting-started",
  };

  it("accepts a result with entries, candidates and a Help link", () => {
    expect(HelpBlockContentSchema.safeParse(valid).success).toBe(true);
  });

  it("bounds the result: at most 3 entries and 5 candidates", () => {
    const tooManyEntries = {
      ...valid,
      entries: [1, 2, 3, 4].map((n) => ({ ...ref(n), body: "A." })),
    };
    const tooManyCandidates = {
      ...valid,
      candidates: [1, 2, 3, 4, 5, 6].map(ref),
    };
    expect(HelpBlockContentSchema.safeParse(tooManyEntries).success).toBe(
      false
    );
    expect(HelpBlockContentSchema.safeParse(tooManyCandidates).success).toBe(
      false
    );
  });
});
