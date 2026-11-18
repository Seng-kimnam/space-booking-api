import { MigrationInterface, QueryRunner } from "typeorm";

export class EditUserSchema1794148063278 implements MigrationInterface {
    name = 'EditUserSchema1794148063278'

    public async up(_queryRunner: QueryRunner): Promise<void> {
        // The initial schema migration now upgrades an existing users table and
        // creates the remaining schema, so this generated duplicate is retained
        // only for migration-history compatibility.
        return;
        /*
        await queryRunner.query(`CREATE TABLE "api_clients" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "key_prefix" character varying(12) NOT NULL, "api_key_hash" character varying(255) NOT NULL, "scopes" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "last_used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "api_clients_api_key_hash_uk" UNIQUE ("api_key_hash"), CONSTRAINT "api_clients_name_uk" UNIQUE ("name"), CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."auth_provider" AS ENUM('GOOGLE', 'FACEBOOK')`);
        await queryRunner.query(`CREATE TABLE "auth_identities" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "provider" "public"."auth_provider" NOT NULL, "provider_user_id" character varying(255) NOT NULL, "provider_email" citext, "email_verified" boolean NOT NULL DEFAULT false, "display_name" character varying(100), "avatar_url" character varying(500), "linked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "auth_identities_user_provider_uk" UNIQUE ("user_id", "provider"), CONSTRAINT "auth_identities_provider_account_uk" UNIQUE ("provider", "provider_user_id"), CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "auth_identities_user_idx" ON "auth_identities"  ("user_id") `);
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_id" uuid, "user_agent" character varying(255), "ip" inet, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "refresh_tokens_token_hash_uk" UNIQUE ("token_hash"), CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens"  ("user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."place_type" AS ENUM('LIBRARY', 'CAFE', 'COWORKING', 'OTHER')`);
        await queryRunner.query(`CREATE TABLE "places" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(150) NOT NULL, "type" "public"."place_type" NOT NULL, "description" text, "address" character varying(255) NOT NULL, "lat" double precision, "lng" double precision, "timezone" character varying(64) NOT NULL DEFAULT 'Asia/Phnom_Penh', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "places_lng_chk" CHECK (lng BETWEEN -180 AND 180), CONSTRAINT "places_lat_chk" CHECK (lat BETWEEN -90 AND 90), CONSTRAINT "places_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "areas" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "place_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "floor" character varying(30), "description" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "areas_id_place_uk" UNIQUE ("id", "place_id"), CONSTRAINT "areas_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "areas_place_idx" ON "areas"  ("place_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "areas_place_name_uk" ON "areas"  ("place_id", "name") WHERE deleted_at IS NULL`);
        await queryRunner.query(`CREATE TYPE "public"."seat_status" AS ENUM('ACTIVE', 'MAINTENANCE', 'UNAVAILABLE')`);
        await queryRunner.query(`CREATE TABLE "seats" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "place_id" uuid NOT NULL, "area_id" uuid, "label" character varying(30) NOT NULL, "features" jsonb NOT NULL DEFAULT '{}'::jsonb, "status" "public"."seat_status" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "seats_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "seats_place_area_idx" ON "seats"  ("place_id", "area_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "seats_place_label_uk" ON "seats"  ("place_id", "label") WHERE deleted_at IS NULL`);
        await queryRunner.query(`CREATE TYPE "public"."booking_source" AS ENUM('APP', 'API_CLIENT', 'ADMIN')`);
        await queryRunner.query(`CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE', 'COMPLETED', 'CANCELLED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TYPE "public"."attendance_method" AS ENUM('QR', 'MANUAL')`);
        await queryRunner.query(`CREATE TABLE "bookings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "seat_id" uuid NOT NULL, "user_id" uuid NOT NULL, "client_id" uuid, "source" "public"."booking_source" NOT NULL DEFAULT 'APP', "time_range" tstzrange NOT NULL, "status" "public"."booking_status" NOT NULL DEFAULT 'PENDING', "checked_in_at" TIMESTAMP WITH TIME ZONE, "checked_in_by" uuid, "check_in_method" "public"."attendance_method", "checked_out_at" TIMESTAMP WITH TIME ZONE, "checked_out_by" uuid, "check_out_method" "public"."attendance_method", "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by" uuid, "cancel_reason" character varying(255), "expired_at" TIMESTAMP WITH TIME ZONE, "extension_count" smallint NOT NULL DEFAULT '0', "idempotency_key" character varying(100), "version" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "bookings_extension_count_chk" CHECK (extension_count >= 0), CONSTRAINT "bookings_client_consistent" CHECK ((source = 'API_CLIENT') = (client_id IS NOT NULL)), CONSTRAINT "bookings_checkout_method_chk" CHECK ((checked_out_at IS NULL) = (check_out_method IS NULL)), CONSTRAINT "bookings_checkin_method_chk" CHECK ((checked_in_at IS NULL) = (check_in_method IS NULL)), CONSTRAINT "bookings_checkout_consistent" CHECK (((status = 'COMPLETED') = (checked_out_at IS NOT NULL)) AND (checked_out_at IS NULL OR checked_out_at >= checked_in_at)), CONSTRAINT "bookings_checkin_consistent" CHECK ((status IN ('CHECKED_IN', 'CHECKOUT_OVERDUE', 'COMPLETED')) = (checked_in_at IS NOT NULL)), CONSTRAINT "bookings_expire_consistent" CHECK ((status = 'EXPIRED') = (expired_at IS NOT NULL)), CONSTRAINT "bookings_cancel_consistent" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)), CONSTRAINT "bookings_range_valid" CHECK (NOT isempty(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range) AND NOT lower_inf(time_range) AND NOT upper_inf(time_range)), CONSTRAINT "no_double_booking" EXCLUDE USING gist (seat_id WITH =, time_range WITH &&) WHERE (status IN ('PENDING', 'CHECKED_IN', 'CHECKOUT_OVERDUE')), CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "bookings_client_idx" ON "bookings"  ("client_id") WHERE client_id IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "bookings_user_idempotency_uk" ON "bookings"  ("user_id", "idempotency_key") WHERE idempotency_key IS NOT NULL`);
        await queryRunner.query(`CREATE TYPE "public"."booking_event_type" AS ENUM('CREATED', 'MODIFIED', 'EXTENDED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED', 'OVERDUE', 'OVERDUE_RESOLVED')`);
        await queryRunner.query(`CREATE TABLE "booking_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "booking_id" uuid NOT NULL, "type" "public"."booking_event_type" NOT NULL, "old_range" tstzrange, "new_range" tstzrange, "actor_user_id" uuid, "actor_client_id" uuid, "actor_system" boolean NOT NULL DEFAULT false, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "booking_events_actor_chk" CHECK (actor_system OR actor_user_id IS NOT NULL OR actor_client_id IS NOT NULL), CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "booking_events_booking_idx" ON "booking_events"  ("booking_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "public"."qr_purpose" AS ENUM('CHECK_IN', 'CHECK_OUT')`);
        await queryRunner.query(`CREATE TABLE "booking_qr_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "booking_id" uuid NOT NULL, "purpose" "public"."qr_purpose" NOT NULL, "token_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "booking_qr_tokens_token_hash_uk" UNIQUE ("token_hash"), CONSTRAINT "booking_qr_tokens_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "booking_qr_tokens_booking_idx" ON "booking_qr_tokens"  ("booking_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "booking_qr_tokens_live_uk" ON "booking_qr_tokens"  ("booking_id", "purpose") WHERE used_at IS NULL AND revoked_at IS NULL`);
        await queryRunner.query(`CREATE TABLE "inbox_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "source" character varying(100) NOT NULL, "message_id" character varying(100) NOT NULL, "event_type" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, "error" text, CONSTRAINT "inbox_events_source_message_uk" UNIQUE ("source", "message_id"), CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'TELEGRAM')`);
        await queryRunner.query(`CREATE TYPE "public"."notification_type" AS ENUM('EMAIL_VERIFY_OTP', 'PASSWORD_RESET_OTP', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'LATE_CHECKIN', 'CHECKOUT_REMINDER', 'BOOKING_EXPIRED', 'FORGOTTEN_CHECKOUT')`);
        await queryRunner.query(`CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "booking_id" uuid, "channel" "public"."notification_channel" NOT NULL, "type" "public"."notification_type" NOT NULL, "status" "public"."notification_status" NOT NULL DEFAULT 'PENDING', "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sent_at" TIMESTAMP WITH TIME ZONE, "attempts" smallint NOT NULL DEFAULT '0', "last_error" text, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "notifications_attempts_chk" CHECK (attempts >= 0), CONSTRAINT "notifications_sent_consistent" CHECK ((status = 'SENT') = (sent_at IS NOT NULL)), CONSTRAINT "notifications_channel_type_chk" CHECK ((channel = 'EMAIL') = (type IN ('EMAIL_VERIFY_OTP', 'PASSWORD_RESET_OTP'))), CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "notifications_pending_due_idx" ON "notifications"  ("scheduled_at") WHERE status = 'PENDING'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "notifications_booking_type_channel_uk" ON "notifications"  ("booking_id", "type", "channel") WHERE booking_id IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "aggregate_type" character varying(50) NOT NULL, "aggregate_id" uuid NOT NULL, "event_type" character varying(100) NOT NULL, "payload" jsonb NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" smallint NOT NULL DEFAULT '0', "last_error" text, CONSTRAINT "outbox_events_attempts_chk" CHECK (attempts >= 0), CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events"  ("occurred_at") WHERE published_at IS NULL`);
        await queryRunner.query(`CREATE TABLE "booking_policies" ("place_id" uuid NOT NULL, "checkin_grace_minutes" smallint NOT NULL DEFAULT '15', "checkout_reminder_minutes" smallint NOT NULL DEFAULT '15', "overdue_alert_minutes" smallint NOT NULL DEFAULT '15', "min_minutes" smallint NOT NULL DEFAULT '30', "max_minutes" smallint NOT NULL DEFAULT '240', "slot_minutes" smallint NOT NULL DEFAULT '15', "max_advance_days" smallint NOT NULL DEFAULT '7', "max_active_per_user" smallint NOT NULL DEFAULT '1', "max_extensions" smallint NOT NULL DEFAULT '2', "modify_cutoff_minutes" smallint NOT NULL DEFAULT '30', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "booking_policies_modify_cutoff_chk" CHECK (modify_cutoff_minutes >= 0), CONSTRAINT "booking_policies_extensions_chk" CHECK (max_extensions >= 0), CONSTRAINT "booking_policies_active_chk" CHECK (max_active_per_user >= 1), CONSTRAINT "booking_policies_advance_chk" CHECK (max_advance_days >= 0), CONSTRAINT "booking_policies_slot_chk" CHECK (slot_minutes >= 1), CONSTRAINT "booking_policies_max_chk" CHECK (max_minutes >= min_minutes), CONSTRAINT "booking_policies_min_chk" CHECK (min_minutes >= 1), CONSTRAINT "booking_policies_overdue_chk" CHECK (overdue_alert_minutes >= 0), CONSTRAINT "booking_policies_reminder_chk" CHECK (checkout_reminder_minutes >= 0), CONSTRAINT "booking_policies_grace_chk" CHECK (checkin_grace_minutes >= 0), CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("place_id"))`);
        await queryRunner.query(`CREATE TABLE "place_closures" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "place_id" uuid NOT NULL, "date" date NOT NULL, "reason" character varying(255), CONSTRAINT "place_closures_place_date_uk" UNIQUE ("place_id", "date"), CONSTRAINT "place_closures_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "place_opening_hours" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "place_id" uuid NOT NULL, "weekday" smallint NOT NULL, "open_time" TIME NOT NULL, "close_time" TIME NOT NULL, "closes_next_day" boolean NOT NULL DEFAULT false, CONSTRAINT "place_opening_hours_place_weekday_uk" UNIQUE ("place_id", "weekday"), CONSTRAINT "place_opening_hours_times_chk" CHECK (closes_next_day OR open_time < close_time), CONSTRAINT "place_opening_hours_weekday_chk" CHECK (weekday BETWEEN 0 AND 6), CONSTRAINT "place_opening_hours_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "telegram_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "chat_id" bigint NOT NULL, "username" character varying(64), "linked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "unlinked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "telegram_accounts_chat_live_uk" ON "telegram_accounts"  ("chat_id") WHERE unlinked_at IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "telegram_accounts_user_live_uk" ON "telegram_accounts"  ("user_id") WHERE unlinked_at IS NULL`);
        await queryRunner.query(`CREATE TYPE "public"."otp_purpose" AS ENUM('EMAIL_VERIFY', 'PASSWORD_RESET', 'TELEGRAM_LINK')`);
        await queryRunner.query(`CREATE TABLE "user_otps" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "purpose" "public"."otp_purpose" NOT NULL, "code_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "attempts" smallint NOT NULL DEFAULT '0', "last_sent_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "user_otps_attempts_chk" CHECK (attempts >= 0), CONSTRAINT "user_otps_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "user_otps_user_purpose_idx" ON "user_otps"  ("user_id", "purpose") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "user_otps_live_uk" ON "user_otps"  ("user_id", "purpose") WHERE used_at IS NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
        await queryRunner.query(`ALTER TYPE "public"."user_role_enum" RENAME TO "user_role_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('ADMIN', 'USER')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`);
        await queryRunner.query(`DROP TYPE "public"."user_role_enum_old"`);
        await queryRunner.query(`ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "areas" ADD CONSTRAINT "areas_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "seats" ADD CONSTRAINT "seats_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "seats" ADD CONSTRAINT "seats_area_same_place_fk" FOREIGN KEY ("area_id", "place_id") REFERENCES "areas"("id","place_id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_checked_out_by_fkey" FOREIGN KEY ("checked_out_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_client_id_fkey" FOREIGN KEY ("actor_client_id") REFERENCES "api_clients"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "booking_qr_tokens" ADD CONSTRAINT "booking_qr_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "place_closures" ADD CONSTRAINT "place_closures_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "place_opening_hours" ADD CONSTRAINT "place_opening_hours_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_otps" ADD CONSTRAINT "user_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        */
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        return;
        /*
        await queryRunner.query(`ALTER TABLE "user_otps" DROP CONSTRAINT "user_otps_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "telegram_accounts" DROP CONSTRAINT "telegram_accounts_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "place_opening_hours" DROP CONSTRAINT "place_opening_hours_place_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "place_closures" DROP CONSTRAINT "place_closures_place_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "booking_policies" DROP CONSTRAINT "booking_policies_place_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "notifications_booking_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "booking_qr_tokens" DROP CONSTRAINT "booking_qr_tokens_booking_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_actor_client_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_actor_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "booking_events" DROP CONSTRAINT "booking_events_booking_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_cancelled_by_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_checked_out_by_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_checked_in_by_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_client_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT "bookings_seat_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "seats" DROP CONSTRAINT "seats_area_same_place_fk"`);
        await queryRunner.query(`ALTER TABLE "seats" DROP CONSTRAINT "seats_place_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "areas" DROP CONSTRAINT "areas_place_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_replaced_by_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey"`);
        await queryRunner.query(`ALTER TABLE "auth_identities" DROP CONSTRAINT "auth_identities_user_id_fkey"`);
        await queryRunner.query(`CREATE TYPE "public"."user_role_enum_old" AS ENUM('ADMIN', 'USER')`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role_enum_old" USING "role"::"text"::"public"."user_role_enum_old"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."user_role_enum_old" RENAME TO "user_role_enum"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
        await queryRunner.query(`DROP INDEX "public"."user_otps_live_uk"`);
        await queryRunner.query(`DROP INDEX "public"."user_otps_user_purpose_idx"`);
        await queryRunner.query(`DROP TABLE "user_otps"`);
        await queryRunner.query(`DROP TYPE "public"."otp_purpose"`);
        await queryRunner.query(`DROP INDEX "public"."telegram_accounts_user_live_uk"`);
        await queryRunner.query(`DROP INDEX "public"."telegram_accounts_chat_live_uk"`);
        await queryRunner.query(`DROP TABLE "telegram_accounts"`);
        await queryRunner.query(`DROP TABLE "place_opening_hours"`);
        await queryRunner.query(`DROP TABLE "place_closures"`);
        await queryRunner.query(`DROP TABLE "booking_policies"`);
        await queryRunner.query(`DROP INDEX "public"."outbox_events_unpublished_idx"`);
        await queryRunner.query(`DROP TABLE "outbox_events"`);
        await queryRunner.query(`DROP INDEX "public"."notifications_booking_type_channel_uk"`);
        await queryRunner.query(`DROP INDEX "public"."notifications_pending_due_idx"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notification_status"`);
        await queryRunner.query(`DROP TYPE "public"."notification_type"`);
        await queryRunner.query(`DROP TYPE "public"."notification_channel"`);
        await queryRunner.query(`DROP TABLE "inbox_events"`);
        await queryRunner.query(`DROP INDEX "public"."booking_qr_tokens_live_uk"`);
        await queryRunner.query(`DROP INDEX "public"."booking_qr_tokens_booking_idx"`);
        await queryRunner.query(`DROP TABLE "booking_qr_tokens"`);
        await queryRunner.query(`DROP TYPE "public"."qr_purpose"`);
        await queryRunner.query(`DROP INDEX "public"."booking_events_booking_idx"`);
        await queryRunner.query(`DROP TABLE "booking_events"`);
        await queryRunner.query(`DROP TYPE "public"."booking_event_type"`);
        await queryRunner.query(`DROP INDEX "public"."bookings_user_idempotency_uk"`);
        await queryRunner.query(`DROP INDEX "public"."bookings_client_idx"`);
        await queryRunner.query(`DROP TABLE "bookings"`);
        await queryRunner.query(`DROP TYPE "public"."attendance_method"`);
        await queryRunner.query(`DROP TYPE "public"."booking_status"`);
        await queryRunner.query(`DROP TYPE "public"."booking_source"`);
        await queryRunner.query(`DROP INDEX "public"."seats_place_label_uk"`);
        await queryRunner.query(`DROP INDEX "public"."seats_place_area_idx"`);
        await queryRunner.query(`DROP TABLE "seats"`);
        await queryRunner.query(`DROP TYPE "public"."seat_status"`);
        await queryRunner.query(`DROP INDEX "public"."areas_place_name_uk"`);
        await queryRunner.query(`DROP INDEX "public"."areas_place_idx"`);
        await queryRunner.query(`DROP TABLE "areas"`);
        await queryRunner.query(`DROP TABLE "places"`);
        await queryRunner.query(`DROP TYPE "public"."place_type"`);
        await queryRunner.query(`DROP INDEX "public"."refresh_tokens_user_idx"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`DROP INDEX "public"."auth_identities_user_idx"`);
        await queryRunner.query(`DROP TABLE "auth_identities"`);
        await queryRunner.query(`DROP TYPE "public"."auth_provider"`);
        await queryRunner.query(`DROP TABLE "api_clients"`);
        */
    }

}
