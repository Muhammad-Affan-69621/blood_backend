-- CreateEnum
CREATE TYPE "RecipientResponseDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "donor_responses" ADD COLUMN     "recipient_decision" "RecipientResponseDecision" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "recipient_decision_at" TIMESTAMPTZ(6);
