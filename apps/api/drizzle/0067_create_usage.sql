CREATE TABLE "usage" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"period_id" text NOT NULL,
	"cost_class" text NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_cost_class_check" CHECK ("usage"."cost_class" IN ('free', 'metered', 'expensive')),
	CONSTRAINT "usage_units_nonneg" CHECK ("usage"."units_used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_org_period_class_unique" ON "usage" USING btree ("organization_id","period_id","cost_class") WHERE deleted IS NULL;