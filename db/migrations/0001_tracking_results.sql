CREATE TYPE "public"."answer_source" AS ENUM('consumer_app', 'official_api');--> statement-breakpoint
CREATE TYPE "public"."citation_kind" AS ENUM('owned', 'competitor', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."engine" AS ENUM('chatgpt', 'gemini', 'ai_mode', 'ai_overviews', 'perplexity', 'claude', 'copilot', 'grok');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('queued', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('manual', 'scheduled');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_item_id" uuid NOT NULL,
	"text" text NOT NULL,
	"raw" jsonb,
	"model" text,
	"web_search_triggered" boolean,
	"shown" boolean,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_run_item_id_unique" UNIQUE("run_item_id")
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"position" integer,
	"kind" "citation_kind" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"competitor_id" uuid,
	"position" integer,
	"sentiment" real,
	"snippet" text
);
--> statement-breakpoint
CREATE TABLE "run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"prompt_id" uuid,
	"prompt_text" text NOT NULL,
	"engine" "engine" NOT NULL,
	"source" "answer_source" NOT NULL,
	"country" text,
	"sample_index" integer DEFAULT 0 NOT NULL,
	"status" "item_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"external_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"estimated_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"actual_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"done_items" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_run_item_id_run_items_id_fk" FOREIGN KEY ("run_item_id") REFERENCES "public"."run_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citations_answer_idx" ON "citations" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "citations_domain_idx" ON "citations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "mentions_answer_idx" ON "mentions" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "mentions_competitor_idx" ON "mentions" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "run_items_run_idx" ON "run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_items_status_idx" ON "run_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "run_items_external_idx" ON "run_items" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "runs_workspace_created_idx" ON "runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_brand_created_idx" ON "runs" USING btree ("brand_id","created_at");