import {
  FAQ_CATEGORY_LABELS,
  FAQ_ENTRIES,
  FAQCategory,
  filterFAQ,
} from "../../content/faq.util.js";
import {
  GLOSSARY_ENTRIES,
  contentEntrySlug,
} from "../../content/glossary.util.js";

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
    // Getting Started (8 — billing #176 added 3, entitlements #214 added 1)
    "What is Portals AI and what can I do with it?",
    "How do I connect my first data source?",
    "What is a Station and why do I need one?",
    "How do I start asking questions about my data?",
    "Is there a limit on how many messages I can send?",
    "How do I upgrade my plan?",
    "Who can manage billing?",
    "My plan says it's managed — what does that mean?",
    "Why is a toolpack marked “Inactive on your plan”?",
    // Working with Data (5)
    "What's the difference between a connector and an entity?",
    "What are column definitions and why do they matter?",
    "What are field mappings?",
    "How do I validate my data?",
    "What happens when I sync an entity?",
    // Organization & Grouping (3)
    "What are entity groups and when should I use them?",
    'What is a "link field" in an entity group?',
    "How do tags work?",
    // Analytics & Portals (11 — #366 added 3; four were never pinned)
    "What are tool packs?",
    "Why is a tool pack on my station greyed out, and why won't the assistant use it?",
    "How do I save results from a portal session?",
    "What's the difference between a portal and a portal result?",
    "Why do some results appear inline and others as a separate streamed table?",
    "How do I refresh a chart, map, or table with the latest data?",
    "Can I show my data on a map?",
    "Do failed tool calls use up my usage allocation?",
    "Why are the assistant's answers vague or missing my data?",
    "How should I word my questions to get better answers?",
    "Why does the assistant say my data is incomplete while an import is running?",
    // Jobs & Background Tasks (2)
    "What do job statuses mean?",
    "Why did my job fail?",
  ];

  it("includes every question listed in the audit doc (30 total)", () => {
    expect(expectedQuestions).toHaveLength(30);
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
      result.some(
        (e) => e.question === "What is a Station and why do I need one?"
      )
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
    expect(filterFAQ(FAQ_ENTRIES, { query: "zzz-no-such-term-zzz" })).toEqual(
      []
    );
  });
});

// ── Entry slug (#365) ───────────────────────────────────────────────

/**
 * FAQ questions become `#faq-entry-<slug>` Help anchors. A duplicate or empty
 * slug makes an anchor ambiguous or unresolvable, so both are pinned here
 * rather than discovered when a link silently scrolls nowhere.
 */
describe("FAQ entry slugs", () => {
  it("produces a non-empty slug for every question", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(contentEntrySlug(entry.question)).not.toBe("");
    }
  });

  it("produces a unique slug per question", () => {
    const slugs = FAQ_ENTRIES.map((e) => contentEntrySlug(e.question));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("produces a URL-safe slug for every question", () => {
    for (const entry of FAQ_ENTRIES) {
      expect(contentEntrySlug(entry.question)).toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)*$/
      );
    }
  });

  it("does not collide with any glossary term slug in a way that hides an entry", () => {
    // The two surfaces are namespaced by prefix (`faq-entry-` /
    // `glossary-entry-`), so an overlap is legal — this pins that the
    // namespacing is what disambiguates, not luck.
    const faqSlugs = new Set(
      FAQ_ENTRIES.map((e) => contentEntrySlug(e.question))
    );
    const glossarySlugs = new Set(
      GLOSSARY_ENTRIES.map((e) => contentEntrySlug(e.term))
    );
    for (const slug of faqSlugs) {
      expect(`faq-entry-${slug}`).not.toBe(`glossary-entry-${slug}`);
    }
    expect(glossarySlugs.size).toBeGreaterThan(0);
  });
});

// ── Portal best-practices guidance (#366) ───────────────────────────

/**
 * The FAQ half of the portal guidance: the same practices the glossary
 * carries, phrased the way a confused user would actually type them.
 * Answers render as plain text (`whiteSpace: "pre-line"`), so no markdown.
 */
describe("portal best-practices FAQ", () => {
  const VAGUE = "Why are the assistant's answers vague or missing my data?";
  const WORDING = "How should I word my questions to get better answers?";
  const RUNNING_JOB =
    "Why does the assistant say my data is incomplete while an import is running?";

  const find = (question: string) =>
    FAQ_ENTRIES.find((e) => e.question === question);

  it("has 11 Analytics & Portals questions", () => {
    // A real fence, mirroring the Jobs count above. `expectedQuestions` only
    // asserts that each listed question exists, so without this a category
    // could silently lose an entry.
    expect(
      FAQ_ENTRIES.filter((e) => e.category === FAQCategory.Analytics)
    ).toHaveLength(11);
  });

  it.each([VAGUE, WORDING, RUNNING_JOB])(
    "%s is an Analytics entry with an answer",
    (question) => {
      const entry = find(question);
      expect(entry).toBeDefined();
      expect(entry!.category).toBe(FAQCategory.Analytics);
      expect(entry!.answer.length).toBeGreaterThan(80);
    }
  );

  it("answers the vagueness question with something to go check", () => {
    const answer = find(VAGUE)!.answer;
    expect(answer).toMatch(/imported/i);
    expect(answer).toMatch(/sync/i);
  });

  it("answers the wording question with both practices", () => {
    const answer = find(WORDING)!.answer;
    expect(answer).toMatch(/one thing at a time/i);
    expect(answer).toMatch(/vocabulary/i);
  });

  it("answers the running-job question with the lock's real behavior", () => {
    const answer = find(RUNNING_JOB)!.answer;
    expect(answer).toMatch(/read-only/i);
    expect(answer).toMatch(/paused/i);
  });

  it("carries no markdown in the new answers", () => {
    for (const question of [VAGUE, WORDING, RUNNING_JOB]) {
      const answer = find(question)!.answer;
      expect(answer).not.toMatch(/`/);
      expect(answer).not.toMatch(/\*\*/);
      expect(answer).not.toMatch(/^\s*[-*]\s+/m);
    }
  });

  it.each([
    ["vague", VAGUE],
    ["word my questions", WORDING],
    ["import", RUNNING_JOB],
  ])("a reader searching %p finds the guidance", (query, question) => {
    const hits = filterFAQ(FAQ_ENTRIES, { query });
    expect(hits.map((e) => e.question)).toContain(question);
  });
});

// ── Source ordering (#366) ──────────────────────────────────────────

describe("FAQ_ENTRIES source ordering", () => {
  it("groups each category into one contiguous block", () => {
    // Array order isn't semantic — both consumers bucket by `category` — but
    // the source is organized in commented category blocks, and an entry
    // filed under the wrong comment is how four billing questions ended up
    // sitting inside "Analytics & Portals" while tagged Getting Started.
    // Contiguity is what keeps the comments honest.
    const seen = new Set<FAQCategory>();
    let previous: FAQCategory | null = null;

    for (const entry of FAQ_ENTRIES) {
      if (entry.category !== previous) {
        expect(seen.has(entry.category)).toBe(false);
        seen.add(entry.category);
        previous = entry.category;
      }
    }
  });

  it("keeps the billing questions tagged Getting Started", () => {
    // The reorder is a move, not a retag: these render exactly where they
    // did before. Retagging them into Analytics & Portals would file "How do
    // I upgrade my plan?" under portals, which is wrong for the reader.
    const billing = [
      "Is there a limit on how many messages I can send?",
      "How do I upgrade my plan?",
      "Who can manage billing?",
      "My plan says it's managed — what does that mean?",
      "Why is a toolpack marked “Inactive on your plan”?",
    ];
    for (const question of billing) {
      const entry = FAQ_ENTRIES.find((e) => e.question === question);
      expect(entry).toBeDefined();
      expect(entry!.category).toBe(FAQCategory.GettingStarted);
    }
  });
});
