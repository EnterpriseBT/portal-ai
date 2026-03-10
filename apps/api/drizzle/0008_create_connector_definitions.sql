CREATE TABLE "connector_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"slug" text NOT NULL,
	"display" text NOT NULL,
	"category" text NOT NULL,
	"auth_type" text NOT NULL,
	"config_schema" jsonb,
	"capability_flags" jsonb NOT NULL,
	"is_active" boolean NOT NULL,
	"version" text NOT NULL,
	"icon_url" text
);
