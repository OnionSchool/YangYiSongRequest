ALTER TABLE "AdminUser" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "AdminUser" SET "role" = 'PLANNER' WHERE "role" = 'REVIEWER';

CREATE TABLE IF NOT EXISTS "AdminSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "csrfToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "lastSeenAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "revokedAt" INTEGER
);
CREATE INDEX IF NOT EXISTS "AdminSession_userId" ON "AdminSession"("userId");

CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "username" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "failedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "LoginAttempt_username_failedAt" ON "LoginAttempt"("username", "failedAt");
CREATE INDEX IF NOT EXISTS "LoginAttempt_ip_failedAt" ON "LoginAttempt"("ip", "failedAt");
