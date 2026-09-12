# 架构与安全

## 应用结构

```text
app/                 Vue 页面、组件、状态与接口客户端
server/api/          Nitro 文件路由 API
server/utils/        数据库、鉴权、排期、音源、缓存等领域逻辑
server/migrations/   按编号顺序执行的 SQLite 迁移
data/server.sqlite   运行时数据库
```

该项目是一个 Nuxt 4 单体应用：前端和 Nitro API 由同一运行产物提供。数据库访问使用 Drizzle ORM 和 `better-sqlite3`，运行时自动应用迁移。

## 核心数据模型

- `SongRequest`：点歌申请，独立保存审核状态和播放状态。
- `Schedule`：某首歌在某日某时段的排期记录。
- `ScheduleDay.version`：节目单乐观锁版本。
- `BroadcastSlot`：可配置的播出时段及容量限制。
- `MetingApi`：外部音源地址、支持平台、优先级与启用状态。
- `AuditLog`：管理员敏感操作记录，保留约 90 天。

## 安全机制

| 边界     | 措施                                                    |
| -------- | ------------------------------------------------------- |
| 管理认证 | HttpOnly 随机会话令牌；数据库只保存哈希和 CSRF 令牌     |
| 管理写入 | 同源 Origin 校验和 CSRF 校验                            |
| 权限     | `SUPER`、`PLANNER`、`TECHNICIAN` 角色在服务端逐接口校验 |
| 公开点歌 | 请求摘要绑定的一次性 PoW、IP 和身份维度限流             |
| 代理 IP  | 只信任来自 `TRUSTED_PROXY_IPS` 的转发头                 |
| 外部 URL | 见下文                                                  |
| 邮箱     | 可选强制绑定，验证码有有效期与发送频率限制              |

外部音源和下载仅允许 `MUSIC_EXTERNAL_HOSTS` 中的主机，拒绝内网、本机与链路本地地址；下载限制大小、类型和超时。

## 时区与日期

前端交互默认使用浏览器本地日期。服务端的播出日与排期逻辑使用上海时区，因此部署服务器的系统时区不应影响节目日期计算。
