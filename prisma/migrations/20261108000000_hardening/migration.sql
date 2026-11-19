-- Outbox per branch + automatic retries of failed messages.
ALTER TABLE "MessageLog" ADD COLUMN "branchId" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "template" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "vars" JSONB;
ALTER TABLE "MessageLog" ADD COLUMN "lang" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MessageLog" ADD COLUMN "hasAttachment" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "MessageLog_branchId_createdAt_idx" ON "MessageLog"("branchId", "createdAt");
CREATE INDEX "MessageLog_status_createdAt_idx" ON "MessageLog"("status", "createdAt");
-- Existing messages: take the branch from the recipient user where known.
UPDATE "MessageLog" m SET "branchId" = u."branchId" FROM "User" u WHERE m."userId" = u."id" AND m."branchId" IS NULL;

-- A two-step verification code cannot be reused.
ALTER TABLE "User" ADD COLUMN "twoFactorLastStep" INTEGER;

-- Sign-in rate limits shared by all servers.
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
