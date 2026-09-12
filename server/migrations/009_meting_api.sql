CREATE TABLE IF NOT EXISTS "MetingApi" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "name"       TEXT NOT NULL,
  "baseUrl"    TEXT NOT NULL,
  "platforms"  TEXT NOT NULL DEFAULT '["netease","qq","kugou"]',
  "enabled"    INTEGER NOT NULL DEFAULT 1,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  INTEGER NOT NULL DEFAULT (unixepoch())
);
