import {
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  FAQCategory,
  filterFAQ,
} from "../utils/faq.util";
import { GLOSSARY_ENTRIES } from "../utils/glossary.util";

// ── 2.1 — Type and category enum ────────────────────────────────────

describe("FAQCategory enum", () => {
  it("exposes the 5 documented categories", () => {
    expect(Object.keys(FAQCategory).sort()).toEqual(
      ["Analytics", "Data", "GettingStarted", "Jobs", "Organization"].sort()
    );
  });

  it("uses the documented kebab-case string values", () => {
    expect(FAQCategory.GettingStarted).toBe("getting-started");
    expect(FAQCategory.Data).toBe("data");
    expect(FAQCategory.Organization).toBe("organization");
    expect(FAQCategory.Analytics).toBe("analytics");
    expect(FAQCategory.Jobs).toBe("jobs");
  });
});

describe("FAQ_CATEGORY_LABELS", () => {
  it("maps each enum value to a human label", () => {
    expect(FAQ_CATEGORY_LABELS[FAQCategory.GettingStarted]).toBe(
      "Getting Started"
    );
    expect(FAQ_CATEGORY_LABELS[FAQCategory.Data]).toBe("Working with Data");
    expect(FAQ_CATEGORY_LABELS[FAQCategory.Organization]).toBe(
      "Organization & Grouping"
    );
    expect(FAQ_CATEGORY_LABELS[FAQCategory.Analytics]).toBe(
      "Analytics & Portals"
    );
    expect(FAQ_CATEGORY_LABELS[FAQCategory.Jobs]).toBe(
      "Jobs & Background Tasks"
    );
  });
});

// ── 2.2 — Dataset ───────────────────────────────────────────────────

describe("FAQ_ENTRIES", () => {
  const expectedQuestions = [
    // Getting Started (4)
    "What is Portals.ai and what can I do with it?",
    "How do I connect my first data source?",
    "What is a Station and why do I need one?",
    "How do I start asking questions about my data?",
    // Working with Data (6)
    "What's the difference between a connector and an entity?",
    "What are column definitions and why do they matter?",
    "What are field mappings?",
    "What do the access modes (import, live, hybrid) mean?",
    "How do I validate my data?",
    "What happens when I sync an entity?",
    // Organization & Grouping (3)
    "What are entity groups and when should I use them?",
    "What is a \"link field\" in an entity group?",
    "How do tags work?",
    // Analytics & Portals (3)
    "What are tool packs?",
    "How do I save results from a portal session?",
    "What's the difference between a portal and a portal result?",
    // Jobs & Background Tasks (2)
    "What do job statuses mean?",
    "Why did my job fail?",
  ];

  it("includes every question listed in the audit doc (18 total)", () => {
    expect(expectedQuestions).toHaveLength(18);
    for (const question of expectedQuestions) {
      const match = FAQ_ENTRIES.find((e) => e.question === question);
      expect(match).toBeDefined();
    }
  });

  it("every entry has a non-empty question, answer, and category", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(entry.question).toBeTruthy();
      expect(entry.answer).toBeTruthy();
      expect(entry.category).toBeTruthy();
    }
  });

  it("every entry's category is a valid FAQCategory value", () => {
    const validCategories = new Set(Object.values(FAQCategory));
    for (const entry of FAQ_ENTRIES) {
      expect(validCategories.has(entry.category)).toBe(true);
    }
  });

  it("relatedGlossaryTerms only references terms in GLOSSARY_ENTRIES", () => {
    const glossaryTermSet = new Set(
      GLOSSARY_ENTRIES.map((e) => e.term.toLowerCase())
    );
    for (const entry of FAQ_ENTRIES) {
      for (const related of entry.relatedGlossaryTerms ?? []) {
        expect(glossaryTermSet.has(related.toLowerCase())).toBe(true);
      }
    }
  });

  it("questions are unique (no duplicate question across the dataset)", () => {
    const seen = new Set<string>();
    for (const entry of FAQ_ENTRIES) {
      const key = entry.question.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ── 2.3 — filterFAQ ─────────────────────────────────────────────────

describe("filterFAQ", () => {
  it("returns all entries when query is empty and no category set", () => {
    expect(filterFAQ(FAQ_ENTRIES)).toHaveLength(FAQ_ENTRIES.length);
    expect(filterFAQ(FAQ_ENTRIES, {})).toHaveLength(FAQ_ENTRIES.length);
    expect(filterFAQ(FAQ_ENTRIES, { query: "" })).toHaveLength(
      FAQ_ENTRIES.length
    );
  });

  it("matches question substring case-insensitively", () => {
    const result = filterFAQ(FAQ_ENTRIES, { query: "STATION" });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(
      result.some((e) => e.question === "What is a Station and why do I need one?")
    ).toBe(true);
  });

  it("matches answer substring case-insensitively", () => {
    // "Pending — queued" is a unique phrase only in the job-statuses answer.
    const result = filterFAQ(FAQ_ENTRIES, { query: "pending — queued" });
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("What do job statuses mean?");
  });

  it("scopes results to the supplied category", () => {
    const result = filterFAQ(FAQ_ENTRIES, {
      category: FAQCategory.Jobs,
    });
    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry.category).toBe(FAQCategory.Jobs);
    }
  });

  it("combines query and category (intersection)", () => {
    const result = filterFAQ(FAQ_ENTRIES, {
      query: "portal",
      category: FAQCategory.Analytics,
    });
    for (const entry of result) {
      expect(entry.category).toBe(FAQCategory.Analytics);
      const haystack = `${entry.question} ${entry.answer}`.toLowerCase();
      expect(haystack).toContain("portal");
    }
    // No Jobs-category entries should leak in.
    expect(result.find((e) => e.category === FAQCategory.Jobs)).toBeUndefined();
  });

  it("returns empty array on no matches", () => {
    expect(
      filterFAQ(FAQ_ENTRIES, { query: "zzz-no-such-term-zzz" })
    ).toEqual([]);
  });
});
