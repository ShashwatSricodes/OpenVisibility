ALTER TABLE "answers" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "rating_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "analysis_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "recommended" boolean;