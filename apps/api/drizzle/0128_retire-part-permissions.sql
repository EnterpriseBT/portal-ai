-- #829: records and field mappings are parts of their entity, governed by the
-- entity's permission, so `entity_record` and `field_mapping` are no longer
-- permission types. Their rows (the seeded MemberAccess statements, any custom
-- statements or grants, and every curated-view share's composed
-- `in_curated_view` field grant) mean nothing any more. DML only: the column
-- is unconstrained text, and the condition CHECK keeps admitting the value.
DELETE FROM "permission_grants"
  WHERE "resource_type" IN ('entity_record', 'field_mapping')
     OR "condition" = 'in_curated_view';--> statement-breakpoint
DELETE FROM "permission_statements"
  WHERE "resource_type" IN ('entity_record', 'field_mapping')
     OR "condition" = 'in_curated_view';
