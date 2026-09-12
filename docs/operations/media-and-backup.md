# 音源、缓存与备份

## Meting 音源

在 **后台 → 音源配置** 添加外部 Meting API。每个 API 可以配置：

- 名称与 Base URL
- 支持的平台（网易云、QQ、酷狗）
- 启用状态与优先级

搜索时系统按优先级尝试支持该平台的 API。网络错误、超时、无效业务响应或空结果会自动尝试下一个可用 API。相同平台、关键词和页码的成功搜索结果会在应用进程内缓存 10 分钟（最多 200 条），并合并同一时刻的重复搜索，避免对上游 API、音频地址解析和时长检测造成重复负担。修改、禁用或删除音源配置会立即清空该缓存。可先使用“测试 API”检查每个平台能否正常搜索。

::: warning
部分音源对 VIP 或付费歌曲不能返回可播放地址。请使用拥有合法授权的音源服务；不要将访问令牌写入公开文档或前端配置。
:::

## 音频缓存

技术员下载已排期歌曲时，服务端会获取音频并缓存。未配置对象存储时，缓存位于：

```text
data/audio-cache/
```

配置完整 S3 兼容存储后，缓存对象写入 Bucket 的 `audio-cache/` 前缀：

```dotenv
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=campus-radio-audio
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

五项配置必须同时存在；否则系统会记录告警并回退到本地缓存。已有本地缓存不会自动迁移，重新下载才会上传对象存储。试听音频属于实时代理，不会自动写入下载缓存。

## 备份与恢复

最可靠的方式是在停服后复制数据库：

```bash
cp data/server.sqlite /var/backups/yysong-$(date +%F).sqlite
```

也可以通过 SQLite 在线备份：

```bash
sqlite3 data/server.sqlite ".backup '/var/backups/yysong-$(date +%F).sqlite'"
```

恢复前停止应用，再将备份文件替换为 `data/server.sqlite`。数据库与 `.env` 的受限权限安全副本是必要数据；本地音频缓存可按需舍弃。
