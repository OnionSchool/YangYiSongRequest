CREATE TABLE IF NOT EXISTS "SongRequestGroup" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "source" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE ("source", "platformId")
);

ALTER TABLE "SongRequest" ADD COLUMN "groupId" TEXT;

INSERT OR IGNORE INTO "SongRequestGroup" ("id", "source", "platformId", "createdAt")
SELECT
  'grp_' || lower(hex(randomblob(8))),
  "source",
  "platformId",
  MIN("createdAt")
FROM "SongRequest"
GROUP BY "source", "platformId";

UPDATE "SongRequest"
SET "groupId" = (
  SELECT "id"
  FROM "SongRequestGroup"
  WHERE "SongRequestGroup"."source" = "SongRequest"."source"
    AND "SongRequestGroup"."platformId" = "SongRequest"."platformId"
)
WHERE "groupId" IS NULL;

CREATE INDEX IF NOT EXISTS "SongRequest_groupId" ON "SongRequest" ("groupId");
CREATE INDEX IF NOT EXISTS "SongRequest_identity_active" ON "SongRequest" ("grade", "classNo", "requesterName", "status", "playbackStatus");

INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('blockJapaneseKana', 'true');
INSERT OR IGNORE INTO "SiteSetting" ("key", "value") VALUES ('blockKoreanHangul', 'true');
