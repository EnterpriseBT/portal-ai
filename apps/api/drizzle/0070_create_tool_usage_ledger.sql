CREATE TABLE "tool_usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"station_id" text NOT NULL,
	"portal_id" text,
	"cost_class" text NOT NULL,
	"units" integer NOT NULL,
	"period_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "tool_usage_ledger_tool_call_id_unique" UNIQUE("tool_call_id"),
	CONSTRAINT "tool_usage_ledger_cost_class_check" CHECK ("tool_usage_ledger"."cost_class" IN ('metered', 'expensive')),
	CONSTRAINT "tool_usage_ledger_units_positive" CHECK ("tool_usage_ledger"."units" > 0)
);
--> statement-breakpoint
ALTER TABLE "tool_usage_ledger" ADD CONSTRAINT "tool_usage_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_usage_ledger_org_period_idx" ON "tool_usage_ledger" USING btree ("organization_id","period_id");