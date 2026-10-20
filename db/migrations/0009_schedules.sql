CREATE TYPE "public"."schedule_frequency" AS ENUM('off', 'daily', 'weekly');--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "schedule_frequency" "schedule_frequency" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "schedule_minute" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "schedule_weekday" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "schedule_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "schedule_next_at" timestamp with time zone;