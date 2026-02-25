ALTER TABLE "sellers" ADD COLUMN "total_orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "successful_orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "dispute_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "avg_delivery_time_hours" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "reputation_score" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "reputation_stars" numeric(3, 2) DEFAULT '0' NOT NULL;