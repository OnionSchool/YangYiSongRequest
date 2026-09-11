CREATE TABLE IF NOT EXISTS "AudioCacheObject" (
  "requestId" TEXT PRIMARY KEY NOT NULL,
  "filePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "lastAccessAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "SystemAlert" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "resolvedAt" INTEGER
);

CREATE INDEX IF NOT EXISTS "SystemAlert_createdAt" ON "SystemAlert"("createdAt");
