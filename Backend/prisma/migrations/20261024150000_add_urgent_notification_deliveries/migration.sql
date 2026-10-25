CREATE TYPE "UrgentNotificationDeliveryStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED'
);

CREATE TABLE "urgent_notification_deliveries" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "status" "UrgentNotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "urgent_notification_deliveries_pkey"
        PRIMARY KEY ("id"),

    CONSTRAINT "urgent_notification_deliveries_request_id_fkey"
        FOREIGN KEY ("request_id")
        REFERENCES "blood_requests"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT "urgent_notification_deliveries_donor_id_fkey"
        FOREIGN KEY ("donor_id")
        REFERENCES "users"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "urgent_notification_deliveries_request_id_donor_id_key"
    ON "urgent_notification_deliveries"("request_id", "donor_id");

CREATE INDEX "urgent_notification_deliveries_status_created_at_idx"
    ON "urgent_notification_deliveries"("status", "created_at");