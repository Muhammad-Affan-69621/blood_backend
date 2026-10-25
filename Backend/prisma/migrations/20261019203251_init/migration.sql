-- Enable PostGIS for geographic location support.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "UserRoleType" AS ENUM ('DONOR', 'RECIPIENT', 'ORGANIZATION_ADMIN', 'MODERATOR', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('O_NEGATIVE', 'O_POSITIVE', 'A_NEGATIVE', 'A_POSITIVE', 'B_NEGATIVE', 'B_POSITIVE', 'AB_NEGATIVE', 'AB_POSITIVE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SharingMode" AS ENUM ('NEVER', 'WITH_CONSENT', 'AUTHORIZED_REQUESTS');

-- CreateEnum
CREATE TYPE "RequestUrgency" AS ENUM ('NORMAL', 'URGENT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BloodRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('PHONE', 'EMAIL', 'CONTACT_DETAILS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BLOOD_REQUEST', 'REQUEST_UPDATE', 'VERIFICATION_UPDATE', 'SYSTEM', 'SECURITY');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('MEMBER', 'VERIFIER', 'REQUEST_MANAGER', 'ORGANIZATION_ADMIN');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AbuseTargetType" AS ENUM ('USER', 'BLOOD_REQUEST', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "UserRoleType" NOT NULL,
    "organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donor_profiles" (
    "user_id" UUID NOT NULL,
    "blood_group" "BloodGroup" NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "last_donation_date" DATE,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "location_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "donor_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "contact_preferences" (
    "user_id" UUID NOT NULL,
    "sharing_mode" "SharingMode" NOT NULL DEFAULT 'WITH_CONSENT',
    "consent_version" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "region" VARCHAR(120),
    "country" VARCHAR(100) NOT NULL DEFAULT 'Pakistan',
    "geography" geography(Point, 4326),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blood_requests" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "blood_group" "BloodGroup" NOT NULL,
    "units_needed" INTEGER NOT NULL,
    "hospital_name" VARCHAR(200) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "location_id" UUID,
    "urgency" "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
    "contact_reference" VARCHAR(255),
    "status" "BloodRequestStatus" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "blood_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "changed_by" UUID,
    "old_status" "BloodRequestStatus",
    "new_status" "BloodRequestStatus" NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "request_id" UUID,
    "granted_by" UUID NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload_reference" VARCHAR(255),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "encrypted_p256dh_key" TEXT NOT NULL,
    "encrypted_auth_key" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "target_type" "AbuseTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000),
    "status" "AbuseReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_records" (
    "id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "status" "VerificationStatus" NOT NULL,
    "reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "organization_id" UUID,
    "action" VARCHAR(150) NOT NULL,
    "target_type" VARCHAR(100),
    "target_id" VARCHAR(100),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "user_roles_organization_id_role_idx" ON "user_roles"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_organization_id_key" ON "user_roles"("user_id", "role", "organization_id");

-- CreateIndex
CREATE INDEX "donor_profiles_blood_group_is_available_idx" ON "donor_profiles"("blood_group", "is_available");

-- CreateIndex
CREATE INDEX "donor_profiles_city_blood_group_idx" ON "donor_profiles"("city", "blood_group");

-- CreateIndex
CREATE INDEX "donor_profiles_verification_status_is_available_idx" ON "donor_profiles"("verification_status", "is_available");

-- CreateIndex
CREATE INDEX "locations_city_region_idx" ON "locations"("city", "region");

-- CreateIndex
CREATE INDEX "blood_requests_status_urgency_created_at_idx" ON "blood_requests"("status", "urgency", "created_at");

-- CreateIndex
CREATE INDEX "blood_requests_blood_group_status_city_idx" ON "blood_requests"("blood_group", "status", "city");

-- CreateIndex
CREATE INDEX "blood_requests_requester_id_status_idx" ON "blood_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "request_status_history_request_id_created_at_idx" ON "request_status_history"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_consents_donor_id_request_id_scope_idx" ON "contact_consents"("donor_id", "request_id", "scope");

-- CreateIndex
CREATE INDEX "contact_consents_granted_at_revoked_at_idx" ON "contact_consents"("granted_at", "revoked_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_revoked_at_idx" ON "push_subscriptions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "abuse_reports_status_created_at_idx" ON "abuse_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "abuse_reports_target_type_target_id_idx" ON "abuse_reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "verification_records_donor_id_created_at_idx" ON "verification_records"("donor_id", "created_at");

-- CreateIndex
CREATE INDEX "verification_records_status_created_at_idx" ON "verification_records"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "organization_memberships_user_id_status_idx" ON "organization_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "organization_memberships_organization_id_role_status_idx" ON "organization_memberships"("organization_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_profiles" ADD CONSTRAINT "donor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_profiles" ADD CONSTRAINT "donor_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_preferences" ADD CONSTRAINT "contact_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "blood_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donor_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "blood_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donor_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
