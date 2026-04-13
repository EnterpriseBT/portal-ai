import {
  GLOSSARY_CATEGORY_LABELS,
  GLOSSARY_ENTRIES,
  GlossaryCategory,
  filterGlossary,
  type GlossaryEntry,
} from "../utils/glossary.util";

// ── 1.1 — Type and category enum ────────────────────────────────────

describe("GlossaryCategory enum", () => {
  it("exposes the 5 documented categories", () => {
    expect(Object.keys(GlossaryCategory).sort()).toEqual(
      ["Analytics", "DataModeling", "DataSources", "Organization", "System"].sort()
    );
  });

  it("uses the documented kebab-case string values", () => {
    expect(GlossaryCategory.DataSources).toBe("data-sources");
    expect(GlossaryCategory.DataModeling).toBe("data-modeling");
    expect(GlossaryCategory.Organization).toBe("organization");
    expect(GlossaryCategory.Analytics).toBe("analytics");
    expect(GlossaryCategory.System).toBe("system");
  });
});

describe("GLOSSARY_CATEGORY_LABELS", () => {
  it("maps each enum value to a human label", () => {
    expect(GLOSSARY_CATEGORY_LABELS[GlossaryCategory.DataSources]).toBe(
      "Data Sources"
    );
    expect(GLOSSARY_CATEGORY_LABELS[GlossaryCategory.DataModeling]).toBe(
      "Data Modeling"
    );
    expect(GLOSSARY_CATEGORY_LABELS[GlossaryCategory.Organization]).toBe(
      "Organization"
    );
    expect(GLOSSARY_CATEGORY_LABELS[GlossaryCategory.Analytics]).toBe(
      "Analytics"
    );
    expect(GLOSSARY_CATEGORY_LABELS[GlossaryCategory.System]).toBe("System");
  });
});

// ── 1.2 — Dataset ───────────────────────────────────────────────────

const findEntry = (term: string): GlossaryEntry | undefined =>
  GLOSSARY_ENTRIES.find((e) => e.term.toLowerCase() === term.toLowerCase());

describe("GLOSSARY_ENTRIES", () => {
  const expectedTerms = [
    // Data Sources
    "Connector Definition",
    "Connector Instance",
    "Connector Entity",
    "Entity Record",
    "Sync",
    "Access Mode",
    // Data Modeling
    "Column Definition",
    "Field Mapping",
    "Data Types",
    "Validation Pattern",
    "Canonical Format",
    "Primary Key",
    "Normalized Data",
    // Organization
    "Entity Group",
    "Entity Group Member",
    "Link Field",
    "Entity Tag",
    "Overlap Preview",
    // Analytics
    "Station",
    "Tool Pack",
    "Portal",
    "Portal Message",
    "Portal Result",
    "Pinned Result",
    // System
    "Job",
    "Job Status",
    "Organization",
    "Default Station",
  ];

  it("contains an entry for every term named in the audit doc", () => {
    for (const term of expectedTerms) {
      expect(findEntry(term)).toBeDefined();
    }
  });

  it("every entry has a non-empty term, definition, and category", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(entry.term).toBeTruthy();
      expect(entry.definition).toBeTruthy();
      expect(entry.category).toBeTruthy();
    }
  });

  it("every entry's category is a valid GlossaryCategory value", () => {
    const validCategories = new Set(Object.values(GlossaryCategory));
    for (const entry of GLOSSARY_ENTRIES) {
      expect(validCategories.has(entry.category)).toBe(true);
    }
  });

  it("relatedTerms only references terms that exist in the dataset", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      for (const related of entry.relatedTerms ?? []) {
        expect(findEntry(related)).toBeDefined();
      }
    }
  });

  it("pageRoute (when set) starts with '/' — no absolute URLs", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      if (entry.pageRoute !== undefined) {
        expect(entry.pageRoute.startsWith("/")).toBe(true);
        expect(entry.pageRoute.startsWith("http")).toBe(false);
      }
    }
  });

  it("terms are unique within the dataset (case-insensitive)", () => {
    const seen = new Set<string>();
    for (const entry of GLOSSARY_ENTRIES) {
      const key = entry.term.toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ── 1.3 — filterGlossary ────────────────────────────────────────────

describe("filterGlossary", () => {
  it("returns all entries when query is empty and no category set", () => {
    expect(filterGlossary(GLOSSARY_ENTRIES)).toHaveLength(GLOSSARY_ENTRIES.length);
    expect(filterGlossary(GLOSSARY_ENTRIES, {})).toHaveLength(
      GLOSSARY_ENTRIES.length
    );
    expect(filterGlossary(GLOSSARY_ENTRIES, { query: "" })).toHaveLength(
      GLOSSARY_ENTRIES.length
    );
  });

  it("matches term substring case-insensitively", () => {
    const result = filterGlossary(GLOSSARY_ENTRIES, { query: "connector" });
    const terms = result.map((e) => e.term);
    expect(terms).toEqual(
      expect.arrayContaining([
        "Connector Definition",
        "Connector Instance",
        "Connector Entity",
      ])
    );
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("matches definition substring case-insensitively", () => {
    // "regular expression" is a unique phrase used only in the Validation Pattern entry's definition.
    const result = filterGlossary(GLOSSARY_ENTRIES, {
      query: "regular expression",
    });
    expect(result).toHaveLength(1);
    expect(result[0].term).toBe("Validation Pattern");
  });

  it("scopes results to the supplied category", () => {
    const result = filterGlossary(GLOSSARY_ENTRIES, {
      category: GlossaryCategory.Analytics,
    });
    const terms = result.map((e) => e.term).sort();
    expect(terms).toEqual(
      [
        "Pinned Result",
        "Portal",
        "Portal Message",
        "Portal Result",
        "Station",
        "Tool Pack",
      ].sort()
    );
  });

  it("combines query and category (intersection)", () => {
    const result = filterGlossary(GLOSSARY_ENTRIES, {
      query: "portal",
      category: GlossaryCategory.Analytics,
    });
    // All Analytics entries containing "portal" in term or definition.
    for (const entry of result) {
      expect(entry.category).toBe(GlossaryCategory.Analytics);
      const haystack = `${entry.term} ${entry.definition}`.toLowerCase();
      expect(haystack).toContain("portal");
    }
    // Should not contain non-Analytics entries.
    expect(result.find((e) => e.term === "Connector Instance")).toBeUndefined();
  });

  it("returns empty array on no matches", () => {
    expect(
      filterGlossary(GLOSSARY_ENTRIES, { query: "zzz-no-such-term-zzz" })
    ).toEqual([]);
  });
});
