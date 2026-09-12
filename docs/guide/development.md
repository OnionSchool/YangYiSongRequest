# 本地开发

## 前置条件

- Node.js 20 或更高版本
- npm（项目同时维护 `package-lock.json` 与 `bun.lock`）

## 启动

```bash
npm ci
cp .env.example .env
npm run dev
```

开发服务器启动后，根据终端输出访问本地地址。首次启动会自动创建数据库和基础配置。

生产环境首次启动必须设置：

```dotenv
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=请使用至少12位的随机密码
```

## 常用命令

```bash
npm run dev          # 启动 Nuxt 开发服务器
npm run lint         # ESLint 检查
npm run build        # 构建生产产物
npm test             # 运行 Vitest
npm run test:e2e     # 运行 Playwright 端到端测试

npm run docs:dev     # 启动本文档站点
npm run docs:build   # 构建静态文档
npm run docs:preview # 预览构建后的文档
```

## 开发约定

- 前台接口统一通过 `app/lib/api.ts` 访问；后台接口通过 `app/lib/adminApi.ts`。
- 前端日期按浏览器本地日期生成；服务端播出日计算使用上海时区工具。
- 新增数据库变更时，创建递增编号的 SQL 文件至 `server/migrations/`，不要修改已应用迁移。
- 不要提交 `.env`、`data/`、`.output/` 或 `.nuxt/`。
