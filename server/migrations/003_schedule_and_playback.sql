CREATE TABLE IF NOT EXISTS "ScheduleDay" (
  "date" TEXT PRIMARY KEY NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "WeeklyScheduleRule" (
  "weekday" INTEGER NOT NULL,
  "slotId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("weekday", "slotId")
);

CREATE TABLE IF NOT EXISTS "DateScheduleOverride" (
  "date" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("date", "slotId")
);

ALTER TABLE "SongRequest" ADD COLUMN "playbackStatus" TEXT NOT NULL DEFAULT 'PENDING_DOWNLOAD';
ALTER TABLE "SongRequest" ADD COLUMN "finalizedAt" INTEGER;

UPDATE "SongRequest"
SET "playbackStatus" = 'PLAYED', "status" = 'SCHEDULED', "finalizedAt" = COALESCE("reviewedAt", "createdAt")
WHERE "status" = 'PLAYED';

CREATE INDEX IF NOT EXISTS "SongRequest_finalizedAt" ON "SongRequest"("finalizedAt");
CREATE INDEX IF NOT EXISTS "WeeklyScheduleRule_weekday" ON "WeeklyScheduleRule"("weekday", "sortOrder");
CREATE INDEX IF NOT EXISTS "DateScheduleOverride_date" ON "DateScheduleOverride"("date", "sortOrder");
