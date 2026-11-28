-- 匿名点歌的持久设备令牌：配合 IP 做每周限额的双重计数。
-- 匿名模式下校园 NAT 会让多人共享出口 IP，单靠 IP 会误伤；
-- 单靠设备 cookie 又能被清除绕过，所以两路都要记。
ALTER TABLE "SongRequest" ADD COLUMN "submitDevice" TEXT;

CREATE INDEX IF NOT EXISTS "SongRequest_submitDevice_createdAt" ON "SongRequest" ("submitDevice", "createdAt");
