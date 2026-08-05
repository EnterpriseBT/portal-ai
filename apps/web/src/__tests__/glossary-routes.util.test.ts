/**
 * Glossary route re-attachment (#311) — the app-side half of the
 * `@portalai/core/content` split. The vocabulary is shared; the links into
 * the authenticated app are not, so they live here and are grafted on at
 * read time.
 *
 * These assertions stayed behind when `glossary.util.test.ts` moved to core.
 */

import { GLOSSARY_ENTRIES } from "@portalai/core/content";

import {
  GLOSSARY_PAGE_ROUTES,
  withPageRoutes,
} from "../utils/glossary-routes.util";

describe("GLOSSARY_PAGE_ROUTES", () => {
  it("maps only terms that actually exist in the shared glossary", () => {
    const terms = new Set(GLOSSARY_ENTRIES.map((e) => e.term));
    const orphans = Object.keys(GLOSSARY_PAGE_ROUTES).filter(
      (term) => !terms.has(term)
    );
    // An orphan means a term was renamed in core and this table wasn't —
    // the link silently disappears from Help. Catch it here.
    expect(orphans).toEqual([]);
  });

  it("maps every route to an in-app path, never an absolute URL", () => {
    for (const route of Object.values(GLOSSARY_PAGE_ROUTES)) {
      expect(route!.startsWith("/")).toBe(true);
      expect(route!.startsWith("http")).toBe(false);
    }
  });
});

describe("withPageRoutes", () => {
  it("returns every entry — attaching routes never drops or adds one", () => {
    const out = withPageRoutes(GLOSSARY_ENTRIES);
    expect(out).toHaveLength(GLOSSARY_ENTRIES.length);
    expect(out.map((e) => e.term)).toEqual(GLOSSARY_ENTRIES.map((e) => e.term));
  });

  it("attaches the mapped route to each mapped term", () => {
    const byTerm = new Map(
      withPageRoutes(GLOSSARY_ENTRIES).map((e) => [e.term, e])
    );
    for (const [term, route] of Object.entries(GLOSSARY_PAGE_ROUTES)) {
      expect(byTerm.get(term)?.pageRoute).toBe(route);
    }
  });

  it("leaves unmapped terms without a pageRoute", () => {
    const unmapped = withPageRoutes(GLOSSARY_ENTRIES).filter(
      (e) => !(e.term in GLOSSARY_PAGE_ROUTES)
    );
    expect(unmapped.every((e) => e.pageRoute === undefined)).toBe(true);
  });

  it("does not mutate the shared module-level dataset", () => {
    withPageRoutes(GLOSSARY_ENTRIES);
    expect(GLOSSARY_ENTRIES.every((e) => e.pageRoute === undefined)).toBe(true);
  });
});
