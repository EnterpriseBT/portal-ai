CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_grants" DROP CONSTRAINT "permission_grants_principal_type_check";--> statement-breakpoint
ALTER TABLE "policy_attachments" DROP CONSTRAINT "policy_attachments_principal_type_check";--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_org_name_unique" ON "groups" USING btree ("organization_id","name") WHERE "groups"."deleted" IS NULL;--> statement-breakpoint
CREATE INDEX "user_group_user_org_idx" ON "user_group" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_group_unique" ON "user_group" USING btree ("user_id","group_id") WHERE "user_group"."deleted" IS NULL;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_principal_type_check" CHECK ("permission_grants"."principal_type" IN ('user', 'role', 'group'));--> statement-breakpoint
ALTER TABLE "policy_attachments" ADD CONSTRAINT "policy_attachments_principal_type_check" CHECK ("policy_attachments"."principal_type" IN ('user', 'role', 'group'));