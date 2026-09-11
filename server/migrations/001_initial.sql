CREATE TABLE IF NOT EXISTS "CalendarDay" (
  "date" TEXT PRIMARY KEY NOT NULL,
  "kind" TEXT NOT NULL,
  "note" TEXT
);

CREATE TABLE IF NOT EXISTS "BroadcastSlot" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL UNIQUE,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "maxCount" INTEGER,
  "maxMs" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "GradeConfig" (
  "grade" TEXT PRIMARY KEY NOT NULL,
  "classCount" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "SiteSetting" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "BannedWord" (
  "word" TEXT PRIMARY KEY NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "AdminUser" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "username" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'PLANNER',
  "mustChangePassword" INTEGER NOT NULL DEFAULT 0,
  "disabled" INTEGER NOT NULL DEFAULT 0,
  "lastLoginAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "detail" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "SongRequest" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "queryCode" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "album" TEXT,
  "durationMs" INTEGER NOT NULL,
  "coverUrl" TEXT,
  "grade" TEXT,
  "classNo" INTEGER,
  "requesterName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "rejectReason" TEXT,
  "flaggedWords" TEXT NOT NULL DEFAULT '[]',
  "isManual" INTEGER NOT NULL DEFAULT 0,
  "submitIp" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "reviewedAt" INTEGER,
  "reviewedById" TEXT
);

CREATE TABLE IF NOT EXISTS "Schedule" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "requestId" TEXT NOT NULL UNIQUE,
  "playDate" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "orderNo" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS "Schedule_playDate_slotId_orderNo"
  ON "Schedule"("playDate", "slotId", "orderNo");
