# AGENTS.md — YangYiSongRequest

杨村一中校园广播电视台在线点歌系统。当前为单一 Nuxt 4 应用：前端在 `app/`，Nitro API 在 `server/api/`，SQLite/Drizzle 代码在 `server/utils/`。

## 常用命令

- `npm install`：安装依赖并运行 `nuxt prepare`。
- `npm run dev`：启动 Nuxt 开发服务器。
- `npm run build`：构建生产版本到 `.output/`。
- `npm run preview`：预览构建产物。
- `npm run lint`：检查 `app/`、`server/` 和项目配置。
- `npm run lint:fix`：自动修复可修复的 lint 问题。
- `npm run format`：用 Prettier 格式化项目文件。

## 项目结构

- `app/pages/`：文件路由；`app/pages/admin/` 为管理后台。
- `app/components/`、`app/layouts/`、`app/stores/`、`app/lib/`：前端组件、布局、Pinia 状态和接口封装。
- `server/api/`：Nitro API 路由；管理员接口位于 `server/api/admin/`。
- `server/utils/`：数据库、鉴权、请求、音源、日期等领域逻辑。
- `data/server.sqlite`：本地 SQLite 数据库，运行时自动创建表和基础配置。
- `legacy-server/`：迁移保留的旧服务端实现，不参与当前构建或 lint；除非明确要求，不要修改或删除。
- `.output/`、`.nuxt/`：构建生成文件，不要手动编辑。

## 开发约定

**遵循以下开发文档：**

- [TypeScript 编码规范](https://docs.worldexecute.me/development/ts-style/)
- [Markdown 格式规范](https://docs.worldexecute.me/development/markdown/)
- [Git 提交规范](https://docs.worldexecute.me/development/git/)

- 使用 ESM 和 TypeScript 严格模式；路径别名 `@` 指向 `app/`。
- 页面和组件优先使用 Vue Composition API 的 `<script setup lang="ts">`。
- 前台请求通过 `app/lib/api.ts`；管理端请求通过 `app/lib/adminApi.ts`，不要重新引入旧的 API composable。
- 服务端数据库操作复用 `server/utils/db.ts` 导出的 Drizzle 实例和 `server/utils/schema.ts`。
- API 输入必须校验，外部 URL 代理必须限制协议和可信域名。
- 前端日期默认按浏览器本地日期生成；服务端播出日逻辑使用 `server/utils/time.ts` 的上海时区工具。
- `DEBUG_MODE=true` 时后台可切换超级管理员与审核员身份；不要让调试逻辑影响生产鉴权。

## 验证与 lint

- 修改前端或 API 后至少运行 `npm run build`。
- 提交前运行 `npm run lint`。ESLint 忽略 `.nuxt/`、`.output/` 和 `legacy-server/`，这些目录的诊断不属于当前应用代码。
- 当前数据库与上游接口边界存在显式 `any`；不要仅为消除 lint 而改动运行时契约。新增代码应优先使用明确类型或 `unknown`。

## Git

- 工作区可能包含并行迁移产生的改动；不要回退、覆盖或格式化无关文件。
- 不要提交构建产物、数据库文件或环境变量。
- 所有提交必须 GPG 签名：`git commit -S`。
