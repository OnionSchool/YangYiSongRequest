CREATE TABLE IF NOT EXISTS "ObjectStorageMonthlyUsage" (
  "period" TEXT PRIMARY KEY NOT NULL,
  "classAOperations" INTEGER NOT NULL DEFAULT 0,
  "classBOperations" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "ObjectStorageState" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "trackedBytes" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "ObjectStorageObject" (
  "objectKey" TEXT PRIMARY KEY NOT NULL,
  "sizeBytes" INTEGER NOT NULL
);
