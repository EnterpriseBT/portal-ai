-- #1064: DELETE /api/stations/:id soft-deleted the station with its view and
-- connector attachments (#674) but not its tool pack rows, so every pack row
-- outlived its station. The route now detaches them; this retires the rows
-- already left behind.
--
-- Each row takes its station's own deleted / deleted_by: it reads as having
-- gone with the station, which is what the fixed delete writes. No principal
-- is invented. Rows of live stations and rows already deleted are untouched,
-- so a second run is a no-op.
UPDATE station_toolpacks AS st
SET deleted = s.deleted,
    deleted_by = s.deleted_by
FROM stations AS s
WHERE s.id = st.station_id
  AND s.deleted IS NOT NULL
  AND st.deleted IS NULL;
