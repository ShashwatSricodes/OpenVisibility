CREATE TYPE "public"."audit_status" AS ENUM('queued', 'running', 'done');--> statement-breakpoint
CREATE TABLE "page_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE "site_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" "audit_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"robots_state" text,
	"robots_text" text,
	"llms_txt_status" integer,
	"sitemap_url" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_audit_id_site_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audits" ADD CONSTRAINT "site_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_audits_audit_idx" ON "page_audits" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "site_audits_workspace_idx" ON "site_audits" USING btree ("workspace_id");