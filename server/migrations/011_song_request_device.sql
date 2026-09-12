ALTER TABLE "SongRequest" ADD COLUMN "submitUserAgent" TEXT;
CREATE INDEX IF NOT EXISTS "SongRequest_createdAt_idx" ON "SongRequest" ("createdAt" DESC);
