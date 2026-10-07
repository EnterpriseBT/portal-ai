-- #719: scrub database error text already stored where every org member can
-- read it. Before #719 a failed job recorded the Postgres root error
-- (message, `detail` quoting row values, SQLSTATE, constraint) or, with no
-- pg cause, Drizzle's wrapper: the SQL statement and its bound params. A
-- failed draft commit copied the raw message into the connector instance's
-- last_error_message. New writes go through `jobErrorText`; this rewrites the
-- rows written before it.
--
-- Matching: Drizzle's wrapper starts "Failed query:"; the old formatter
-- always appended " | code: <SQLSTATE>" for a pg error. A SQLSTATE always has
-- a digit as its third character (23505, 22P02, 40P01, XX000, P0001), which
-- keeps 5-letter network codes such as EPIPE out. Rows with upstream, auth,
-- parse or stall text don't match and are left alone.
--
-- UPDATE only (no DDL); idempotent, since the replacement text matches neither
-- pattern.

UPDATE "jobs"
SET "error" = 'Database error (SQLSTATE '
  || substring("error" from 'code: ([0-9A-Z]{2}[0-9][0-9A-Z]{2})')
  || '). See the server log.'
WHERE "error" ~ 'code: [0-9A-Z]{2}[0-9][0-9A-Z]{2}( \||\)|$)';
--> statement-breakpoint
UPDATE "jobs"
SET "error" = 'Database error. See the server log.'
WHERE "error" LIKE '%Failed query:%';
--> statement-breakpoint
UPDATE "connector_instances"
SET "last_error_message" = 'Database error. See the server log.'
WHERE "last_error_message" LIKE '%Failed query:%';
