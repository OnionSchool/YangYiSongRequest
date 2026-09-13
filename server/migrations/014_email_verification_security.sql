UPDATE "AuditLog"
SET "detail" = json_remove("detail", '$.password')
WHERE "action" = 'user.update' AND json_valid("detail");

DROP TABLE "EmailVerification";

CREATE TABLE "EmailVerification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "usedAt" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX "EmailVerification_userId_createdAt" ON "EmailVerification" ("userId", "createdAt");
