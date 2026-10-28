CREATE TYPE "public"."message_kind" AS ENUM('pitch', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'approved', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "do_not_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" "message_kind" NOT NULL,
	"status" "message_status" DEFAULT 'draft' NOT NULL,
	"to" text NOT NULL,
	"to_name" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"send_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"sender_name" text,
	"sender_email" text,
	"company" text,
	"address" text,
	"website" text,
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_target_id_outreach_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."outreach_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD CONSTRAINT "outreach_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "do_not_contact_workspace_value_uq" ON "do_not_contact" USING btree ("workspace_id","value");--> statement-breakpoint
CREATE INDEX "outreach_messages_workspace_idx" ON "outreach_messages" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_messages_target_kind_uq" ON "outreach_messages" USING btree ("target_id","kind");