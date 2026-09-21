CREATE TABLE "permission_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"effect" text NOT NULL,
	"verb" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"condition" text,
	CONSTRAINT "permission_grants_effect_check" CHECK ("permission_grants"."effect" IN ('allow', 'deny')),
	CONSTRAINT "permission_grants_principal_type_check" CHECK ("permission_grants"."principal_type" IN ('user', 'role')),
	CONSTRAINT "permission_grants_condition_check" CHECK ("permission_grants"."condition" IS NULL OR "permission_grants"."condition" IN ('created_by_caller', 'created_by_system'))
);
--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permission_grants_principal_idx" ON "permission_grants" USING btree ("organization_id","principal_id","resource_type");--> statement-breakpoint
CREATE INDEX "permission_grants_resource_idx" ON "permission_grants" USING btree ("organization_id","resource_type","resource_id");