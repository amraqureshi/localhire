-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'FLAGGED';

-- AlterTable
ALTER TABLE "JobPost" ADD COLUMN IF NOT EXISTS "isFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "JobPost" ADD COLUMN IF NOT EXISTS "flagReason" TEXT;
ALTER TABLE "JobPost" ADD COLUMN IF NOT EXISTS "flaggedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobPost_isFlagged_idx" ON "JobPost"("isFlagged");
CREATE INDEX IF NOT EXISTS "User_verificationStatus_idx" ON "User"("verificationStatus");
