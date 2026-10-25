-- CreateEnum
CREATE TYPE "DonorResponseStatus" AS ENUM ('WILLING', 'DECLINED');

-- CreateTable
CREATE TABLE "donor_responses" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "donor_id" UUID NOT NULL,
    "status" "DonorResponseStatus" NOT NULL,
    "message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "donor_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "donor_responses_donor_id_status_created_at_idx" ON "donor_responses"("donor_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "donor_responses_request_id_status_created_at_idx" ON "donor_responses"("request_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "donor_responses_request_id_donor_id_key" ON "donor_responses"("request_id", "donor_id");

-- AddForeignKey
ALTER TABLE "donor_responses" ADD CONSTRAINT "donor_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "blood_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donor_responses" ADD CONSTRAINT "donor_responses_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
