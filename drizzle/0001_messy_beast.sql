ALTER TABLE "settlements" ADD COLUMN "stripe_balance_transaction_id" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "gross_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "stripe_fee_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "platform_fee_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "seller_transfer_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "net_amount_cents" integer;