CREATE TYPE "PushDeliveryStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED'
);

CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_deliveries_subscription_id_fkey"
        FOREIGN KEY ("subscription_id")
        REFERENCES "push_subscriptions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "push_deliveries_status_next_attempt_at_idx"
    ON "push_deliveries"("status", "next_attempt_at");

CREATE INDEX "push_deliveries_subscription_id_created_at_idx"
    ON "push_deliveries"("subscription_id", "created_at");