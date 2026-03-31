# Entity Grouping & Cross-Entity Relationships — Discovery

## Current State

The existing relationship model works as follows:

- `connector_entities` — a distinct data object belonging to a connector instance (e.g. "Contacts" from HubSpot)
- `column_definitions` — org-level catalog of normalized field types (shared across entities via field mappings)
- `field_mappings` — binds a source field on a `connector_entity` to a `column_definition`; when the column type is `"reference"`, the mapping also stores `refColumnDefinitionId` and `refEntityKey` to point at a target entity
- `entity_records` — JSONB row store; each record has `data` (raw) and `normalizedData` (mapped)

The `"reference"` column type enables **1:1 or 1:many** cross-entity lookups: a field on entity A holds an ID that maps to a primary-key field on entity B. The relationship is directional — only entity A declares it.

---

## Scenario 1: Many-to-Many Relationships (`reference-array`)

**Problem:** A column holds an *array* of foreign IDs. For example:

- `college_classes.enrolled_student_ids` → array of Student IDs
- `student.classes_enrolled_ids` → array of Class IDs

**Proposed approach: add `"reference-array"` to `ColumnDataTypeEnum`**

The `FieldMapping` ref fields (`refColumnDefinitionId`, `refEntityKey`) already carry enough information to describe the target. Adding the new type is the only model change needed on the column definition side.

At query time, the GIN index on `normalized_data` already supports containment queries (`@>`), so fetching all students enrolled in a given class is a single indexed JSON query — no schema change required to the records table.

**Additional validation/configuration considerations:**

When a user configures a `reference-array` column there are two validity modes:

| Mode | Description |
|------|-------------|
| **Unidirectional** | Only one entity declares the array reference (simpler, no back-link enforced) |
| **Bidirectional** | Both entities declare matching `reference-array` fields pointing at each other; a consistency check ensures the arrays agree |

To support bidirectional validation, `FieldMapping` could gain an optional `refBidirectionalFieldMappingId` column that links to the counterpart mapping on the other entity. The API can then surface a warning if a record's array is out of sync with the back-reference.

**Schema delta:**

```
column_definitions.type  ← add "reference-array" to enum
field_mappings           ← add optional refBidirectionalFieldMappingId (nullable FK → field_mappings.id)
```

**Decisions:**
- Bidirectional consistency will be surfaced as a **validation warning in the UI** for now; write-time enforcement deferred to a later iteration.
- No cardinality limit enforced on array length for now.

---

## Scenario 2: Entity Tags / Categories

**Problem:** Entities across different connector instances are logically related (e.g., all "HR" entities) but share no data-level column. Users want to annotate this relationship for organizational / navigation purposes — not to join data.

**Proposed approach: a lightweight tagging system on `connector_entities`**

Two new tables:

**`entity_tags`** — org-level tag catalog

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK (base columns) |
| organizationId | text | FK → organizations |
| name | text | e.g. "HR", "Finance" |
| color | text (nullable) | hex color for UI badge |
| description | text (nullable) | |

**`entity_tag_assignments`** — many-to-many join

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK (base columns) |
| organizationId | text | FK → organizations |
| connectorEntityId | text | FK → connector_entities |
| entityTagId | text | FK → entity_tags |
| UNIQUE | (connectorEntityId, entityTagId) | prevent duplicates |

**This is purely organizational metadata.** No changes to column definitions, field mappings, or entity records. The Entities list view and EntityDetail view can display tags as chips, and users can filter by tag. Tags can be managed from a new "Tags" section in Settings or inline from the entity detail page.

**Open questions:**
- Should tags be hierarchical (parent/child) or flat? Starting flat is simpler.
- Should tags be filterable across the Entities view only, or also across entity records?

---

## Scenario 3: Cross-Entity Identity Resolution (Entity Groups)

**Problem:** Multiple entities from different connector instances represent the *same real-world objects* (e.g., a person appears as `employees`, `hubspot_users`, and `airtable_users`). Their column names differ, but a shared value exists in each (e.g., `employee_email`, `hubspot_email`). There is no shared `column_definition` linking them.

This is distinct from a `reference` relationship: neither entity *points at* the other. They just happen to contain a field whose values overlap.

**Proposed approach: Entity Groups with per-member link columns**

Three new tables:

**`entity_groups`** — org-level group catalog

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK (base columns) |
| organizationId | text | FK → organizations |
| name | text | e.g. "People", "Accounts" |
| description | text (nullable) | |

**`entity_group_members`** — declares which entities belong to a group and how they're linked

| Column | Type | Notes |
|--------|------|-------|
| id | text | PK (base columns) |
| organizationId | text | FK → organizations |
| entityGroupId | text | FK → entity_groups |
| connectorEntityId | text | FK → connector_entities |
| linkFieldMappingId | text | FK → field_mappings — the field whose value is the shared identity key |
| UNIQUE | (entityGroupId, connectorEntityId) | one membership per entity per group |

**How it works:**

When a user views an `entity_record` from `hubspot_users`, the system can:

1. Look up which `entity_groups` `hubspot_users` belongs to
2. For each group, find all other member entities and their `linkFieldMappingId`
3. Read the value of the link field from the current record's `normalizedData`
4. Query each sibling entity's `normalizedData` GIN index for records where their link field equals the same value
5. Surface matching records as "Related records from this group" in the record detail view

**This requires no changes to existing tables** — `field_mappings` already records which source field maps to which column definition and where it lives in `normalizedData`. The GIN index on `entity_records.normalized_data` already makes value lookups fast.

**Identity key type flexibility:**

The link field can be any existing `field_mapping` on the entity (the value at `normalizedData[fieldMapping.columnDefinition.key]` is the match key). This means the shared value does not need to be a `reference` type — it just needs to be a field whose normalized value is consistent across entities (e.g., lowercase email string).

**Validation at group configuration time:**

- Both entities must have a field mapping for their declared link field
- Warn if the two link fields have different `ColumnDataType` values (e.g., one is `string`, another is `number`)
- Optionally warn if value set overlap is low (i.e., no records in entity A's link column appear in entity B's)

**Open questions:**
- Should identity resolution be *automatic* (match on first write during sync) or *on-demand* (queried at read time)? On-demand is simpler to implement initially and avoids stale join data.
- Should there be a `"primary"` flag on one member to indicate the canonical entity for a group when surfacing a merged view?
- Can a single entity belong to multiple groups? (Likely yes — e.g., `employees` could be in both a "People" group and a "HR" group if tags and groups coexist.)
- Should groups support more than one link field per member for compound key matching?

---

## Summary of New Models

| Model | Purpose | Complexity |
|-------|---------|------------|
| `reference-array` column type | M:M pointer via field value arrays | Low — enum + optional FK |
| `entity_tags` + `entity_tag_assignments` | Organizational categorization labels | Low — no data impact |
| `entity_groups` + `entity_group_members` | Cross-entity identity resolution via shared field values | Medium — new query pattern at read time |

The three features are **independent** and can be built in any order. Tags are the lowest-risk starting point. Identity groups are the highest value for the "same person across systems" use case.
