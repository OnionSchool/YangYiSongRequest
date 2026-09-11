# 项目上下文

## 架构

这是单一 Nuxt 4 应用：Vue 前端位于 `app/`，Nitro API 位于 `server/api/`，Drizzle SQLite 逻辑位于 `server/utils/`。运行时数据库为 `data/server.sqlite`，版本化迁移在 `server/migrations/`。

前端通过 `app/lib/api.ts` 请求公开接口，通过 `app/lib/adminApi.ts` 请求管理接口。后台会话保存在 SQLite 中，Cookie 只保存随机令牌，数据库只保存令牌哈希和 CSRF 令牌。

## 安全边界

- 管理角色为 `SUPER`、`PLANNER`、`TECHNICIAN`。
- 管理端所有非安全请求校验同源 Origin 和 CSRF 令牌。
- 仅当直连地址在 `TRUSTED_PROXY_IPS` 中才接受转发 IP 头。
- 下载上游只允许环境变量白名单中的 HTTPS 主机，下载文件受 MIME、大小和超时限制。
- 匿名点歌必须完成绑定请求摘要和 IP 的一次性 PoW。

## 业务模型

`SongRequest` 保存审核状态和独立播放状态；`Schedule` 表示一次排期。`WeeklyScheduleRule` 定义每周时段，`DateScheduleOverrideDay` 和 `DateScheduleOverride` 为指定日期完整覆盖。`ScheduleDay.version` 用于排期乐观锁。

## 验证

单元测试在 `tests/`，端到端测试在 `e2e/`。CI 依次执行 lint、构建、Vitest 和 Playwright。测试服务通过 `DATABASE_URL=data/e2e.sqlite` 与默认数据库隔离。
