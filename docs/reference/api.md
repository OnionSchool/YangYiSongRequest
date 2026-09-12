# API 响应与接口

所有普通 JSON API 使用 `/api` 前缀，并采用一致的信封格式。

## 响应格式

成功：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

失败：

```json
{
  "code": "BAD_REQUEST",
  "message": "请求参数不正确",
  "data": null
}
```

失败响应仍保留匹配语义的 HTTP 状态码，例如认证失败为 `401`、无权限为 `403`、请求冲突为 `409`、限流为 `429`。前端接口客户端会自动解包成功响应中的 `data`，并将失败转换为 `ApiError`。

::: info 二进制接口
音频流、封面代理和管理端下载接口直接返回媒体或文件流，不使用 JSON 信封。
:::

## 公开接口

| 方法 | 路径                                      | 用途                               |
| ---- | ----------------------------------------- | ---------------------------------- |
| GET  | `/api/site`                               | 读取站点开关、公告、年级与可用时段 |
| GET  | `/api/search/song?source=&keyword=&page=` | 搜索歌曲                           |
| POST | `/api/content/check`                      | 内容预检                           |
| POST | `/api/request/challenge`                  | 获取一次性 PoW 挑战                |
| POST | `/api/request`                            | 提交点歌                           |
| GET  | `/api/requests/lookup?code=`              | 用查询码查看本人点歌状态           |
| GET  | `/api/playlist/recent`                    | 获取最近节目单                     |
| GET  | `/api/playlist/date/:date`                | 获取指定日期节目单                 |
| GET  | `/api/health`                             | 健康检查                           |

PoW 挑战有效期为 5 分钟，只能使用一次，且绑定客户端 IP 和提交摘要。每 IP 每小时最多提交 5 次；连续验证失败会触发 15 分钟冷却。

## 管理接口

管理接口使用 `admin_token` HttpOnly Cookie。除登录外，所有非安全方法必须携带同源 Origin 与 `x-csrf-token`。

| 方法      | 路径                                 | 权限                  |
| --------- | ------------------------------------ | --------------------- |
| POST      | `/api/admin/login`                   | 公开                  |
| POST      | `/api/admin/logout`                  | 已登录                |
| GET       | `/api/admin/me`                      | 已登录                |
| GET       | `/api/admin/requests`                | `SUPER`、`PLANNER`    |
| POST      | `/api/admin/requests/:id/schedule`   | `SUPER`、`PLANNER`    |
| POST      | `/api/admin/requests/:id/unschedule` | `SUPER`、`PLANNER`    |
| PUT       | `/api/admin/requests/:id/playback`   | `SUPER`、`TECHNICIAN` |
| POST      | `/api/admin/schedule/reorder`        | `SUPER`、`PLANNER`    |
| GET       | `/api/admin/download/song/:id`       | `SUPER`、`TECHNICIAN` |
| GET / PUT | `/api/admin/config/*`                | `SUPER`               |

排期写入必须携带 `expectedVersion`。版本不一致时接口返回 `409`，客户端应重新读取当天节目单后再操作。
