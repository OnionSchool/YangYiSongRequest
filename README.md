# 杨村一中校园广播电视台在线点歌系统

基于 Nuxt 4、Nitro、Drizzle 和 SQLite 的单体应用。学生可匿名或实名点歌，后台提供审核排期、技术下载和播放状态管理。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

首次生产启动必须设置 `INITIAL_ADMIN_USERNAME` 与 `INITIAL_ADMIN_PASSWORD`。开发环境空库会生成一次随机初始密码并打印到服务端日志。

常用命令：

```bash
npm run lint
npm run build
npm test
npm run test:e2e
```

应用数据默认存放在 `data/server.sqlite`，迁移位于 `server/migrations/`，由服务启动时自动串行执行。不要提交数据库文件、`.env` 或音频缓存。

## 文档

- [接口契约](docs/API.md)
- [部署与备份](docs/DEPLOY.md)
- [需求与验收](docs/REQUIREMENTS.md)
- [架构上下文](docs/CONTEXT.md)
- [实施进度](docs/PROGRESS.md)
