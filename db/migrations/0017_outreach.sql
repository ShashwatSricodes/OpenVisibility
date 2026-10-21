CREATE TYPE "public"."outreach_status" AS ENUM('found', 'ready', 'no_contact', 'task', 'skipped', 'drafted', 'approved', 'sent', 'replied', 'won');--> statement-breakpoint
CREATE TABLE "content_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"status" "audit_status" DEFAULT 'queued' NOT NULL,
	"brief" jsonb,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"status" "outreach_status" DEFAULT 'found' NOT NULL,
	"evidence" jsonb,
	"research" jsonb,
	"contact" jsonb,
	"note" text,
	"researched_at" timestamp with time zone,
	"research_attempts" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD CONSTRAINT "outreach_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_briefs_workspace_prompt_uq" ON "content_briefs" USING btree ("workspace_id","prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_targets_workspace_url_uq" ON "outreach_targets" USING btree ("workspace_id","url");