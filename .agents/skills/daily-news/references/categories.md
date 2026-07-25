# linux.do + V2EX + 集思录 分区与兴趣方向

脚本 `scrape_linuxdo.mjs` / `scrape_v2ex.mjs` / `scrape_jisilu.mjs`
默认扫描下表。

## linux.do 默认分区（latest 前 ~30 条）

| key | 中文名 | 路径 |
| --- | --- | --- |
| `news` | 前沿快讯 | `/c/news/34` |
| `develop` | 开发调优 | `/c/develop/4` |
| `resource` | 资源荟萃 | `/c/resource/14` |
| `welfare` | 福利羊毛 | `/c/welfare/36` |
| `startup` | 扬帆起航 | `/c/startup/46` |

### linux.do 可选补充

| key | 中文名 | 路径 |
| --- | --- | --- |
| `domestic` | 国产替代 | `/c/domestic/98` |
| `cloud-asset` | 网盘资源 | `/c/resource/cloud-asset/94` |
| `gossip` | 搞七捻三 | `/c/gossip/11` |

## V2EX 默认 tabs（latest 前 ~30 条）

| key | 中文名 | 路径 |
| --- | --- | --- |
| `hot` | 最热 | `/?tab=hot` |
| `creative` | 创意 | `/?tab=creative` |
| `tech` | 技术 | `/?tab=tech` |
| `play` | 好玩 | `/?tab=play` |

> hot 是全站聚合，与 creative/tech/play 重叠大；scrape.json 保留各 tab 原始数据，筛选写 summary 时按 tid 去重。

## 集思录 默认分类（latest 前 ~30 条）

| key | 中文名 | 路径 |
| --- | --- | --- |
| `explore` | 最新 | `/explore/` |
| `bond` | 债券/可转债 | `/category/4` |
| `fund` | 基金 | `/category/7` |
| `arbitrage` | 套利 | `/category/5` |
| `stock` | 股票 | `/category/8` |

> explore 是全站最新聚合，与分类重叠大；scrape.json 保留各分类原始数据，筛选写 summary 时按 tid 去重。可选补充：新股 `/category/3`、其他 `/category/6`。

## 汇总分类（动态生成，下表仅参考）

**summary 的分类不固定**——根据当天有价值的内容动态命名，宜 3–6 个。下表是常见可复用方向，当天没有就省略，出现新主题（如「配债实战」「AI 安全」「跨境网络」）就新建；`id` 用短 kebab-case，`name` 用中文短语。

| 常见 id | 方向 | 典型信号词 |
| --- | --- | --- |
| `llm` | AI / LLM 工具与应用 | 模型发布、API、coding agent、跑分、降智、额度重置 |
| `dev` | 开发与自建 | 开源项目、VPS/homelab、Docker、CVE、工具自荐、Vibe Coding |
| `finance` | 投资 / 加密 / 财经 | 估值、IPO、裁员、监管、市场政策、加密行情、可转债 |
| `resources` | 数字权益与资源 | 福利羊毛、账号/号池、公益/中转站、节点、共享课程、软件下载导航 |

站点归类参考（仅供选帖，不约束分类命名）：V2EX 技术 tab 多工具向、好玩 tab 多生活向；集思录债券/基金/套利/股票分类多财经向、功能/数据工具类偏开发向。

## 条目 ID

使用 `<site>-<tid>`，例如 `linuxdo-2633331`、`v2ex-1229501`、
`jisilu-523437`。不要按分类生成 A1、D1 等局部编号；多个站点 agent 合并时会冲突。

## 列表 URL 形态

### linux.do（Discourse）

```
https://linux.do/c/<slug>/<id>/l/latest
https://linux.do/t/topic/<tid>
```

Discourse JSON 备选（渲染 XPath 不稳时）：

```
https://linux.do/c/<slug>/<id>/l/latest.json
https://linux.do/t/<slug>/<tid>.json
```

### V2EX

```
https://www.v2ex.com/?tab=<hot|creative|tech|play>
https://www.v2ex.com/t/<tid>
https://www.v2ex.com/go/<node>
```

V2EX 列表无 views 字段；回复数在 `a.count_livid`（0 回复帖无此元素）。

### 集思录（WeCenter）

```
https://www.jisilu.cn/explore/
https://www.jisilu.cn/category/<id>
https://www.jisilu.cn/question/<tid>
```

集思录列表行 `div.aw-item`（explore 首条广告位无 `aw-question-replay-count`，天然过滤）；回复数在 `span.aw-question-replay-count > em`；views 在 meta 文本「N 次浏览」；问题页无分页，全部楼层在同一 DOM（`aw-dynamic-topic` 内 `markitup-box`）。
