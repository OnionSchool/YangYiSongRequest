CREATE TABLE IF NOT EXISTS "PowChallenge" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "contextHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "difficulty" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "usedAt" INTEGER,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "PowChallenge_expiresAt" ON "PowChallenge"("expiresAt");

CREATE TABLE IF NOT EXISTS "PowNonce" (
  "challengeId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "usedAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("challengeId", "nonceHash")
);

CREATE TABLE IF NOT EXISTS "RequestRateLimit" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "windowStart" INTEGER NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" INTEGER
);
