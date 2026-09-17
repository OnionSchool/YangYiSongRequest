CREATE INDEX IF NOT EXISTS "SongRequest_submitIp_createdAt" ON "SongRequest" ("submitIp", "createdAt");
CREATE INDEX IF NOT EXISTS "SongRequest_identity_createdAt" ON "SongRequest" ("grade", "classNo", "requesterName", "createdAt");
