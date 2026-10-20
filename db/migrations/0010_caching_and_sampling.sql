CREATE TYPE "public"."skip_reason" AS ENUM('limit', 'sampling');--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "reused_from_id" uuid;--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "skip_reason" "skip_reason";--> statement-breakpoint
ALTER TABLE "run_items" ADD COLUMN "inferred_mentioned" boolean;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "smart_sampling" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "reused_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "sampled_out_items" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "cache_hours" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "cache_scheduled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "smart_sampling" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_reused_from_id_answers_id_fk" FOREIGN KEY ("reused_from_id") REFERENCES "public"."answers"("id") ON DELETE set null ON UPDATE no action;