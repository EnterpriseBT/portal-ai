import {
  GLOSSARY_CATEGORY_LABELS,
  GLOSSARY_ENTRIES,
  GlossaryCategory,
  contentEntrySlug,
  filterGlossary,
  type GlossaryEntry,
} from "../../content/glossary.util.js";

// ── 1.1 — Type and category enum ────────────────────────────────────

describe("GlossaryCategory enum", () => {
  it("exposes the 5 documented categories", () => {
    expect(Object.keys(GlossaryCategory).sort()).toEqual(
      [
        "Analytics",
        "DataModeling",
        "DataSources",
        "Organization",
        "System",
      ].sort()
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
    // Data Modeling
    "Column Definition",
    "Field Mapping",
    "Data Types",
    "Validation Pattern",
    "Canonical Format",
    "Primary Key",
    "Normalized Data",
    "Geometry",
    // Organization
    "Entity Group",
    "Entity Group Member",
    "Link Field",
    "Entity Tag",
    "Overlap Preview",
    // Analytics
    "Station",
    "Tool Pack",
    "Custom Toolpack",
    "Portal",
    "Portal Message",
    "Portal Result",
    "Pinned Result",
    "Map Visualization",
    // System
    "Job",
    "Job Status",
    "Organization",
    "Default Station",
    // Billing (#176)
    "Subscription Plan",
    "Billing Portal",
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

  // #311: the field survives in the type (apps/web re-attaches routes via
  // `withPageRoutes`), but the shared dataset must carry NO values — a route
  // into the authenticated app is meaningless on the public marketing site,
  // and a value creeping back in here is how that leaks.
  it("carries no pageRoute values — routes belong to the consuming app", () => {
    const withRoutes = GLOSSARY_ENTRIES.filter(
      (e) => e.pageRoute !== undefined
    );
    expect(withRoutes.map((e) => e.term)).toEqual([]);
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
    expect(filterGlossary(GLOSSARY_ENTRIES)).toHaveLength(
      GLOSSARY_ENTRIES.length
    );
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
        "Custom Toolpack",
        "Geocoding",
        "Map Visualization",
        "Pinned Result",
        // #284: plan entitlement is an Analytics concept — a tool pack can be
        // attached but inactive on the plan.
        "Plan Entitlement",
        "Portal",
        "Portal Message",
        "Portal Result",
        "Query Handle",
        "Signing Secret",
        "Station",
        "Tool",
        "Tool Pack",
        "Visualization Widget",
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

// ── Entry slug (#365) ───────────────────────────────────────────────

describe("contentEntrySlug", () => {
  it("lowercases and hyphenates a term", () => {
    expect(contentEntrySlug("Portal Result")).toBe("portal-result");
    expect(contentEntrySlug("Entity Record")).toBe("entity-record");
  });

  it("collapses runs of non-alphanumerics to a single hyphen", () => {
    expect(contentEntrySlug("How do I connect?")).toBe("how-do-i-connect");
    expect(contentEntrySlug("Jobs & Background   Tasks")).toBe(
      "jobs-background-tasks"
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(contentEntrySlug("  Portal  ")).toBe("portal");
    expect(contentEntrySlug("(Pinned Result)")).toBe("pinned-result");
  });

  it("is idempotent — slugging a slug changes nothing", () => {
    const slug = contentEntrySlug("Field Mapping");
    expect(contentEntrySlug(slug)).toBe(slug);
  });
});

/**
 * The slug is a contract, not a display detail: it appears in the
 * `#glossary-entry-<slug>` / `#faq-entry-<slug>` Help fragments (#365), in
 * both Help lists' `data-testid`s, and in the links the API-side assistant
 * builds (#367). These pins are what let one function replace the two
 * private slugifiers that used to live in apps/web.
 */
describe("contentEntrySlug pins", () => {
  /** The rule `GlossaryList.component.tsx` used before #365 unified them. */
  const legacyGlossarySlug = (term: string): string =>
    term.toLowerCase().replace(/\s+/g, "-");

  it("produces the pre-#365 slug for every glossary term", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(contentEntrySlug(entry.term)).toBe(legacyGlossarySlug(entry.term));
    }
  });

  it("produces a non-empty slug for every glossary term", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(contentEntrySlug(entry.term)).not.toBe("");
    }
  });

  it("produces a unique slug per glossary term", () => {
    const slugs = GLOSSARY_ENTRIES.map((e) => contentEntrySlug(e.term));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("produces a URL-safe slug for every glossary term", () => {
    for (const entry of GLOSSARY_ENTRIES) {
      expect(contentEntrySlug(entry.term)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
