CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
ALTER TABLE "users" RENAME TO "master_userlist";--> statement-breakpoint
ALTER TABLE "master_userlist" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "alert_history" DROP CONSTRAINT "alert_history_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "alerts" DROP CONSTRAINT "alerts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "portfolios" DROP CONSTRAINT "portfolios_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "watchlist" DROP CONSTRAINT "watchlist_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "master_userlist" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_master_userlist_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."master_userlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_userlist" ADD CONSTRAINT "master_userlist_email_unique" UNIQUE("email");--> statement-breakpoint
-- Dev admin (password: "test", bcrypt cost 12). Change the password before any real deployment.
INSERT INTO "master_userlist" ("email", "password", "first_name", "last_name", "role")
VALUES ('admin@wealthpulse.com', '$2a$12$6HWw/vts5o29ZpREIxRWSekzER0bPO6tg8LBZl4aRUAiPuJgds2ay', 'Admin', 'User', 'admin')
ON CONFLICT ("email") DO NOTHING;
