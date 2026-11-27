# lx 音源转换包

对 [pdone/lx-music-source](https://github.com/pdone/lx-music-source) 仓库 19 个音源脚本的
系统性分析与实测转换结果（2026-11）。所有端点均经真实网络探测验证。

## 导入方法

后台 → 音源管理 → 新增音源 → 类型选「URL 模板」，按对应 JSON 文件逐项填写：

1. `platforms`、`capabilities` 勾选对应项
2. `searchUrlTemplate` / `audioUrlTemplate` 粘贴进搜索/音频地址模板
3. `fieldMap` 对象**去掉 `_comment`/`notes` 后**整体粘贴进字段映射框
4. 保存前点「测试」验证连通性

模板占位符：`${keyword}` `${id}` `${page}`（一基页码）`${page0}`（零基页码，酷我 `pn=`）`${offset}`（条目偏移，网易云 `offset=`）`${md5hex(…)}`（仅拼接求值，非 eval）。模板含 `${page0}`/`${offset}` 时视为服务端分页，内核跳过本地切片。

## 可用配置

| 文件           | 平台    | 能力        | 实测结果                                                                                                        |
| -------------- | ------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `kuwo.json`    | kuwo    | search+下载 | ✅ 搜索正常返回专辑/时长；音频 302 跳 CDN 为完整文件                                                            |
| `netease.json` | netease | search+下载 | ✅ 官方搜索 20/20 带毫秒级时长/专辑；音频 302 跳网易 CDN；id 与 meting 互通可富化元数据                         |
| `kugou.json`   | kugou   | search+下载 | ✅ **全链路官方接口**：搜索字段完整；播放用静态签名 `md5(hex+salt)` 模板，CDN 实测 200 audio/mpeg（仅免费曲目） |
| `migu.json`    | migu    | search      | ✅ 官方搜索字段完整（含封面直链）；播放无解（官方路由全灭，见下）                                               |
| `qq.json`      | qq      | search      | ✅ 官方搜索含专辑/时长；播放走 meting（vkey 签名无法用纯模板表达）                                              |

## 平台覆盖矩阵（含 meting）

| 平台    | 搜索                  | 播放                  | 说明                                       |
| ------- | --------------------- | --------------------- | ------------------------------------------ |
| netease | meting / netease.json | meting / netease.json | 双通道互为备份                             |
| qq      | meting / qq.json      | meting                | qq.json 提供专辑/时长更全的元数据          |
| kuwo    | kuwo.json             | kuwo.json             | meting 协议不支持 kuwo，模板补齐           |
| kugou   | meting / kugou.json   | meting / kugou.json   | kugou.json 播放仅免费曲目；付费曲走 meting |
| migu    | migu.json             | ❌ 跨平台兜底         | 咪咕官方播放路由实测全部失效               |
| qishui  | ❌ 不支持             | ❌ 不支持             | 汽水签名算法闭源且频繁变更，无解           |

## 逐脚本分析报告

| 脚本        | 状态        | 说明                                                                                                                                |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| changqing   | ❌ 混淆     | 无法静态分析                                                                                                                        |
| feichangdao | ✅ 已转换   | 端点合并进 kuwo/netease 配置（haitangw/nxinxz 家族）                                                                                |
| fish        | ⚠️ 部分混淆 | 字符串数组混淆，未提取出可用端点                                                                                                    |
| flower      | ❌ 混淆     | 无法静态分析                                                                                                                        |
| grass       | ❌ 混淆     | 无法静态分析                                                                                                                        |
| helloworld  | ⚠️ 部分可用 | 音频端点已入 kuwo/netease；其主力端点是 POST+JSON body 形态，模板内核仅支持 GET，不可用                                             |
| huanyin     | ⚠️ 已失效   | 提取出模板但 xcvts.cn 实测 502、sayqz.com 连接失败                                                                                  |
| huibq       | ⚠️ 需自建   | 指向 lxmusicapi.onrender.com 演示实例，官方建议自部署；self-hosted 可手工把 `https://<host>/url/{platform}/${id}/320k` 填入音频模板 |
| hyw         | ⚠️ 部分可用 | 依赖裸 IP（103.79.184.97）服务，netease 音质参数已修正后可用，已列为 netease.json 备选                                              |
| ikun        | ❌ 已失效   | api.ikunshare.com 仅裸域名，端点路径加密拼接，无法还原                                                                              |
| jiexiang    | ⚠️ 部分可用 | 端点多为裸 IP（175.27.166.236）且实测 404/401，仅备查                                                                               |
| juhe        | ❌ 不可用   | api.music.lerd.dpdns.org 实测 429，且协议为「服务端中转+客户端二次请求」，模板无法表达                                              |
| qdy         | ✅ 已转换   | 与 feichangdao 同源（haitangw/nxinxz），已合并                                                                                      |
| qingliang   | ❌ 混淆     | 无法静态分析                                                                                                                        |
| sixyin      | ❌ 混淆     | `_0x` 变量名混淆法（javascript-obfuscator），19 脚本中体积最大（332KB）                                                             |
| suyin       | ⚠️ 已失效   | 主力走 oiapi.net（QQ 已下线）与 xcvts.cn（502）                                                                                     |
| xinghai     | ⚠️ 需动态   | 端点域名运行时从远程配置拉取（zddyr.top），静态模板无法表达                                                                         |
| xinglan     | ❌ 混淆     | 无法静态分析                                                                                                                        |
| yuningxi    | ❌ 混淆     | `_0x` 变量名混淆法（119KB）                                                                                                         |

## 重要限制

- **酷我字段映射陷阱**（实测踩坑）：`artist` 必须映射 `ARTIST`（中文艺名），不是 `AARTIST`（英文艺名且多数条目为空）——填错会导致大面积歌手空白；搜索 URL 不要加 `vipver` 参数，实测反而降低专辑覆盖率
- **VIP 曲目**：lx 脚本靠用户 Cookie 获取 VIP 内容，纯模板做不到；免费曲目不受影响
- **试听片段**：部分端点对 VIP 歌返回 5~30 秒试听（如酷我官方 nmobi 接口），表现为 duration 字段极小；转换配置已避开这类端点
- **POST 端点**：模板内核仅支持 GET。helloworld/huibq 的 POST+JSON body 端点（如 `musicserver.haitangw.cc/v1/music/resolve-url`）无法表达
- **稳定性**：聚合端点（gdstudio、haitangw）为第三方公益服务，无 SLA；失效时后台健康检查会变红，按「测试」按钮排查
- **嵌入密钥**：部分端点 URL 内含脚本作者共享的 key（如 ip97 的 `6C1F-...`），属他人凭证，随时可能被收回

## 平台覆盖现状

| 平台    | 转换结果  | 说明                                                          |
| ------- | --------- | ------------------------------------------------------------- |
| kuwo    | ✅ 全链路 | 搜索+音频均验证                                               |
| netease | ✅ 全链路 | 搜索+音频均验证                                               |
| qq      | ❌ 未覆盖 | meting/官方搜索已可用，lx 端点实测全灭（oiapi 下线、ip 超时） |
| kugou   | ❌ 未覆盖 | 需 hash 型 id，可用搜索端点均未实测成功                       |
| migu    | ❌ 未覆盖 | xcvts 502、nxinxz 404                                         |
| qishui  | ❌ 未覆盖 | 无可读脚本提供可用端点                                        |

酷我是本项目此前完全缺失的平台（meting 协议不支持），本次转换补齐了这一缺口。
