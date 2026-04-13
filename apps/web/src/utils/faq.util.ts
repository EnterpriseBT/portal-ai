// ── Categories ──────────────────────────────────────────────────────

export enum FAQCategory {
  GettingStarted = "getting-started",
  Data = "data",
  Organization = "organization",
  Analytics = "analytics",
  Jobs = "jobs",
}

export const FAQ_CATEGORY_LABELS: Record<FAQCategory, string> = {
  [FAQCategory.GettingStarted]: "Getting Started",
  [FAQCategory.Data]: "Working with Data",
  [FAQCategory.Organization]: "Organization & Grouping",
  [FAQCategory.Analytics]: "Analytics & Portals",
  [FAQCategory.Jobs]: "Jobs & Background Tasks",
};

// ── Entry shape ─────────────────────────────────────────────────────

export interface FAQEntry {
  question: string;
  answer: string;
  category: FAQCategory;
  relatedGlossaryTerms?: string[];
}

// ── Dataset ─────────────────────────────────────────────────────────

export const FAQ_ENTRIES: FAQEntry[] = [
  // Getting Started
  {
    question: "What is Portals.ai and what can I do with it?",
    answer:
      "Portals.ai is a workspace for connecting your data sources, normalizing them into a shared vocabulary, and asking questions about them in chat-style sessions called portals. You can pull in data from CSVs, databases, and other tools, define how their fields relate, and then explore or analyze the combined data through portals.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Connector Instance", "Station", "Portal"],
  },
  {
    question: "How do I connect my first data source?",
    answer:
      "Open the Connectors page, switch to the Catalog tab, and pick a connector definition (for example, CSV). Configure it with your file or credentials — that creates a connector instance you can use across stations.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Connector Definition", "Connector Instance"],
  },
  {
    question: "What is a Station and why do I need one?",
    answer:
      "A station is a workspace that bundles together the connector instances and tool packs you want to analyze together. You need at least one station before you can open a portal, because the portal uses the station's data and tools to answer your questions.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Station", "Tool Pack", "Portal", "Default Station"],
  },
  {
    question: "How do I start asking questions about my data?",
    answer:
      "From a station, click \"New Portal\" to open a chat session. Type your question — the assistant will use the station's tool packs (data query, statistics, etc.) and the connected data to respond. You can pin useful results for quick access later.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Portal", "Portal Message", "Pinned Result"],
  },

  // Working with Data
  {
    question: "What's the difference between a connector and an entity?",
    answer:
      "A connector instance is the live link to a source (your CSV file, your database). A connector entity is one specific data object exposed through that connection — a single sheet, table, or collection. One connector instance often surfaces several connector entities.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Connector Instance", "Connector Entity"],
  },
  {
    question: "What are column definitions and why do they matter?",
    answer:
      "Column definitions are reusable field specifications — name, data type, validation rules, canonical format — shared across your whole organization. They let different connector entities map their raw fields to the same shared vocabulary, so analysis can compare like with like.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Column Definition", "Field Mapping", "Data Types"],
  },
  {
    question: "What are field mappings?",
    answer:
      "A field mapping links a raw field on a connector entity to a column definition. Mapping the CRM's \"Email Address\" and the CSV's \"email\" to the same email column definition is what makes records from different sources comparable.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Field Mapping", "Column Definition", "Normalized Data"],
  },
  {
    question: "What do the access modes (import, live, hybrid) mean?",
    answer:
      "Import mode pulls a copy of the data into Portals.ai and works against the cached copy. Live mode queries the source on demand, so the data is always current but slower to read. Hybrid mode caches the data but refreshes it from the source on a schedule.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Access Mode", "Connector Entity", "Sync"],
  },
  {
    question: "How do I validate my data?",
    answer:
      "Validation is driven by your column definitions: each one can declare a data type and a regex validation pattern. When records are synced or written, those rules run automatically — invalid records are flagged so you can fix them. Use \"Re-validate\" on an entity to re-run the rules across all records.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Validation Pattern", "Column Definition", "Entity Record"],
  },
  {
    question: "What happens when I sync an entity?",
    answer:
      "Syncing pulls the latest records from the connector source into Portals.ai. New records are added, changed records are updated, and the entity's record count and last-sync timestamp are refreshed. A sync runs as a background job you can monitor on the Jobs page.",
    category: FAQCategory.Data,
    relatedGlossaryTerms: ["Sync", "Connector Entity", "Job"],
  },

  // Organization & Grouping
  {
    question: "What are entity groups and when should I use them?",
    answer:
      "Entity groups bundle related connector entities from different sources together — for example, your CRM Contacts and your support tool's Users — so you can analyze them as one population. Use them when the same real-world thing (a person, a company, an account) appears in multiple sources.",
    category: FAQCategory.Organization,
    relatedGlossaryTerms: ["Entity Group", "Entity Group Member", "Link Field"],
  },
  {
    question: "What is a \"link field\" in an entity group?",
    answer:
      "The link field is the shared identifier used to match records across the group's members. If you pick \"email\" as the link field, two records — one from each source — are treated as the same entity when they share an email address. The Overlap Preview shows how well your link field actually matches data across members.",
    category: FAQCategory.Organization,
    relatedGlossaryTerms: ["Link Field", "Entity Group", "Overlap Preview"],
  },
  {
    question: "How do tags work?",
    answer:
      "Entity tags are color-coded labels you attach to your entities to group and filter them. Tags appear as colored badges throughout the app and let you narrow long lists down to the subset you care about — for example, tagging all customer-data entities so you can filter to them in one click.",
    category: FAQCategory.Organization,
    relatedGlossaryTerms: ["Entity Tag", "Connector Entity"],
  },

  // Analytics & Portals
  {
    question: "What are tool packs?",
    answer:
      "Tool packs are bundles of capabilities you enable on a station — data query, statistics, regression, financial analysis, web search, and entity management. The packs you turn on determine what kinds of work the assistant can do during portal sessions on that station.",
    category: FAQCategory.Analytics,
    relatedGlossaryTerms: ["Tool Pack", "Station", "Portal"],
  },
  {
    question: "How do I save results from a portal session?",
    answer:
      "When the assistant returns a chart, table, or text block you want to keep, click the pin action on that portal result. Pinned results show up on your dashboard and on the Pinned Results page so you can return to them without rerunning the conversation.",
    category: FAQCategory.Analytics,
    relatedGlossaryTerms: ["Portal Result", "Pinned Result", "Portal Message"],
  },
  {
    question: "What's the difference between a portal and a portal result?",
    answer:
      "A portal is the whole chat session — the conversation, the messages, the context. A portal result is a single piece of structured output (a chart, a table, a text block) produced by the assistant inside one of the messages. You pin portal results, not portals.",
    category: FAQCategory.Analytics,
    relatedGlossaryTerms: ["Portal", "Portal Message", "Portal Result", "Pinned Result"],
  },

  // Jobs & Background Tasks
  {
    question: "What do job statuses mean?",
    answer:
      "Pending — queued, not started yet. Active — currently running. Completed — finished successfully. Failed — stopped because of an error. Stalled — appears stuck and may need attention. Cancelled — stopped by you. Awaiting confirmation — waiting on input from you before continuing.",
    category: FAQCategory.Jobs,
    relatedGlossaryTerms: ["Job Status", "Job"],
  },
  {
    question: "Why did my job fail?",
    answer:
      "Open the job from the Jobs page to see the error details — the most common causes are invalid source credentials, malformed data that fails column-definition validation, network timeouts to the source, or insufficient permissions on the connector. Fix the underlying issue and re-run the job.",
    category: FAQCategory.Jobs,
    relatedGlossaryTerms: ["Job", "Job Status", "Validation Pattern"],
  },
];

// ── Filter helper ───────────────────────────────────────────────────

export interface FAQFilter {
  query?: string;
  category?: FAQCategory;
}

export const filterFAQ = (
  entries: FAQEntry[],
  filter: FAQFilter = {}
): FAQEntry[] => {
  const { query, category } = filter;
  const normalizedQuery = query?.trim().toLowerCase() ?? "";

  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    if (!normalizedQuery) return true;
    return (
      entry.question.toLowerCase().includes(normalizedQuery) ||
      entry.answer.toLowerCase().includes(normalizedQuery)
    );
  });
};
