/**
 * The product glossary — the canonical vocabulary, shared by the in-app Help
 * view and the public marketing site (#311).
 *
 * Moved here from `apps/web/src/utils` so both surfaces name a concept the
 * same way. `pageRoute` stays in the type but carries NO values here: a
 * route into the authenticated app is meaningless to an anonymous visitor,
 * and importing `ApplicationRoute` would couple this package to the web
 * app's router. `apps/web` re-attaches the routes at read time via
 * `withPageRoutes` (`utils/glossary-routes.util.ts`).
 *
 * This module must import nothing — it is pure data consumed at build time
 * by a static site with no bundler assumptions.
 */

// ── Entry slug ──────────────────────────────────────────────────────

/**
 * The URL-safe slug for a glossary term or an FAQ question.
 *
 * This is a **contract**, not a display detail: it appears in the
 * `#glossary-entry-<slug>` / `#faq-entry-<slug>` fragments that make a Help
 * entry addressable (#365), in the `data-testid` of both Help lists, and in
 * the Help links the assistant builds server-side (#367). Two copies of the
 * rule that must agree byte-for-byte across a network boundary would be a bug
 * waiting for the first term with punctuation in it, so it lives here beside
 * the content it slugs.
 *
 * It supersedes the two private slugifiers that lived in `apps/web`'s
 * `GlossaryList` and `FAQList` — the stricter FAQ rule, which every current
 * glossary term already satisfies (pinned in the tests).
 */
export const contentEntrySlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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
      "A blueprint describing a type of data source you can connect to — File Upload (CSV and Excel files), Google Sheets, Excel on OneDrive, or a REST API.",
    example:
      "The File Upload connector definition is the template; you can create many file-upload connector instances from it.",
    relatedTerms: ["Connector Instance", "Connector Entity"],
  },
  {
    term: "Connector Instance",
    category: GlossaryCategory.DataSources,
    definition:
      "A live connection to one of your data sources, created by configuring a connector definition with your credentials or files.",
    example:
      'You upload a CSV of customer data — that creates a connector instance named "Q1 Customers CSV".',
    relatedTerms: ["Connector Definition", "Connector Entity", "Station"],
  },
  {
    term: "Connector Entity",
    category: GlossaryCategory.DataSources,
    definition:
      "A single data object (table, sheet, or collection) exposed by a connector instance.",
    example:
      "An Excel workbook connector instance might expose Customers, Orders, and Products as separate connector entities, one per sheet region.",
    relatedTerms: ["Connector Instance", "Entity Record", "Field Mapping"],
  },
  {
    term: "Entity Record",
    category: GlossaryCategory.DataSources,
    definition:
      "A single row of data inside a connector entity — one customer, one order, one transaction.",
    example:
      "Each row in your customers CSV becomes one entity record under the Customers connector entity.",
    relatedTerms: ["Connector Entity", "Normalized Data", "Sync"],
  },
  {
    term: "Sync",
    category: GlossaryCategory.DataSources,
    definition:
      "Pulling the latest data from a connector into Portals AI so your entities stay current. A sync runs when you start it; while it runs, the connector's entities are locked from edits.",
    example:
      'Click "Sync" on a connector instance to fetch any new or changed records from the source.',
    relatedTerms: ["Connector Instance", "Entity Record", "Job"],
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
  },
  {
    term: "Field Mapping",
    category: GlossaryCategory.DataModeling,
    definition:
      "A link between a raw field on a connector entity and a shared column definition, so different sources can be normalized to the same shape.",
    example:
      'Map the "Email Address" field from your CRM and the "email" field from your CSV to the same email column definition.',
    relatedTerms: ["Column Definition", "Connector Entity", "Normalized Data"],
  },
  {
    term: "Data Types",
    category: GlossaryCategory.DataModeling,
    definition:
      "The supported value types for a column definition: string, number, boolean, date, datetime, enum, json, array, reference, reference-array, and geometry.",
    example:
      'A "price" column uses the number type; a "tags" column uses the array type; a "boundary" column uses the geometry type.',
    relatedTerms: ["Column Definition", "Validation Pattern", "Geometry"],
  },
  {
    term: "Geometry",
    category: GlossaryCategory.DataModeling,
    definition:
      "A column type holding a shape — a point, line, or polygon — in the WGS84 (EPSG:4326) coordinate system. Imported geometry (e.g. an ArcGIS parcel boundary) is normalized to this type so it can be queried spatially and drawn on a map.",
    example:
      "A parcels entity has a `boundary` geometry column; the agent computes areas with PostGIS `ST_*` SQL and renders it as a map visualization.",
    relatedTerms: ["Data Types", "Map Visualization", "Column Definition"],
  },
  {
    term: "Validation Pattern",
    category: GlossaryCategory.DataModeling,
    definition:
      "A regular expression that incoming values must match for a record to be considered valid.",
    example:
      "An email column might use the pattern `^[^@]+@[^@]+\\.[^@]+$` to reject malformed addresses.",
    relatedTerms: ["Column Definition", "Normalized Data"],
  },
  {
    term: "Canonical Format",
    category: GlossaryCategory.DataModeling,
    definition:
      "A standard display form for a column's values — for example, ISO-8601 for dates — applied consistently across sources.",
    example:
      'A canonical date format ensures "2026-04-13" is shown identically whether the source stored it as "4/13/26" or "13 Apr 2026".',
    relatedTerms: ["Column Definition", "Normalized Data"],
  },
  {
    term: "Primary Key",
    category: GlossaryCategory.DataModeling,
    definition:
      "The field on a connector entity that uniquely identifies each record.",
    example: 'A Customers entity might use "customer_id" as its primary key.',
    relatedTerms: ["Connector Entity", "Entity Record"],
  },
  {
    term: "Normalized Data",
    category: GlossaryCategory.DataModeling,
    definition:
      "Record values transformed through field mappings and column definitions, so every source speaks the same vocabulary.",
    example:
      "After normalization, a CRM contact and a CSV row both surface their email under the same shared field.",
    relatedTerms: ["Field Mapping", "Column Definition", "Canonical Format"],
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
  },
  {
    term: "Entity Group Member",
    category: GlossaryCategory.Organization,
    definition:
      "An individual connector entity that belongs to an entity group.",
    example:
      'Inside the "People" entity group, both the CRM Contacts entity and the support Users entity are members.',
    relatedTerms: ["Entity Group", "Link Field"],
  },
  {
    term: "Link Field",
    category: GlossaryCategory.Organization,
    definition:
      "The field used to match records across the members of an entity group — typically a shared identifier such as email.",
    example:
      'Use "email" as the link field so the same person in your CRM and your billing system can be recognized as one.',
    relatedTerms: ["Entity Group", "Entity Group Member", "Overlap Preview"],
  },
  {
    term: "Entity Tag",
    category: GlossaryCategory.Organization,
    definition:
      "A color-coded label you attach to entities to categorize and filter them.",
    example:
      'Tag all your customer-data entities with a green "Customers" tag for quick filtering on the entities page.',
    relatedTerms: ["Connector Entity"],
  },
  {
    term: "Overlap Preview",
    category: GlossaryCategory.Organization,
    definition:
      "A summary of how many records match between the members of an entity group, based on the link field.",
    example:
      "An overlap preview might show that 78% of CRM contacts are also present in your billing system.",
    relatedTerms: ["Entity Group", "Link Field"],
  },

  // Analytics
  {
    term: "Station",
    category: GlossaryCategory.Analytics,
    definition:
      "A workspace that groups views, connector instances and tool packs together so you can analyze them in a portal. Views and connectors are attached independently; anyone who can edit the station can attach any view or connector they can read.",
    example:
      'Create a "Sales" station with your "Open deals" and "Invoices" views, your CRM connector, and the statistics tool pack.',
    relatedTerms: [
      "Curated View",
      "Connector Instance",
      "Tool Pack",
      "Portal",
      "Default Station",
    ],
  },
  {
    term: "Curated View",
    category: GlossaryCategory.Analytics,
    definition:
      "A named, filtered window onto one entity's records: a chosen set of columns and an optional row filter. Views are attached to stations, and a portal session queries the attached views the user has read access to. A view someone can't read still shows on the station, locked, so it's clear it's there. With the Curated Views tool pack, the assistant can create, edit, delete and share views in a session; attaching a view to a station is still done when creating or editing the station.",
    example:
      'An "Active customers" view over the Customers entity, showing only name, region and plan for rows where status is active.',
    relatedTerms: [
      "Station",
      "Connector Instance",
      "Connector Entity",
      "Policy",
      "Advanced Filter",
    ],
  },
  {
    term: "Advanced Filter",
    category: GlossaryCategory.Analytics,
    definition:
      "A view's row filter written as a SQL condition instead of with the builder, for what the builder can't express: distances between places, values inside JSON, or one column compared with another. It's a single condition over the entity's own columns, checked when you save it: it can't read other tables or call functions outside an allowed set, and it runs with the same access limits as the view itself. Describe the rows you want to get a suggested filter, and preview the rows it selects before saving. The columns it uses can't be deleted or renamed while the view uses them. Needs write on the view and a plan that includes advanced filters; if a plan stops including them, existing filters keep working but can't be edited until it does.",
    example:
      "ST_DWithin(location, ST_SetSRID(ST_MakePoint(-71.06, 42.36), 4326), 0.02) AND payload->>'status' = 'active' keeps active parcels near downtown Boston.",
    relatedTerms: ["Curated View", "Connector Entity", "Plan Entitlement"],
  },
  {
    term: "Tool",
    category: GlossaryCategory.Analytics,
    definition:
      "A single function the assistant can call during a portal session — for example, `hypothesis_test`, `regression`, or a custom `lookup_company`. Tools come grouped into toolpacks; a station decides which toolpacks are enabled, which determines the set of tools the model can choose from on each turn. Tools shine for analytical work over the station's data: statistical tests, clustering, regressions, forecasts, financial math. Use connectors for data storage and lookup; reach for tools when the answer requires computation, not retrieval.",
    example:
      "Inside a portal session, the assistant calls the `hypothesis_test` tool to compare two groups in an entity, then `visualize_d3` to render the result as an interactive chart.",
    relatedTerms: ["Tool Pack", "Custom Toolpack", "Connector Instance"],
  },
  {
    term: "Tool Pack",
    category: GlossaryCategory.Analytics,
    definition:
      "A bundle of related tools the assistant can use in a portal session. Toolpacks are the *unit you enable on a station*; tools are the *individual functions* inside them. Built-in packs cover data querying, statistics, regression, financial analysis, web search, entity management, access & roles, curated views, visualization, and GIS (maps and geocoding). Organizations can also register custom packs that call out to their own webhook services. Every tool inside an enabled pack costs context-window budget on every portal turn — keep packs small and focused on a single domain, and only attach the packs a station absolutely needs.",
    example:
      "Enable the regression tool pack on a station so the assistant has the `regression`, `logistic_regression`, and `forecast` tools available for trend and prediction questions.",
    relatedTerms: ["Tool", "Station", "Portal", "Custom Toolpack"],
  },
  {
    term: "Plan Entitlement",
    category: GlossaryCategory.Analytics,
    definition:
      "Which tool packs your subscription plan includes. A station can be *configured* with a pack that your plan doesn't include — usually because the plan changed after the station was set up — and that pack goes **inactive** rather than being removed: it stays attached, is marked \"Inactive on your plan\" wherever it appears, and its tools are simply absent from portal sessions. The assistant is told the difference, so it will say a capability isn't included in your plan instead of reporting it as missing from the product. Nothing is deleted by a downgrade, and nothing needs re-attaching after an upgrade — the pack becomes live again in the next portal session.",
    example:
      "A station shows a dashed, greyed-out `gis` chip badged \"Inactive on your plan\". Asked to map records there, the assistant says mapping isn't included in the current plan and links to Settings → Subscription & Billing. Upgrading makes the same station's pack live again with no edit.",
    relatedTerms: ["Tool Pack", "Station", "Portal"],
  },
  {
    term: "Custom Toolpack",
    category: GlossaryCategory.Analytics,
    definition:
      "A user-registered toolpack backed by your organization's webhook endpoints. Define a schema endpoint (lists the tools and their input schemas), a runtime endpoint (the assistant POSTs `{tool, input}` here per call), and an optional metadata endpoint (docs and examples). Once registered, attach the pack to any station the same way you enable a built-in pack. Custom toolpacks are most useful for *analytical* operations specific to your domain — a risk-scoring algorithm, an LTV model, a domain-specific anomaly detector. For raw data storage and lookup, prefer connectors: connectors materialize data into entity records that the data-query toolpack can already SELECT against, without burning context window on per-record lookups. Every outbound call is HMAC-signed with a per-toolpack secret so your server can cryptographically verify the request came from us — see the **Signing Secret** entry for the wire format and the one exception at registration.",
    example:
      'Register a "customer_intel" pack with a `score_churn_risk` tool that calls your in-house ML service. Attach it to your retention station and the assistant can compute risk scores mid-session — something a SQL query alone can\'t do.',
    relatedTerms: ["Tool", "Tool Pack", "Station", "Portal", "Signing Secret"],
  },
  {
    term: "Signing Secret",
    category: GlossaryCategory.Analytics,
    definition:
      "A per-toolpack HMAC secret (`whsec_*` prefix, 32 random bytes) used to sign every outbound webhook call. Generated server-side at registration and shown to you exactly once — copy it into your toolpack server's environment immediately. The secret is encrypted at rest; subsequent reads only confirm presence, never plaintext. To re-view a secret, rotate it from the toolpack's edit dialog: a fresh value is generated, the old one is invalidated immediately, and the new plaintext is shown once.\n\nEvery outbound call carries three headers:\n\n```\nX-Portalai-Timestamp: <unix-seconds>\nX-Portalai-Webhook-Id: <uuid>\nX-Portalai-Signature: v1=<hex>\n```\n\nThe signature is `HMAC-SHA256` over the string `<timestamp>.<webhook-id>.<body>` (empty body for GETs). Your server should reject requests where the timestamp is more than 300 seconds old (replay window) or where the recomputed signature doesn't match using a constant-time comparison.\n\nOne exception: the schema and metadata fetches made *during registration* are signed with the new secret before you've received it, so your server can't verify those two. Accept them unverified (they read your tool catalog, not customer data), and verify everything else, including later schema refreshes.",
    example:
      "Register a toolpack, copy the displayed `whsec_...` secret into your server's environment (e.g. `TOOLPACK_SIGNING_SECRET`), and verify every incoming request before processing — recompute the HMAC over `<ts>.<id>.<rawBody>` and compare with `crypto.timingSafeEqual` (Node) / `hmac.compare_digest` (Python) / `hmac.Equal` (Go).",
    relatedTerms: ["Custom Toolpack", "Tool Pack"],
  },
  {
    term: "Portal",
    category: GlossaryCategory.Analytics,
    definition:
      "A chat session where you ask questions about the data in a station; the assistant answers using the station's tool packs. A portal is only as good as the data behind it: the assistant answers from the records a station has actually imported, not from general knowledge, so a station with no connected source — or one whose records haven't been imported yet — can only answer in generalities. Ask about one thing at a time, too. A narrow question routes cleanly to the right tool; a compound one gives the assistant several jobs at once and no clear place to start.",
    example:
      'Open a portal on the Sales station and ask, "What was last quarter\'s revenue by region?"',
    relatedTerms: [
      "Station",
      "Portal Message",
      "Portal Result",
      "Entity Record",
      "Connector Instance",
      "Tool Pack",
    ],
  },
  {
    term: "Portal Message",
    category: GlossaryCategory.Analytics,
    definition:
      "A single user prompt or assistant reply within a portal session. Word your prompts in the station's own vocabulary: name entities, columns, and values the way they appear in your data, because the assistant matches what you ask against the station's actual schema. Asking for \"churn by plan tier\" works when those are the real names; when the column is called subscription level, say that instead.",
    example:
      "Each question you type and each answer you receive is a portal message.",
    relatedTerms: ["Portal", "Portal Result", "Station", "Entity Record"],
  },
  {
    term: "Portal Result",
    category: GlossaryCategory.Analytics,
    definition:
      "A piece of structured output — a chart, table, or text block — produced by the assistant in a portal message. Treat the ones worth keeping as durable output rather than chat history: pin a result and it stays one click away from the dashboard, and pinned charts and tables reload live data when you open them instead of freezing the numbers from the day you asked.",
    example:
      "A revenue chart returned by the assistant is a portal result that you can pin for later.",
    relatedTerms: ["Portal", "Portal Message", "Pinned Result"],
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
      "A portal result you've saved for quick access from the dashboard or the pinned-results page. Any durable answer pins — text, tables, charts, and maps. A pinned table, chart, or map keeps the query behind it, never a copy of the data, so opening it always shows live data as the person who pinned it sees it now. Share it and others see that same view; if the person who pinned it loses access to the data, the pin empties rather than showing anything stale. A result with no query behind it can't be pinned.",
    example:
      "Pin a quarterly-revenue chart so it's one click away from the dashboard — it shows current numbers every time you open it.",
    relatedTerms: ["Portal Result", "Default Station"],
  },
  {
    term: "Visualization Widget",
    category: GlossaryCategory.Analytics,
    definition:
      "A live chart, map, or table the assistant builds from your data. It remembers the query behind it, so it can re-run for fresh data on its own when you come back to it — no need to ask again. You can also refresh it yourself any time with the refresh button.",
    example:
      "Reopen yesterday's session and its revenue chart quietly reloads with today's numbers; a “Refresh” button and an “Updated … ago” note let you force and confirm a refresh. A table of the ten largest parcels re-runs the whole query, so a newly-largest parcel appears.",
    relatedTerms: ["Portal Result", "Query Handle"],
  },
  {
    term: "Map Visualization",
    category: GlossaryCategory.Analytics,
    definition:
      "An interactive map built from a spatial query — points, lines, or polygons styled by your data, with pan, zoom, and click-to-inspect. Produced by the GIS tool pack's map tool from a SQL query plus a declarative style; large results stream in as vector tiles.",
    example:
      "“Show all vacant parcels on a map, colored by zoning” renders an interactive map you can pan and click; clicking a parcel shows its address and class.",
    relatedTerms: ["Geometry", "Visualization Widget", "Tool Pack"],
  },
  {
    term: "Geocoding",
    category: GlossaryCategory.Analytics,
    definition:
      "Turning a text address into map coordinates (and the reverse — coordinates back into an address). When your data has addresses but no geometry, the assistant can geocode them into points so they can be mapped. A repeated address is served from a shared cache and costs nothing; a whole column is geocoded as a background job that writes a geometry column. Part of the GIS tool pack.",
    example:
      "A contacts entity has a “mailing address” column but no coordinates; geocoding it fills a geometry column with a point per contact, ready to plot.",
    relatedTerms: ["Geometry", "Map Visualization", "Tool Pack"],
  },

  // System
  {
    term: "Job",
    category: GlossaryCategory.System,
    definition:
      "A background task the platform runs on your behalf — a sync, a file import, a revalidation, a bulk geocode or transform, a long query, or deleting an entity's data. While a job runs, the data it works on is locked from edits.",
    example:
      "Re-validating an entity definition spawns a revalidation job that runs in the background while you keep working.",
    relatedTerms: ["Job Status", "Sync", "Data Lock"],
  },
  {
    term: "Data Lock",
    category: GlossaryCategory.System,
    definition:
      "While a job works on some data, that data is read-only everywhere — in the app and for the assistant — so nothing changes underneath it. The affected pages say which job is running and which actions are paused; the lock lifts when the job finishes, fails, or is cancelled.",
    example:
      "During an import, the connector page says that sync, field edits, and delete are paused until the import finishes.",
    relatedTerms: ["Job", "Sync", "Capabilities"],
  },
  {
    term: "Job Status",
    category: GlossaryCategory.System,
    definition:
      "The current state of a job: pending, active, completed, failed, stalled, cancelled, or awaiting confirmation.",
    example:
      "A sync job moves from pending to active to completed once it finishes successfully.",
    relatedTerms: ["Job"],
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
    term: "Policy",
    category: GlossaryCategory.Organization,
    definition:
      "A named bundle of access rules (statements). Each statement allows or denies a verb (read, write, delete, share, …) on a resource type, optionally scoped to specific objects or to what you created. Every org has the built-in system policies; on plans with custom roles, anyone with permission to assign roles can author custom ones.",
    example:
      'An "Analysts" policy that allows read on all stations but write only on the ones you created.',
    relatedTerms: ["Role", "Group", "Permission Boundary"],
  },
  {
    term: "Role",
    category: GlossaryCategory.Organization,
    definition:
      "A named set of policies you assign to members. The three system roles — owner, admin, member — ship with every org; on plans with custom roles, anyone with permission to assign roles can create custom roles that bundle custom policies.",
    example:
      'A custom "Regional Analyst" role bundling a read-only analytics policy, assigned to several members.',
    relatedTerms: ["Policy", "Group"],
  },
  {
    term: "Group",
    category: GlossaryCategory.Organization,
    definition:
      "A collection of members that policies attach to; every member of the group inherits its policies. Groups make it easy to grant a set of people the same access — for example a region or a team.",
    example:
      'A "West Region" group whose members all inherit read access to the West sales view.',
    relatedTerms: ["Policy", "Role"],
  },
  {
    term: "Permission Boundary",
    category: GlossaryCategory.Organization,
    definition:
      "The guardrail on custom authoring: you can only grant access you hold yourself. It stops anyone from authoring a policy (or bundling one into a role/group) that would exceed their own permissions.",
    example:
      "Someone without permission to manage billing can't create a policy granting it, because they don't hold it themselves.",
    relatedTerms: ["Policy", "Role"],
  },
  {
    term: "Share",
    category: GlossaryCategory.Organization,
    definition:
      "Giving someone access to one specific object — a station, a pinned result, or a curated view — without changing their role. A station or pin can be shared read-only or read & write with a teammate or the whole team; a curated view is shared read-only, which gives access to exactly the columns and rows it shows.",
    example:
      'Share the "Q3 Pipeline" station read-only with the sales team so they can open portals on it but not change it.',
    relatedTerms: ["Station", "Curated View", "Pinned Result", "Capabilities"],
  },
  {
    term: "Capabilities",
    category: GlossaryCategory.Organization,
    definition:
      "What you can do with a particular object — read, write, delete, and for shareable objects share — worked out by the server from your roles, groups, policies, and shares. The app uses them to decide which actions to show: an action you aren't permitted is hidden, one your plan doesn't include points to billing, and one blocked by something temporary (like a running job) is disabled with the reason.",
    example:
      "A station shared with you read-only shows no Edit or Delete, because your capabilities on it are read only.",
    relatedTerms: ["Share", "Policy", "Role", "Data Lock"],
  },
  {
    term: "Invitation",
    category: GlossaryCategory.Organization,
    definition:
      "How a new member joins an organization: someone with permission to invite members creates an invitation for an email address and a role, then shares the invitation link with that person, who accepts it by signing in with that email. The link is shown once, and an invitation expires after 7 days if it isn't accepted.",
    example:
      "Invite a colleague from Settings → Members, copy the invitation link, and send it to them; they join with the role you chose once they sign in.",
    relatedTerms: ["Organization", "Role"],
  },
  {
    term: "Activity Log",
    category: GlossaryCategory.Organization,
    definition:
      "The organization's security audit log: sign-ins, member and role changes, shares, and other security-relevant actions, each with who did it and when. Shown on the Settings → Activity tab to anyone with permission to read the audit log, and kept for about 24 months.",
    example:
      "Check the Activity tab to see who changed a member's role last week.",
    relatedTerms: ["Organization", "Role", "Share"],
  },
  {
    term: "SSO",
    category: GlossaryCategory.Organization,
    definition:
      "Single sign-on: signing in through your organization's own identity provider (for example Okta or Microsoft Entra ID) instead of a Google account. Available on Enterprise, set up with the Portals AI team; members still need an invitation to join.",
    example:
      "With SSO set up, your team signs in with their company accounts and you manage access in your own identity provider.",
    relatedTerms: ["Organization", "Invitation"],
  },
  {
    term: "Default Station",
    category: GlossaryCategory.System,
    definition:
      "The station opened by default on your dashboard and used when you launch a portal without picking a station explicitly.",
    example:
      "Set your most-used station as the default so the dashboard surfaces its portals and pinned results first.",
    relatedTerms: ["Station", "Pinned Result"],
  },
  {
    term: "Subscription Plan",
    category: GlossaryCategory.System,
    definition:
      "The plan your organization is on, which sets its monthly usage allocations and its portal-session send ceiling (a per-minute/per-day fair-use bound that never consumes credits). Anyone with permission to manage billing can upgrade to a paid plan from Settings → Subscription & Billing; payment is handled by Stripe's secure checkout.",
    example:
      "Upgrading from Standard to a paid plan raises your monthly metered and expensive usage allocations.",
    relatedTerms: ["Organization", "Billing Portal"],
  },
  {
    term: "Billing Portal",
    category: GlossaryCategory.System,
    definition:
      "A secure Stripe-hosted page where anyone with permission to manage billing manages the subscription — changing plans, updating payment methods, viewing invoices, and cancelling. Opened from Settings → Subscription & Billing once subscribed.",
    example:
      "To switch plans or update your card, open Manage subscription — everything happens in the billing portal, and your plan here updates automatically.",
    relatedTerms: ["Subscription Plan", "Organization"],
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
