-- 同一歌曲可以在不同播出周期重新点播；移除歌曲维度的全局唯一约束，
-- 由应用层只复用仍在处理中的聚合组。
CREATE TABLE "SongRequestGroup_new" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "source" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO "SongRequestGroup_new" ("id", "source", "platformId", "createdAt")
SELECT "id", "source", "platformId", "createdAt"
FROM "SongRequestGroup";

DROP TABLE "SongRequestGroup";
ALTER TABLE "SongRequestGroup_new" RENAME TO "SongRequestGroup";
CREATE INDEX "SongRequestGroup_source_platform" ON "SongRequestGroup" ("source", "platformId");
