import { GlossaryEntry } from "@portalai/core/content";

import { ApplicationRoute } from "./routes.util";

/**
 * Glossary term → in-app route (#311).
 *
 * The glossary itself moved to `@portalai/core/content` so the public
 * marketing site can render the same vocabulary. Routes could not go with
 * it: they point into the authenticated app, which an anonymous visitor
 * cannot follow, and importing `ApplicationRoute` there would couple the
 * shared package to this app's router.
 *
 * So the table lives here and is re-attached at read time. A term absent
 * from this map simply renders without a link — adding a glossary entry
 * never requires touching this file.
 */
export const GLOSSARY_PAGE_ROUTES: Partial<Record<string, ApplicationRoute>> = {
  // Data Sources
  "Connector Definition": ApplicationRoute.Connectors,
  "Connector Instance": ApplicationRoute.Connectors,
  "Connector Entity": ApplicationRoute.Entities,
  "Entity Record": ApplicationRoute.Entities,
  Sync: ApplicationRoute.Entities,
  // Data Modeling
  "Column Definition": ApplicationRoute.ColumnDefinitions,
  "Field Mapping": ApplicationRoute.Entities,
  "Data Types": ApplicationRoute.ColumnDefinitions,
  "Validation Pattern": ApplicationRoute.ColumnDefinitions,
  "Canonical Format": ApplicationRoute.ColumnDefinitions,
  "Primary Key": ApplicationRoute.Entities,
  "Normalized Data": ApplicationRoute.Entities,
  // Organization
  "Entity Group": ApplicationRoute.EntityGroups,
  "Entity Group Member": ApplicationRoute.EntityGroups,
  "Link Field": ApplicationRoute.EntityGroups,
  "Entity Tag": ApplicationRoute.Tags,
  "Overlap Preview": ApplicationRoute.EntityGroups,
  // Analytics
  Station: ApplicationRoute.Stations,
  "Tool Pack": ApplicationRoute.Toolpacks,
  "Plan Entitlement": ApplicationRoute.Toolpacks,
  "Custom Toolpack": ApplicationRoute.Toolpacks,
  "Signing Secret": ApplicationRoute.Toolpacks,
  "Pinned Result": ApplicationRoute.PortalResults,
  // System
  Job: ApplicationRoute.Jobs,
  "Job Status": ApplicationRoute.Jobs,
  "Default Station": ApplicationRoute.Stations,
  "Subscription Plan": ApplicationRoute.Settings,
  "Billing Portal": ApplicationRoute.Settings,
};

/**
 * Re-attach in-app routes to the shared glossary. Returns a new array of new
 * objects — the imported `GLOSSARY_ENTRIES` are shared module state and must
 * never be mutated. Entries with no mapped route pass through unchanged.
 */
export function withPageRoutes(entries: GlossaryEntry[]): GlossaryEntry[] {
  return entries.map((entry) => {
    const pageRoute = GLOSSARY_PAGE_ROUTES[entry.term];
    return pageRoute ? { ...entry, pageRoute } : entry;
  });
}
