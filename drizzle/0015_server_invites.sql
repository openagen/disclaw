CREATE TABLE "server_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"invite_token" text NOT NULL,
	"created_by_type" "channel_actor_type" NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_invites_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
