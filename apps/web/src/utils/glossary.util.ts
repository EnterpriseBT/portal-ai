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
      'You upload a CSV of customer data — that creates a connector instance named "Q1 Customers CSV".',
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
      'Click "Sync" on a connector instance to fetch any new or changed records from the source.',
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
      'Define an "email" column once with email-pattern validation, then map it across every entity that has email data.',
    relatedTerms: ["Field Mapping", "Data Types", "Validation Pattern"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Field Mapping",
    category: GlossaryCategory.DataModeling,
    definition:
      "A link between a raw field on a connector entity and a shared column definition, so different sources can be normalized to the same shape.",
    example:
      'Map the "Email Address" field from your CRM and the "email" field from your CSV to the same email column definition.',
    relatedTerms: ["Column Definition", "Connector Entity", "Normalized Data"],
    pageRoute: ApplicationRoute.Entities,
  },
  {
    term: "Data Types",
    category: GlossaryCategory.DataModeling,
    definition:
      "The supported value types for a column definition: string, number, boolean, date, datetime, enum, json, array, reference, and reference-array.",
    example:
      'A "price" column uses the number type; a "tags" column uses the array type.',
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
      'A canonical date format ensures "2026-04-13" is shown identically whether the source stored it as "4/13/26" or "13 Apr 2026".',
    relatedTerms: ["Column Definition", "Normalized Data"],
    pageRoute: ApplicationRoute.ColumnDefinitions,
  },
  {
    term: "Primary Key",
    category: GlossaryCategory.DataModeling,
    definition:
      "The field on a connector entity that uniquely identifies each record.",
    example: 'A Customers entity might use "customer_id" as its primary key.',
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
      'Inside the "People" entity group, both the CRM Contacts entity and the support Users entity are members.',
    relatedTerms: ["Entity Group", "Link Field"],
    pageRoute: ApplicationRoute.EntityGroups,
  },
  {
    term: "Link Field",
    category: GlossaryCategory.Organization,
    definition:
      "The field used to match records across the members of an entity group — typically a shared identifier such as email.",
    example:
      'Use "email" as the link field so the same person in your CRM and your billing system can be recognized as one.',
    relatedTerms: ["Entity Group", "Entity Group Member", "Overlap Preview"],
    pageRoute: ApplicationRoute.EntityGroups,
  },
  {
    term: "Entity Tag",
    category: GlossaryCategory.Organization,
    definition:
      "A color-coded label you attach to entities to categorize and filter them.",
    example:
      'Tag all your customer-data entities with a green "Customers" tag for quick filtering on the entities page.',
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
      'Create a "Sales" station with your CRM and billing connectors plus the statistics tool pack.',
    relatedTerms: [
      "Connector Instance",
      "Tool Pack",
      "Portal",
      "Default Station",
    ],
    pageRoute: ApplicationRoute.Stations,
  },
  {
    term: "Tool",
    category: GlossaryCategory.Analytics,
    definition:
      "A single function the assistant can call during a portal session — for example, `correlate`, `regression`, or a custom `lookup_company`. Tools come grouped into toolpacks; a station decides which toolpacks are enabled, which determines the set of tools the model can choose from on each turn. Tools shine for analytical work over the station's data: statistical tests, regressions, time-series decomposition, financial math. Use connectors for data storage and lookup; reach for tools when the answer requires computation, not retrieval.",
    example:
      "Inside a portal session, the assistant calls the `correlate` tool to compute the Pearson correlation between two columns of an entity, then `visualize_d3` to render the result as an interactive chart.",
    relatedTerms: ["Tool Pack", "Custom Toolpack", "Connector Instance"],
  },
  {
    term: "Tool Pack",
    category: GlossaryCategory.Analytics,
    definition:
      "A bundle of related tools the assistant can use in a portal session. Toolpacks are the *unit you enable on a station*; tools are the *individual functions* inside them. Built-in packs cover data querying, statistics, regression, financial analysis, web search, and entity management. Organizations can also register custom packs that call out to their own webhook services. Every tool inside an enabled pack costs context-window budget on every portal turn — keep packs small and focused on a single domain, and only attach the packs a station absolutely needs.",
    example:
      "Enable the regression tool pack on a station so the assistant has the `regression`, `forecast`, and `decompose` tools available for time-series questions.",
    relatedTerms: ["Tool", "Station", "Portal", "Custom Toolpack"],
    pageRoute: ApplicationRoute.Toolpacks,
  },
  {
    term: "Custom Toolpack",
    category: GlossaryCategory.Analytics,
    definition:
      "A user-registered toolpack backed by your organization's webhook endpoints. Define a schema endpoint (lists the tools and their input schemas), a runtime endpoint (the assistant POSTs `{tool, input}` here per call), and an optional metadata endpoint (docs and examples). Once registered, attach the pack to any station the same way you enable a built-in pack. Custom toolpacks are most useful for *analytical* operations specific to your domain — a risk-scoring algorithm, an LTV model, a domain-specific anomaly detector. For raw data storage and lookup, prefer connectors: connectors materialize data into entity records that the data-query toolpack can already SELECT against, without burning context window on per-record lookups. Every outbound call is HMAC-signed with a per-toolpack secret so your server can cryptographically verify the request came from us — see the **Signing Secret** entry for the wire format.",
    example:
      'Register a "customer_intel" pack with a `score_churn_risk` tool that calls your in-house ML service. Attach it to your retention station and the assistant can compute risk scores mid-session — something a SQL query alone can\'t do.',
    relatedTerms: ["Tool", "Tool Pack", "Station", "Portal", "Signing Secret"],
    pageRoute: ApplicationRoute.Toolpacks,
  },
  {
    term: "Signing Secret",
    category: GlossaryCategory.Analytics,
    definition:
      "A per-toolpack HMAC secret (`whsec_*` prefix, 32 random bytes) used to sign every outbound webhook call. Generated server-side at registration and shown to you exactly once — copy it into your toolpack server's environment immediately. The secret is encrypted at rest; subsequent reads only confirm presence, never plaintext. To re-view a secret, rotate it from the toolpack's edit dialog: a fresh value is generated, the old one is invalidated immediately, and the new plaintext is shown once.\n\nEvery outbound call carries three headers:\n\n```\nX-Portalai-Timestamp: <unix-seconds>\nX-Portalai-Webhook-Id: <uuid>\nX-Portalai-Signature: v1=<hex>\n```\n\nThe signature is `HMAC-SHA256` over the string `<timestamp>.<webhook-id>.<body>` (empty body for GETs). Your server should reject requests where the timestamp is more than 300 seconds old (replay window) or where the recomputed signature doesn't match using a constant-time comparison.",
    example:
      "Register a toolpack, copy the displayed `whsec_...` secret into your server's environment (e.g. `TOOLPACK_SIGNING_SECRET`), and verify every incoming request before processing — recompute the HMAC over `<ts>.<id>.<rawBody>` and compare with `crypto.timingSafeEqual` (Node) / `hmac.compare_digest` (Python) / `hmac.Equal` (Go).",
    relatedTerms: ["Custom Toolpack", "Tool Pack"],
    pageRoute: ApplicationRoute.Toolpacks,
  },
  {
    term: "Portal",
    category: GlossaryCategory.Analytics,
    definition:
      "A chat session where you ask questions about the data in a station; the assistant answers using the station's tool packs.",
    example:
      'Open a portal on the Sales station and ask, "What was last quarter\'s revenue by region?"',
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
    term: "Query Handle",
    category: GlossaryCategory.Analytics,
    definition:
      "A lightweight reference to a result set that's too large to show inline. Small results come back in the message directly; larger ones return a handle, and the full rows stream into the table or chart without the assistant having to read them all. Either way you see every row.",
    example:
      "Asking for every order returns a query handle — the table loads all rows, while the assistant only keeps a small preview for follow-up questions.",
    relatedTerms: ["Portal Result"],
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
      "A background task — syncs, system checks, or revalidations — that the platform runs on your behalf.",
    example:
      "Re-validating an entity definition spawns a revalidation job that runs in the background while you keep working.",
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
  {
    term: "Subscription Plan",
    category: GlossaryCategory.System,
    definition:
      "The plan your organization is on, which sets its monthly usage allocations. The organization owner can upgrade to a paid plan from Settings → Subscription & Billing; payment is handled by Stripe's secure checkout.",
    example:
      "Upgrading from Standard to a paid plan raises your monthly metered and expensive usage allocations.",
    relatedTerms: ["Organization", "Billing Portal"],
    pageRoute: ApplicationRoute.Settings,
  },
  {
    term: "Billing Portal",
    category: GlossaryCategory.System,
    definition:
      "A secure Stripe-hosted page where the organization owner manages the subscription — changing plans, updating payment methods, viewing invoices, and cancelling. Opened from Settings → Subscription & Billing once subscribed.",
    example:
      "To switch plans or update your card, open Manage subscription — everything happens in the billing portal, and your plan here updates automatically.",
    relatedTerms: ["Subscription Plan", "Organization"],
    pageRoute: ApplicationRoute.Settings,
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
