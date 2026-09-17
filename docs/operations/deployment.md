# 部署与反向代理

应用可作为 Node.js 进程运行，也可使用项目提供的 Dockerfile 构建镜像。生产环境应始终在 HTTPS 反向代理之后提供服务。

## Node.js 部署

```bash
npm ci
cp .env.example .env
chmod 600 .env
npm run build
NODE_ENV=production node .output/server/index.mjs
```

最低环境变量：

```dotenv
NODE_ENV=production
PORT=3000
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=请替换为至少12位随机密码
```

## Docker 构建

```bash
docker build -t campus-radio .
docker run -d \
  --name campus-radio \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v campus-radio-data:/app/data \
  campus-radio
```

运行镜像已包含 `ffprobe`，用于检测外部音频的时长。务必挂载 `/app/data`，否则数据库与本地缓存会随容器删除而丢失。

## Caddy 反向代理

同一台主机上可使用：

```text
radio.example.edu {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy 会传递 `X-Forwarded-For`。应用出于安全原因仅在代理来源属于 `TRUSTED_PROXY_IPS` 时才信任该请求头。若 Caddy 与应用部署在同机：

```dotenv
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

在 Docker 网络中，请填入 Caddy 容器在同一网络内的实际 IP；多个可信代理用英文逗号分隔。未配置时，日志中的地址通常是 Caddy 或 Docker 网桥地址，而不是真实访客 IP。

## Cloudflare CDN

Cloudflare 代理请求会向源站加入 `CF-Connecting-IP`。应用仅在 TCP 连接来自 `TRUSTED_PROXY_IPS` 时读取该头，因此请继续将实际连接应用的 Caddy、Nginx 或 Docker 网桥地址配置为可信代理：

```dotenv
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

若 Cloudflare 直接连接应用而中间没有本地代理，必须在防火墙或 Cloudflare Tunnel 中限制源站只接受 Cloudflare 流量，再将实际连接来源加入 `TRUSTED_PROXY_IPS`；不要无条件信任 `CF-Connecting-IP` 或 `X-Forwarded-For`，否则访客可以伪造 IP。

## 升级

1. 备份数据库。
2. 拉取新代码或新镜像。
3. 重新构建并重启应用。
4. 启动期间会在事务中自动执行新的迁移。
5. 使用 `GET /api/health` 检查服务状态。
