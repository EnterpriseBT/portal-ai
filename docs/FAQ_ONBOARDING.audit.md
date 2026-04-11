# FAQ & Onboarding Audit

## Problem

The application uses domain-specific vocabulary (stations, portals, entities, field mappings, entity groups, column definitions, etc.) with **zero in-app help content** today — no tooltips, onboarding flows, help pages, or glossary. New users have no way to learn what these concepts mean or how they relate without trial and error.

---

## Proposed Solution: Two-Part Approach

### Part 1 — Glossary / Knowledge Base Page

A new `/help` route with a searchable, categorized glossary of all domain terms.

**Structure:**

```
/help
  ├── Glossary (default tab)
  ├── FAQ
  └── Getting Started
```

**Glossary categories and terms:**

| Category | Terms |
|---|---|
| **Data Sources** | Connector Definition, Connector Instance, Connector Entity, Entity Record, Sync, Access Mode (import/live/hybrid) |
| **Data Modeling** | Column Definition, Field Mapping, Data Types, Validation Pattern, Canonical Format, Primary Key, Normalized Data |
| **Organization** | Entity Group, Entity Group Member, Link Field, Entity Tag, Overlap Preview |
| **Analytics** | Station, Tool Pack, Portal, Portal Message, Portal Result, Pinned Result |
| **System** | Job, Job Status, Organization, Default Station |

Each glossary entry includes:
- **Term** — the name as it appears in the UI
- **Plain-language definition** — one sentence, no jargon
- **Example** — a concrete scenario
- **Related concepts** — links to other glossary entries
- **Where to find it** — which page in the app

**Example entry:**

> **Connector Instance**
> A live connection to one of your data sources. When you pick a connector type from the catalog (like CSV or a database) and configure it with your credentials, the result is a connector instance.
>
> *Example: You upload a CSV file of customer data — that creates a connector instance named "Q1 Customers CSV".*
>
> Related: Connector Entity, Station
> Found on: Connectors page → Connected tab

### Part 2 — FAQ Page

Organized by user journey stage:

**Getting Started**
- What is Portal.ai and what can I do with it?
- How do I connect my first data source?
- What is a Station and why do I need one?
- How do I start asking questions about my data?

**Working with Data**
- What's the difference between a connector and an entity?
- What are column definitions and why do they matter?
- What are field mappings?
- What do the access modes (import, live, hybrid) mean?
- How do I validate my data?
- What happens when I sync an entity?

**Organization & Grouping**
- What are entity groups and when should I use them?
- What is a "link field" in an entity group?
- How do tags work?

**Analytics & Portals**
- What are tool packs?
- How do I save results from a portal session?
- What's the difference between a portal and a portal result?

**Jobs & Background Tasks**
- What do job statuses mean?
- Why did my job fail?

---

## Per-Page Audit

### Dashboard (`/`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Default Station | No | Add subtitle text explaining what a default station is and why it matters |
| Pinned Results | No | Add empty-state text: "Pin results from portal sessions to access them here" |
| Recent Portals | No | Add helper text: "Portals are chat sessions where you ask questions about your data" |
| Portal launching | No | Tooltip on "New Portal" button explaining what will happen |

### Stations (`/stations`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Station | No | Page-level description: "Stations are workspaces that group your data sources and tools together for analysis" |
| Tool Packs | No | Tooltip or info icon explaining each tool pack (data_query, statistics, regression, financial, web_search, entity_management) |
| Default Station | No | Tooltip on "Set as default" explaining the effect |

### Station Detail (`/stations/$stationId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Tool Packs | No | Brief description of each enabled pack |
| Connector Instances list | No | Explain that these are the data sources available in this station |
| Portals list | No | Explain that these are past chat sessions launched from this station |

### Connectors (`/connectors`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Connected vs Catalog tabs | No | Tab descriptions: "Your active connections" vs "Available connector types" |
| Connector status (active/inactive/error/pending) | No | Status badge tooltips explaining each state |
| Capability flags (sync/query/write) | No | Tooltips explaining what each capability means |

### Connector Instance Detail (`/connectors/$connectorInstanceId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Capability flags | No | Explain what enabling/disabling each capability does |
| Connector Entities list | No | Explain: "Entities are the data objects (tables, collections) available from this connector" |
| Last Sync | No | Explain what syncing does |

### Entities (`/entities`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Connector Entity | No | Page-level description: "Entities represent data objects from your connected sources — like tables or collections" |
| Entity Key vs Label | No | Tooltip: "Key is the internal identifier, Label is the display name" |
| Tag filtering | No | Brief explanation of what tags are for |

### Entity Detail (`/entities/$entityId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Access Mode (import/live/hybrid) | No | Tooltip explaining each mode |
| Sync button | No | Tooltip: "Pull the latest data from the connector into this entity" |
| Re-validate button | No | Tooltip: "Re-run validation rules on all records" |
| Field mapping warnings | No | Explain what bidirectional consistency means |
| Record count | No | Contextual help: what constitutes a record |

### Entity Record Detail (`/entities/$entityId/records/$recordId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Source ID | No | Tooltip: "The unique identifier for this record in the original data source" |
| isValid status | No | Explain what validation checks are applied |
| Normalized Data | No | Explain: "Data transformed according to your field mappings and column definitions" |
| Related Records | No | Explain how entity groups connect records across sources |

### Tags (`/tags`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Entity Tags | No | Page-level description: "Tags let you categorize and filter your entities with color-coded labels" |
| Color assignment | No | Brief note that colors appear as badges throughout the app |

### Entity Groups (`/entity-groups`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Entity Group | No | Page-level description: "Entity groups link related entities from different sources — e.g., the same person appearing in your CRM and your database" |
| Member count | No | Explain what a "member" is in this context |

### Entity Group Detail (`/entity-groups/$entityGroupId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Link Field Mapping | No | Explain: "The field used to match records across entities — e.g., an email address that appears in both sources" |
| Primary Member | No | Explain what "primary" means and when it matters |
| Overlap Preview | No | Explain: "Shows what percentage of records match between group members based on the link field" |

### Column Definitions (`/column-definitions`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Column Definition | No | Page-level description: "Column definitions are your organization's shared data schema — they standardize how fields are named, typed, and validated across all your data sources" |
| Data types | No | Brief description of each type (string, number, boolean, date, datetime, enum, json, array, reference, reference-array) |

### Column Definition Detail (`/column-definitions/$columnDefinitionId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Validation Pattern | No | Explain: "A regex pattern that values must match to be considered valid" |
| Canonical Format | No | Explain what canonical format does (standardizes display) |
| Field Mappings list | No | Explain: "These are the entity fields that map to this column definition" |

### Jobs (`/jobs`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Job types | No | Explain each type: file_upload, system_check, revalidation |
| Job statuses | No | Status badge tooltips: pending, active, completed, failed, stalled, cancelled, awaiting_confirmation |
| Progress bar | No | Context for what percentage represents |

### Pinned Results (`/portal-results`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Portal Result | No | Page-level description: "Results you've pinned from portal sessions for quick access" |
| Result types (chart/text) | No | Brief explanation of what gets saved |

### Portal (`/portals/$portalId`)

| Domain Concept | Currently Explained? | Improvement |
|---|---|---|
| Portal session | No | Brief intro text for first-time users: "Ask questions about the data sources in this station. You can query data, run analysis, and create visualizations." |
| Pinning results | No | Tooltip on pin action explaining what it does |

---

## Implementation Plan

### Where it lives

| Component | Path |
|---|---|
| Route | `apps/web/src/routes/_authorized/help/index.tsx` |
| View | `apps/web/src/views/Help.view.tsx` |
| Glossary data | `apps/web/src/utils/glossary.util.ts` |
| FAQ data | `apps/web/src/utils/faq.util.ts` |
| Sidebar link | Added to `SidebarNav.component.tsx` |

### Glossary data structure (`glossary.util.ts`)

```ts
interface GlossaryEntry {
  term: string;
  category: "data-sources" | "data-modeling" | "organization" | "analytics" | "system";
  definition: string;
  example?: string;
  relatedTerms?: string[];
  pageRoute?: string;
}
```

### FAQ data structure (`faq.util.ts`)

```ts
interface FAQEntry {
  question: string;
  answer: string;
  category: "getting-started" | "data" | "organization" | "analytics" | "jobs";
  relatedGlossaryTerms?: string[];
}
```

### UI components

- `GlossaryList.component.tsx` — filterable/searchable list with category chips, uses MUI `Accordion` or card grid
- `FAQList.component.tsx` — accordion-style expandable Q&A, grouped by category
- `GettingStarted.component.tsx` — simple step-by-step visual guide (connect data → map fields → create station → open portal)

### Page layout

- Three tabs using MUI `Tabs`: **Getting Started** | **Glossary** | **FAQ**
- Search bar at the top that filters both glossary and FAQ entries
- Sidebar nav gets a help icon (MUI `HelpOutline`) at the bottom near Settings

---

## Incremental Enhancements (Future)

1. **Contextual help icons** — small `?` icon buttons next to key terms on each page that link to or tooltip the glossary definition
2. **First-time onboarding flow** — a guided stepper overlay for brand-new organizations with zero connectors
3. **Empty state guidance** — when a page has no data (e.g., no stations), show a brief explanation of the concept and a CTA

---

## Scope Summary

| Task | Scope |
|---|---|
| Glossary data (~25 entries) | Content writing |
| FAQ data (~20 entries) | Content writing |
| Getting Started guide | Content + simple component |
| Help route + view + tabs | 1 new route, 1 view, 3 components |
| Sidebar nav update | 1 line addition |
| Search/filter logic | Utility function |

No API changes, no database changes, no new backend routes needed. The page is entirely static content with client-side filtering.
