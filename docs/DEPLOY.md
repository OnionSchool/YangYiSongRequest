# 部署与运维

应用是一个 Nuxt/Nitro Node.js 进程，默认 SQLite 数据库为 `data/server.sqlite`。当前不支持 PostgreSQL 或独立旧服务端部署。

## 首次部署

```bash
npm ci
cp .env.example .env
chmod 600 .env
npm run build
NODE_ENV=production node .output/server/index.mjs
```

生产 `.env` 至少应包含：

```dotenv
NODE_ENV=production
PORT=3000
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=请替换为至少12位随机密码
```

启动时在 `BEGIN EXCLUSIVE` 事务中执行 `server/migrations/` 的版本化 SQL。升级前先停止服务并备份数据库，升级后重新构建和启动即可执行迁移。

## 反向代理

必须使用 HTTPS。若 Nginx 与应用在同一主机，在 `.env` 设置 `TRUSTED_PROXY_IPS=127.0.0.1,::1`，再传递客户端地址：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

不要在未设置可信代理 IP 时信任 `X-Forwarded-For`。Cookie 在生产环境要求 HTTPS。

## 音频下载

下载默认关闭。仅当同时配置可信 HTTPS 主机和对应音源 URL 模板时启用：

```dotenv
MUSIC_DOWNLOAD_TRUSTED_HOSTS=music.example.edu
MUSIC_DOWNLOAD_URL_NETEASE=https://music.example.edu/audio/{id}
MUSIC_DOWNLOAD_MAX_BYTES=31457280
```

缓存文件位于 `data/audio-cache/`。仅向已排期歌曲、已登录技术员或超管提供下载。

## 备份

停服后复制 `data/server.sqlite` 最简单可靠。在线备份使用 SQLite：

```bash
sqlite3 data/server.sqlite ".backup '/var/backups/yysong-$(date +%F).sqlite'"
```

同时备份 `.env` 的安全副本，权限仅限部署账户。音频缓存可以丢弃，数据库和迁移才是恢复的必要数据。
