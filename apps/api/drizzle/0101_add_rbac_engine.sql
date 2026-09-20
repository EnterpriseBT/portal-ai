CREATE TABLE "permission_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	CONSTRAINT "permission_policies_kind_check" CHECK ("permission_policies"."kind" IN ('system', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "permission_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"effect" text NOT NULL,
	"verb" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"condition" text,
	CONSTRAINT "permission_statements_effect_check" CHECK ("permission_statements"."effect" IN ('allow', 'deny')),
	CONSTRAINT "permission_statements_condition_check" CHECK ("permission_statements"."condition" IS NULL OR "permission_statements"."condition" IN ('created_by_caller', 'created_by_system'))
);
--> statement-breakpoint
CREATE TABLE "policy_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	CONSTRAINT "policy_attachments_principal_type_check" CHECK ("policy_attachments"."principal_type" IN ('user', 'role'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "roles_kind_check" CHECK ("roles"."kind" IN ('system', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_statements" ADD CONSTRAINT "permission_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_statements" ADD CONSTRAINT "permission_statements_policy_id_permission_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."permission_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_attachments" ADD CONSTRAINT "policy_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_attachments" ADD CONSTRAINT "policy_attachments_policy_id_permission_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."permission_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_policies_org_name_unique" ON "permission_policies" USING btree ("organization_id","name") WHERE "permission_policies"."deleted" IS NULL;--> statement-breakpoint
CREATE INDEX "permission_statements_policy_idx" ON "permission_statements" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "permission_statements_resource_idx" ON "permission_statements" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "policy_attachments_principal_idx" ON "policy_attachments" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_attachments_unique" ON "policy_attachments" USING btree ("policy_id","principal_type","principal_id") WHERE "policy_attachments"."deleted" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_name_unique" ON "roles" USING btree ("organization_id","name") WHERE "roles"."deleted" IS NULL;