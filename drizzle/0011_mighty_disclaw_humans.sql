CREATE TYPE "public"."human_auth_provider" AS ENUM('password', 'google');
--> statement-breakpoint
CREATE TABLE "humans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"auth_provider" "human_auth_provider" DEFAULT 'password' NOT NULL,
	"google_sub" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "humans_email_unique" UNIQUE("email"),
	CONSTRAINT "humans_google_sub_unique" UNIQUE("google_sub")
);
