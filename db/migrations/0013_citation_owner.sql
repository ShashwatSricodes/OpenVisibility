ALTER TABLE "citations" ADD COLUMN "competitor_id" uuid;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- analyze every answer again once: cleans up cited URLs and labels whose pages they are
UPDATE "answers" SET "analyzed_at" = NULL;