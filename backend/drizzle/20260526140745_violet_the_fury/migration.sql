CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"origin_version_id" uuid NOT NULL,
	"origin_user_id" uuid,
	"origin_user_email" text,
	"origin_user_display_name" text,
	"origin_photo_hash" text,
	"origin_timestamp" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'comment' NOT NULL,
	"anchor" jsonb NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"parent_comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment_projection" (
	"canonical_comment_id" uuid,
	"version_id" uuid,
	"google_comment_id" text,
	"anchor_match_confidence" integer,
	"projection_status" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_projection_pkey" PRIMARY KEY("canonical_comment_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "derivative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"overlay_id" uuid NOT NULL,
	"google_doc_id" text NOT NULL,
	"audience_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_watch_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"version_id" uuid NOT NULL,
	"channel_id" text NOT NULL UNIQUE,
	"resource_id" text NOT NULL,
	"token" text,
	"address" text NOT NULL,
	"expiration" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlay_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"overlay_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"type" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"payload" text,
	"confidence_threshold" integer
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_doc_id" text NOT NULL,
	"name" text,
	"owner_user_id" uuid NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_action_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" text NOT NULL UNIQUE,
	"review_request_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"review_request_id" uuid,
	"user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "review_assignment_pkey" PRIMARY KEY("review_request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"deadline" timestamp with time zone,
	"slack_thread_ref" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"google_doc_id" text NOT NULL,
	"name" text,
	"parent_version_id" uuid,
	"label" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"snapshot_content_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "canonical_comment_project_idx" ON "canonical_comment" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_projection_version_google_unique" ON "comment_projection" ("version_id","google_comment_id");--> statement-breakpoint
CREATE INDEX "drive_watch_version_idx" ON "drive_watch_channel" ("version_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "overlay_project_idx" ON "overlay" ("project_id");--> statement-breakpoint
CREATE INDEX "overlay_op_overlay_idx" ON "overlay_operation" ("overlay_id","order_index");--> statement-breakpoint
CREATE INDEX "project_parent_doc_idx" ON "project" ("parent_doc_id");--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "project" ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_action_token_assignment_idx" ON "review_action_token" ("review_request_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "review_assignment_user_idx" ON "review_assignment" ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "version_project_idx" ON "version" ("project_id");--> statement-breakpoint
CREATE INDEX "version_google_doc_idx" ON "version" ("google_doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_project_label_unique" ON "version" ("project_id","label");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canonical_comment" ADD CONSTRAINT "canonical_comment_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canonical_comment" ADD CONSTRAINT "canonical_comment_origin_version_id_version_id_fkey" FOREIGN KEY ("origin_version_id") REFERENCES "version"("id");--> statement-breakpoint
ALTER TABLE "canonical_comment" ADD CONSTRAINT "canonical_comment_origin_user_id_user_id_fkey" FOREIGN KEY ("origin_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "canonical_comment" ADD CONSTRAINT "canonical_comment_parent_comment_id_canonical_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "canonical_comment"("id");--> statement-breakpoint
ALTER TABLE "comment_projection" ADD CONSTRAINT "comment_projection_enYTAPgVYywj_fkey" FOREIGN KEY ("canonical_comment_id") REFERENCES "canonical_comment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_projection" ADD CONSTRAINT "comment_projection_version_id_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "derivative" ADD CONSTRAINT "derivative_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "derivative" ADD CONSTRAINT "derivative_version_id_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version"("id");--> statement-breakpoint
ALTER TABLE "derivative" ADD CONSTRAINT "derivative_overlay_id_overlay_id_fkey" FOREIGN KEY ("overlay_id") REFERENCES "overlay"("id");--> statement-breakpoint
ALTER TABLE "drive_watch_channel" ADD CONSTRAINT "drive_watch_channel_version_id_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "overlay" ADD CONSTRAINT "overlay_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "overlay_operation" ADD CONSTRAINT "overlay_operation_overlay_id_overlay_id_fkey" FOREIGN KEY ("overlay_id") REFERENCES "overlay"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_action_token" ADD CONSTRAINT "review_action_token_review_request_id_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "review_request"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_action_token" ADD CONSTRAINT "review_action_token_assignee_user_id_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_review_request_id_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "review_request"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_version_id_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version"("id");--> statement-breakpoint
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "version" ADD CONSTRAINT "version_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "version" ADD CONSTRAINT "version_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "version" ADD CONSTRAINT "version_parent_version_id_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "version"("id");