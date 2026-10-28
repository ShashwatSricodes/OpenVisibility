ALTER TABLE "outreach_settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "smtp_secure" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "outreach_settings" ADD COLUMN "smtp_password" text;