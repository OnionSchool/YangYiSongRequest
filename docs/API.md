# API 接口契约

前缀为 `/api`。错误响应为 `{ error: { code, message, detail? } }`。公开接口不返回音源直链、平台标识、点歌人或内部播放状态。

## 公开接口

| 方法 | 路径                                      | 说明                                                     |
| ---- | ----------------------------------------- | -------------------------------------------------------- |
| GET  | `/api/site`                               | 站点开关、公告、年级配置与可用时段                       |
| GET  | `/api/search/song?source=&keyword=&page=` | 搜索歌曲                                                 |
| POST | `/api/content/check`                      | 内容预检，仅返回 `{ allowed }`                           |
| POST | `/api/request/challenge`                  | 获取绑定提交摘要的 PoW 挑战                              |
| POST | `/api/request`                            | 提交点歌，必须附带 `challengeId`、`nonce`、`contextHash` |
| GET  | `/api/requests/lookup?code=`              | 按查询码查看本人点歌状态                                 |
| GET  | `/api/playlist/recent`                    | 最近已排期歌单                                           |
| GET  | `/api/playlist/date/:date`                | 指定日期公开歌单                                         |

PoW 挑战有效期 5 分钟，绑定客户端 IP 与提交摘要，仅可使用一次。每 IP 每小时最多提交 5 次；验证连续失败会进入 15 分钟冷却。

## 管理接口

管理接口使用 `admin_token` HttpOnly Cookie。除登录外的非安全方法还必须满足同源 Origin 校验，并带 `x-csrf-token`。

| 角色         | 能力                                                   |
| ------------ | ------------------------------------------------------ |
| `SUPER`      | 全部管理能力、账号、配置、告警、播放状态修正           |
| `PLANNER`    | 审核、排期、撤排、调序，读取点歌人信息                 |
| `TECHNICIAN` | 技术工作台、受控下载、更新播放状态；不可读取点歌人信息 |

主要路由：

| 方法      | 路径                                 | 权限                   |
| --------- | ------------------------------------ | ---------------------- |
| POST      | `/api/admin/login`                   | 公开                   |
| POST      | `/api/admin/logout`                  | 登录                   |
| GET       | `/api/admin/me`                      | 登录                   |
| GET       | `/api/admin/requests`                | `SUPER`、`PLANNER`     |
| POST      | `/api/admin/requests/:id/schedule`   | `SUPER`、`PLANNER`     |
| POST      | `/api/admin/requests/:id/unschedule` | `SUPER`、`PLANNER`     |
| PUT       | `/api/admin/requests/:id/playback`   | `SUPER`、`TECHNICIAN`  |
| GET       | `/api/admin/schedule/:date`          | 登录，按角色最小化返回 |
| POST      | `/api/admin/schedule/reorder`        | `SUPER`、`PLANNER`     |
| GET       | `/api/admin/download/song/:id`       | `SUPER`、`TECHNICIAN`  |
| GET       | `/api/admin/download/day/:date`      | `SUPER`、`TECHNICIAN`  |
| GET       | `/api/admin/alerts`                  | `SUPER`                |
| GET / PUT | `/api/admin/config/*`                | `SUPER`                |

排期写操作必须携带 `expectedVersion`。版本不匹配返回 `409`，客户端应重新读取当天节目单。
