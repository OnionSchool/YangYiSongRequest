ALTER TABLE "AdminUser" ADD COLUMN "email" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN "emailVerifiedAt" INTEGER;

CREATE TABLE IF NOT EXISTS "EmailVerification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "usedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);
