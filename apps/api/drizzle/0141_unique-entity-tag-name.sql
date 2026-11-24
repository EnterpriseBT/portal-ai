-- #1071: tag names become unique per org among live tags. The service checked
-- for a duplicate and then inserted, so two creates or renames racing past the
-- check both landed (five parallel creates made five "ADV Dup Race" tags in the
-- adversarial walk); the agent issues tool calls in parallel, which makes that
-- easy to hit.
--
-- A database may already hold such duplicates, which the index below would
-- refuse. Keep each name's oldest live tag as it is and rename the others by
-- suffixing their id's first 8 characters ("Q4 (3f2a9c1d)"), which is unique
-- and tells their owners which one to merge or delete. Assignments, ids and
-- owners are untouched. Re-running renames nothing: no duplicates remain.
UPDATE entity_tags t
SET name = t.name || ' (' || left(t.id, 8) || ')',
    updated = (extract(epoch FROM now()) * 1000)::bigint
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id, name ORDER BY created, id
         ) AS n
  FROM entity_tags
  WHERE deleted IS NULL
) d
WHERE d.id = t.id AND d.n > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tags_org_name_unique" ON "entity_tags" USING btree ("organization_id","name") WHERE deleted IS NULL;
