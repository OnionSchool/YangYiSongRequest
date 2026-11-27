-- 通用音源 Provider：在 Meting API 之外支持「纯 URL 模板 + 字段映射」形态的音源。
-- type = 'meting' 沿用 baseUrl/server/type/id 协议；type = 'template' 使用下列模板列。
--
-- 因为模板 provider 没有 baseUrl，必须先把 009 建的 NOT NULL 放开。
-- SQLite 不支持 ALTER COLUMN，只能重建表再回灌数据（官方推荐的 12 步流程简化版）。
ALTER TABLE "MetingApi" RENAME TO "MetingApi_old";

CREATE TABLE "MetingApi" (
  "id"                TEXT PRIMARY KEY NOT NULL,
  "name"              TEXT NOT NULL,
  -- 模板 provider 没有统一 baseUrl，这里必须允许为空。
  "baseUrl"           TEXT,
  "platforms"         TEXT NOT NULL DEFAULT '["netease","qq","kugou"]',
  "enabled"           INTEGER NOT NULL DEFAULT 1,
  "sortOrder"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"         INTEGER NOT NULL DEFAULT (unixepoch()),
  "capabilities"      TEXT NOT NULL DEFAULT '["search","metadata","download"]',
  "authToken"         TEXT,
  "type"              TEXT NOT NULL DEFAULT 'meting',
  -- 模板 provider 的请求模板，使用 ${keyword} ${id} 之类的占位符。
  "searchUrlTemplate" TEXT,
  "detailUrlTemplate" TEXT,
  "audioUrlTemplate"  TEXT,
  "coverUrlTemplate"  TEXT,
  -- 响应字段映射（点号路径，如 "data.songs"、"abslist"）；为空时使用内置兼容映射。
  "fieldMap"          TEXT,
  -- 模板 provider 是否提供详情元数据。为 0 时允许客户端回传歌曲信息。
  "metadataCapable"   INTEGER NOT NULL DEFAULT 1
);

INSERT INTO "MetingApi" (
  "id", "name", "baseUrl", "platforms", "enabled", "sortOrder", "createdAt",
  "capabilities", "authToken"
)
SELECT
  "id", "name", "baseUrl", "platforms", "enabled", "sortOrder", "createdAt",
  "capabilities", "authToken"
FROM "MetingApi_old";

DROP TABLE "MetingApi_old";