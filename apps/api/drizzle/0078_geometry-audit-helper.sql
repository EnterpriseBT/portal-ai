-- #316 (slice 4): a non-throwing GeoJSON parse helper for the geometry audit.
--
-- ST_GeomFromGeoJSON raises on malformed input, which would abort the whole
-- set-based audit statement on the first bad row. This wrapper swallows the
-- error and returns NULL, so `GeometryAuditService.auditBatch` can classify
-- every row in one round-trip: NULL ⇒ rejected, invalid ⇒ repaired (ST_MakeValid
-- fixes it on write), valid ⇒ ok. Idempotent via CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION portal_try_geom_from_geojson(input text)
RETURNS geometry
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ST_GeomFromGeoJSON(input);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;
