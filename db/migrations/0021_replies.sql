CREATE TYPE "public"."reply_kind" AS ENUM('reply', 'opt_out', 'bounce');--> statement-breakpoint
CREATE TABLE "outreach_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"kind" "reply_kind" NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text,
	"snippet" text,
	"received_at" timestamp with time zone NOT NULL,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "imap_host" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "imap_port" integer;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "imap_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "imap_error" text;--> statement-breakpoint
ALTER TABLE "outreach_targets" ADD COLUMN "won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_replies" ADD CONSTRAINT "outreach_replies_target_id_outreach_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."outreach_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_replies_workspace_message_uq" ON "outreach_replies" USING btree ("workspace_id","message_id");