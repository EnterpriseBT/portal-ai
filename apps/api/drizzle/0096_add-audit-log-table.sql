CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" text NOT NULL,
	"source_ip" text,
	"user_agent" text,
	"metadata" jsonb,
	CONSTRAINT "audit_log_outcome_check" CHECK ("audit_log"."outcome" IN ('success', 'failure'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created","id");--> statement-breakpoint
-- #575 tamper-evidence. The app connects as the table owner (single
-- DATABASE_URL, no separate least-priv runtime role until #397), so a
-- `REVOKE UPDATE, DELETE` would be a no-op against the owner. A trigger works
-- regardless of role, and — unlike a blanket REVOKE — can permit the one
-- legitimate delete path: the retention purge (#575 slice 5), which opts in
-- with `SET LOCAL app.audit_retention_purge = 'on'` inside its transaction.
-- UPDATE is never permitted; DELETE only under the purge flag. This blocks
-- every application mutate/delete path (there are no repo methods for either),
-- which is the append-only guarantee the read surface and SOC 2 rely on.
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND current_setting('app.audit_retention_purge', true) = 'on' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_mutation
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();