-- #660 PR 2: the restricted role agent SQL runs under (`SET LOCAL ROLE`).
--
-- NOLOGIN, with no table grants. Each SQL session grants it SELECT on that
-- session's own temp views, so Postgres itself, not only the SQL gate, keeps
-- a session to the caller's views. Idempotent.
--
-- It never fails the upgrade for lack of privilege. Without CREATEROLE (or
-- superuser) it raises a NOTICE and stops; the API's boot self-check then
-- refuses every SQL tool (PORTAL_SQL_UNAVAILABLE) until an operator
-- provisions the role (see deploy/helm/portalai/README.md).
--
-- The role name comes from the `portalai.sql_reader_role` setting (the migrate
-- script passes PORTAL_SQL_READER_ROLE), defaulting to portalai_sql_reader.
-- Roles are cluster-wide; sharing one across databases is harmless because it
-- holds no grants of its own.
DO $$
DECLARE
  reader text := coalesce(
    nullif(current_setting('portalai.sql_reader_role', true), ''),
    'portalai_sql_reader'
  );
  can_create boolean;
BEGIN
  IF reader !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'invalid portalai.sql_reader_role: %', reader;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = reader) THEN
    SELECT rolsuper OR rolcreaterole INTO can_create
      FROM pg_roles WHERE rolname = current_user;
    IF NOT can_create THEN
      RAISE NOTICE 'portal SQL reader role "%" not created: % lacks CREATEROLE. SQL tools stay unavailable until it is provisioned.', reader, current_user;
      RETURN;
    END IF;
    EXECUTE format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      reader
    );
  END IF;

  -- The API's login role must be able to SET ROLE to it. On PG16+ a
  -- CREATEROLE creator holds only ADMIN on the role it created, so SET is
  -- granted explicitly.
  BEGIN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT %I TO %I WITH SET TRUE', reader, current_user);
    ELSE
      EXECUTE format('GRANT %I TO %I', reader, current_user);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'portal SQL reader role "%" exists but % cannot be granted membership. SQL tools stay unavailable until it is.', reader, current_user;
    RETURN;
  END;

  -- USAGE on public is name lookup only: it lets the role call the PostGIS
  -- functions installed there and resolve a table name, so a direct read is
  -- denied (42501) rather than hidden. Reading any table still needs a SELECT
  -- grant, which only the session's temp views get. Some databases don't
  -- grant public's USAGE to PUBLIC, so it's granted explicitly. No CREATE.
  BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', reader);
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', reader);
  EXCEPTION WHEN insufficient_privilege THEN
    -- Not the schema's owner. PUBLIC usually holds USAGE on public already;
    -- the API's self-check decides whether the role works.
    RAISE NOTICE 'could not grant USAGE on schema public to "%"; relying on PUBLIC''s grant', reader;
  END;
END $$;
