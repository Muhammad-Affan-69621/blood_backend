ALTER TABLE "blood_requests"
ADD COLUMN "idempotency_key" VARCHAR(128),
ADD COLUMN "request_payload_hash" VARCHAR(64);

CREATE UNIQUE INDEX "blood_requests_requester_idempotency_key_key"
ON "blood_requests" ("requester_id", "idempotency_key");