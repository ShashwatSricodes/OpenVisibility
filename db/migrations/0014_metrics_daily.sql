CREATE TABLE "metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"day" date NOT NULL,
	"engine" "engine" NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"prompt_id" uuid,
	"competitor_id" uuid,
	"samples" integer DEFAULT 0 NOT NULL,
	"asked" integer DEFAULT 0 NOT NULL,
	"mentioned" integer DEFAULT 0 NOT NULL,
	"mentions" integer DEFAULT 0 NOT NULL,
	"positioned" integer DEFAULT 0 NOT NULL,
	"position_sum" integer DEFAULT 0 NOT NULL,
	"reciprocal_sum" real DEFAULT 0 NOT NULL,
	"all_mentions" integer DEFAULT 0 NOT NULL,
	"citations" integer DEFAULT 0 NOT NULL,
	"all_citations" integer DEFAULT 0 NOT NULL,
	"rated" integer DEFAULT 0 NOT NULL,
	"sentiment_sum" real DEFAULT 0 NOT NULL,
	"positive" integer DEFAULT 0 NOT NULL,
	"negative" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "rolled_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metrics_daily_workspace_day_idx" ON "metrics_daily" USING btree ("workspace_id","day");