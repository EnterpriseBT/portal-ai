import { ApplicationRoute } from "./routes.util";

// ── Categories ──────────────────────────────────────────────────────

export enum GlossaryCategory {
  DataSources = "data-sources",
  DataModeling = "data-modeling",
  Organization = "organization",
  Analytics = "analytics",
  System = "system",
}

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  [GlossaryCategory.DataSources]: "Data Sources",
  [GlossaryCategory.DataModeling]: "Data Modeling",
  [GlossaryCategory.Organization]: "Organization",
  [GlossaryCategory.Analytics]: "Analytics",
  [GlossaryCategory.System]: "System",
};

// ── Entry shape ─────────────────────────────────────────────────────

export interface GlossaryEntry {
  term: string;
  category: GlossaryCategory;
  definition: string;
  example?: string;
  relatedTerms?: string[];
  pageRoute?: string;
}

// ── Dataset ─────────────────────────────────────────────────────────

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  // Data Sources
  {
    term: "Connector Definition",
    category: GlossaryCategory.DataSources,
    definition:
      "A blueprint describing a type of data source you can connect to — for example, CSV uploads or a specific database engine.",
    example:
      "The CSV connector definition is the template; you can create many CSV connector instances from it.",
    relatedTerms: ["Connector Instance", "Connector Entity"],
    pageRoute: ApplicationRoute.Connectors,
  },
  {
    term: "Connector Instance",
    category: GlossaryCategory.DataSources,
    definition:
      "A live connection to one of your data sources, created by configuring a connector definition with your credentials or files.",
    example:
      "You upload a CSV of customer data — that creates a connector instance named \"Q1 Customers CSV\".",
    relatedTerms: ["Connector Definition", "Connector Entity", "Station"],
    pageRoute: ApplicationRoute.Connectors,
  },
  {
    term: "Connector Entity",
    category: GlossaryCategory.DataSources,
    definition:
      "A single data object (table, sheet, or collection) exposed by a connector instance.",
    example:
      "A database connector instance might expose Customers, Orders, and Products as separate connector entities.",
    relatedTerms: ["Connector Instance", "Entity Record", "Field Mapping"],
    pageRoute: ApplicationRoute.Entities,
  },
  {
    term: "Entity Record",
    category: GlossaryCategory.DataSources,
    definition:
      "A single row of data inside a connector entity — one customer, one order, one transaction.",
    example:
      "Each row in your customers CSV becomes one entity record under the Customers connector entity.",
    relatedTerms: ["Connector Entity", "Normalized Data", "Sync"],
    pageRoute: ApplicationRoute.Entities,
  },
  {
    term: "Sync",
    category: GlossaryCategory.DataSources,
    definition:
      "Pulling the latest data from a connector into Portals.ai so your entities stay current.",
    example:
      "Click \"Sync\" on a connector instance to fetch any new or changed records from the source.",
    relatedTerms: ["Connector Instance", "Entity Record", "Job"],
    pageRoute: ApplicationRoute.Entities,
  },
  // Data Modeling
  {
    term: "Column Definition",
    category: GlossaryCategory.DataModeling,
    definition:
      "A reusable field specification — name, type, and validation rules — that your entities can map their fields to.",
    example:
      "Define an \"email\" column once with email-pattern validation, then map it across every entity that has email data.",
    relatedTerms: ["Field Mapping", "Data Types", "Validation Pattern"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Field Mapping",
    category: GlossaryCategory.DataModeling,
    definition:
      "A link between a raw field on a connector entity and a shared column definition, so different sources can be normalized to the same shape.",
    example:
      "Map the \"Email Address\" field from your CRM and the \"email\" field from your CSV to the same email column definition.",
    relatedTerms: ["Column Definition", "Connector Entity", "Normalized Data"],
    pageRoute: ApplicationRoute.Entities,
  },
  {
    term: "Data Types",
    category: GlossaryCategory.DataModeling,
    definition:
      "The supported value types for a column definition: string, number, boolean, date, datetime, enum, json, array, reference, and reference-array.",
    example:
      "A \"price\" column uses the number type; a \"tags\" column uses the array type.",
    relatedTerms: ["Column Definition", "Validation Pattern"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Validation Pattern",
    category: GlossaryCategory.DataModeling,
    definition:
      "A regular expression that incoming values must match for a record to be considered valid.",
    example:
      "An email column might use the pattern `^[^@]+@[^@]+\\.[^@]+$` to reject malformed addresses.",
    relatedTerms: ["Column Definition", "Normalized Data"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Canonical Format",
    category: GlossaryCategory.DataModeling,
    definition:
      "A standard display form for a column's values — for example, ISO-8601 for dates — applied consistently across sources.",
    example:
      "A canonical date format ensures \"2026-04-13\" is shown identically whether the source stored it as \"4/13/26\" or \"13 Apr 2026\".",
    relatedTerms: ["Column Definition", "Normalized Data"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Primary Key",
    category: GlossaryCategory.DataModeling,
    definition:
      "The field on a connector entity that uniquely identifies each record.",
    example:
      "A Customers entity might use \"customer_id\" as its primary key.",
    relatedTerms: ["Connector Entity", "Entity Record"],
    pageRoute: ApplicationRoute.Entities,
  },
  {
    term: "Normalized Data",
    category: GlossaryCategory.DataModeling,
    definition:
      "Record values transformed through field mappings and column definitions, so every source speaks the same vocabulary.",
    example:
      "After normalization, a CRM contact and a CSV row both surface their email under the same shared field.",
    relatedTerms: ["Field Mapping", "Column Definition", "Canonical Format"],
    pageRoute: ApplicationRoute.Entities,
  },

  // Organization
  {
    term: "Entity Group",
    category: GlossaryCategory.Organization,
    definition:
      "A bundle of related connector entities from different sources, linked by a shared field so you can analyze them as one population.",
    example:
      "Group your CRM Contacts and your support tool Users together so the same person appears once across both sources.",
    relatedTerms: ["Entity Group Member", "Link Field", "Overlap Preview"],
    pageRoute: ApplicationRoute.EntityGroups,
  },
  {
    term: "Entity Group Member",
    category: GlossaryCategory.Organization,
    definition:
      "An individual connector entity that belongs to an entity group.",
    example:
      "Inside the \"People\" entity group, both the CRM Contacts entity and the support Users entity are members.",
    relatedTerms: ["Entity Group", "Link Field"],
    pageRoute: ApplicationRoute.EntityGroups,
  },
  {
    term: "Link Field",
    category: GlossaryCategory.Organization,
    definition:
      "The field used to match records across the members of an entity group — typically a shared identifier such as email.",
    example:
      "Use \"email\" as the link field so the same person in your CRM and your billing system can be recognized as one.",
    relatedTerms: ["Entity Group", "Entity Group Member", "Overlap Preview"],
    pageRoute: ApplicationRoute.EntityGroups,
  },
  {
    term: "Entity Tag",
    category: GlossaryCategory.Organization,
    definition:
      "A color-coded label you attach to entities to categorize and filter them.",
    example:
      "Tag all your customer-data entities with a green \"Customers\" tag for quick filtering on the entities page.",
    relatedTerms: ["Connector Entity"],
    pageRoute: ApplicationRoute.Tags,
  },
  {
    term: "Overlap Preview",
    category: GlossaryCategory.Organization,
    definition:
      "A summary of how many records match between the members of an entity group, based on the link field.",
    example:
      "An overlap preview might show that 78% of CRM contacts are also present in your billing system.",
    relatedTerms: ["Entity Group", "Link Field"],
    pageRoute: ApplicationRoute.EntityGroups,
  },

  // Analytics
  {
    term: "Station",
    category: GlossaryCategory.Analytics,
    definition:
      "A workspace that groups connector instances and tool packs together so you can analyze them in a portal.",
    example:
      "Create a \"Sales\" station with your CRM and billing connectors plus the statistics tool pack.",
    relatedTerms: ["Connector Instance", "Tool Pack", "Portal", "Default Station"],
    pageRoute: ApplicationRoute.Stations,
  },
  {
    term: "Tool Pack",
    category: GlossaryCategory.Analytics,
    definition:
      "A bundle of capabilities — like data querying, statistics, regression, financial analysis, web search, or entity management — that you enable on a station.",
    example:
      "Enable the regression tool pack on a station so the assistant can run regression analysis during a portal session.",
    relatedTerms: ["Station", "Portal"],
    pageRoute: ApplicationRoute.Stations,
  },
  {
    term: "Portal",
    category: GlossaryCategory.Analytics,
    definition:
      "A chat session where you ask questions about the data in a station; the assistant answers using the station's tool packs.",
    example:
      "Open a portal on the Sales station and ask, \"What was last quarter's revenue by region?\"",
    relatedTerms: ["Station", "Portal Message", "Portal Result"],
  },
  {
    term: "Portal Message",
    category: GlossaryCategory.Analytics,
    definition:
      "A single user prompt or assistant reply within a portal session.",
    example:
      "Each question you type and each answer you receive is a portal message.",
    relatedTerms: ["Portal", "Portal Result"],
  },
  {
    term: "Portal Result",
    category: GlossaryCategory.Analytics,
    definition:
      "A piece of structured output — a chart, table, or text block — produced by the assistant in a portal message.",
    example:
      "A revenue chart returned by the assistant is a portal result that you can pin for later.",
    relatedTerms: ["Portal", "Pinned Result"],
  },
  {
    term: "Pinned Result",
    category: GlossaryCategory.Analytics,
    definition:
      "A portal result you've saved for quick access from the dashboard or the pinned-results page.",
    example:
      "Pin a quarterly-revenue chart so it's one click away from the dashboard.",
    relatedTerms: ["Portal Result", "Default Station"],
    pageRoute: ApplicationRoute.PortalResults,
  },

  // System
  {
    term: "Job",
    category: GlossaryCategory.System,
    definition:
      "A background task — file uploads, syncs, system checks, or revalidations — that the platform runs on your behalf.",
    example:
      "Uploading a large CSV creates a file_upload job that runs in the background while you keep working.",
    relatedTerms: ["Job Status", "Sync"],
    pageRoute: ApplicationRoute.Jobs,
  },
  {
    term: "Job Status",
    category: GlossaryCategory.System,
    definition:
      "The current state of a job: pending, active, completed, failed, stalled, cancelled, or awaiting confirmation.",
    example:
      "A sync job moves from pending to active to completed once it finishes successfully.",
    relatedTerms: ["Job"],
    pageRoute: ApplicationRoute.Jobs,
  },
  {
    term: "Organization",
    category: GlossaryCategory.System,
    definition:
      "Your top-level workspace; everything you create — connectors, entities, stations, column definitions — belongs to your organization.",
    example:
      "Column definitions are shared across your whole organization, so every team uses the same vocabulary.",
    relatedTerms: ["Column Definition", "Default Station"],
  },
  {
    term: "Default Station",
    category: GlossaryCategory.System,
    definition:
      "The station opened by default on your dashboard and used when you launch a portal without picking a station explicitly.",
    example:
      "Set your most-used station as the default so the dashboard surfaces its portals and pinned results first.",
    relatedTerms: ["Station", "Pinned Result"],
    pageRoute: ApplicationRoute.Stations,
  },
];

// ── Filter helper ───────────────────────────────────────────────────

export interface GlossaryFilter {
  query?: string;
  category?: GlossaryCategory;
}

export const filterGlossary = (
  entries: GlossaryEntry[],
  filter: GlossaryFilter = {}
): GlossaryEntry[] => {
  const { query, category } = filter;
  const normalizedQuery = query?.trim().toLowerCase() ?? "";

  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (!normalizedQuery) return true;
    return (
      entry.term.toLowerCase().includes(normalizedQuery) ||
      entry.definition.toLowerCase().includes(normalizedQuery)
    );
  });
};
