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

// ── Portal best-practices guidance (#366) ───────────────────────────

/**
 * The portal cluster carries practices, not just definitions — the same
 * pattern `Tool Pack` already follows. These assert the *guidance* is
 * present and single-sourced; the exact wording lives in
 * docs/PORTAL_BEST_PRACTICES_CONTENT.spec.md.
 */
describe("portal best-practices guidance", () => {
  const portal = () => GLOSSARY_ENTRIES.find((e) => e.term === "Portal")!;
  const portalMessage = () =>
    GLOSSARY_ENTRIES.find((e) => e.term === "Portal Message")!;
  const portalResult = () =>
    GLOSSARY_ENTRIES.find((e) => e.term === "Portal Result")!;

  it("Portal states the entity-data prerequisite in plain language", () => {
    const def = portal().definition;
    expect(def).toMatch(/only as good as the data behind it/i);
    // The actionable half: it names what has to be true, not just that
    // something is wrong.
    expect(def).toMatch(/imported/i);
    expect(def).toMatch(/connected source/i);
  });

  it("Portal tells the reader to ask about one thing at a time", () => {
    expect(portal().definition).toMatch(/one thing at a time/i);
  });

  it("Portal Message tells the reader to use the station's vocabulary", () => {
    const def = portalMessage().definition;
    expect(def).toMatch(/vocabulary/i);
    expect(def).toMatch(/columns/i);
  });

  it("Portal Result frames results as durable output worth pinning", () => {
    const def = portalResult().definition;
    expect(def).toMatch(/\bpin\b/i);
    expect(def).toMatch(/live data/i);
  });

  it("keeps the tool-pack practice single-sourced on Tool Pack", () => {
    // Cross-link, never repeat — two copies of a practice is two things to
    // keep true. `Tool Pack` owns this sentence.
    const toolPack = GLOSSARY_ENTRIES.find((e) => e.term === "Tool Pack")!;
    expect(toolPack.definition).toMatch(/only attach the packs/i);

    for (const entry of [portal(), portalMessage(), portalResult()]) {
      expect(entry.definition).not.toMatch(/only attach the packs/i);
    }
    // …but Portal points at it.
    expect(portal().relatedTerms).toContain("Tool Pack");
  });

  it("cross-links the terms the practices depend on", () => {
    expect(portal().relatedTerms).toEqual(
      expect.arrayContaining([
        "Station",
        "Portal Message",
        "Portal Result",
        "Entity Record",
        "Connector Instance",
        "Tool Pack",
      ])
    );
    expect(portalMessage().relatedTerms).toEqual(
      expect.arrayContaining(["Portal", "Station", "Entity Record"])
    );
    expect(portalResult().relatedTerms).toEqual(
      expect.arrayContaining(["Portal", "Portal Message", "Pinned Result"])
    );
  });

  it("extends the definitions rather than replacing them", () => {
    // Each entry keeps the sentence it always had, and grows past it.
    expect(portal().definition).toMatch(
      /^A chat session where you ask questions about the data in a station/
    );
    expect(portalMessage().definition).toMatch(
      /^A single user prompt or assistant reply within a portal session\./
    );
    expect(portalResult().definition).toMatch(/^A piece of structured output/);
    for (const entry of [portal(), portalMessage(), portalResult()]) {
      expect(typeof entry.definition).toBe("string");
      expect(entry.definition.length).toBeGreaterThan(240);
    }
  });

  it("uses no markdown lists or fenced code in the edited entries", () => {
    // `GlossaryProse` styles p/code/pre/strong but not ul/li, and
    // `definition` ships verbatim into the marketing site's JSON-LD — so a
    // list renders unstyled in-app and as literal syntax in structured data.
    for (const entry of [portal(), portalMessage(), portalResult()]) {
      for (const source of [entry.definition, entry.example ?? ""]) {
        expect(source).not.toMatch(/^\s*[-*]\s+/m);
        expect(source).not.toMatch(/```/);
      }
    }
  });

  it("surfaces the guidance to a reader searching Help", () => {
    const hits = filterGlossary(GLOSSARY_ENTRIES, { query: "imported" });
    expect(hits.map((e) => e.term)).toContain("Portal");
  });
});
