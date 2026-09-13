CREATE TABLE IF NOT EXISTS "PasswordReset" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "usedAt" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS "PasswordReset_userId_createdAt" ON "PasswordReset" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PasswordReset_ipHash_createdAt" ON "PasswordReset" ("ipHash", "createdAt");
