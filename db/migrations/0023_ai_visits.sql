CREATE TYPE "public"."visit_kind" AS ENUM('crawler', 'referral');--> statement-breakpoint
ALTER TYPE "public"."key_access" ADD VALUE 'ingest';--> statement-breakpoint
CREATE TABLE "ai_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "visit_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"agent" text NOT NULL,
	"host" text,
	"path" text NOT NULL,
	"status" integer,
	"ip" text,
	"verified" boolean,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visits" ADD CONSTRAINT "ai_visits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_visits_workspace_at_idx" ON "ai_visits" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visits_fingerprint_uq" ON "ai_visits" USING btree ("workspace_id","fingerprint");