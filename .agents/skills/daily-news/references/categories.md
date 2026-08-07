# 分区与汇总方向

## 站点分区

**站点与其默认分区不在本文档维护。** 站点注册在
[config/sites.json](../config/sites.json)，每个站点的分区、路径与 DOM 选择器
都在自己的适配器 `scripts/sites/<id>.mjs` 里（`defaultTargets` /
`optionalTargets`）。

查看当前启用的站点：

```bash
node --no-warnings .agents/skills/daily-news/scripts/daily_store.mjs sites list --enabled
```

限定扫描范围时用 `--categories`（`--tabs` 是别名）：

```bash
node .agents/skills/daily-news/scripts/scrape_site.mjs --site linuxdo \
  --mode list --categories news,develop
```

linux.do 另有 `--include-optional` 可并入可选分区。

## 汇总分类（动态生成，下表仅参考）

**summary 的分类不固定**——根据当天有价值的内容动态命名，宜 3–6 个。
下表是常见可复用方向，当天没有就省略；出现新主题（如「配债实战」「AI 安全」
「跨境网络」）就新建。`direction` 用短 kebab-case，`directionName` 用中文短语。

| 常见 id | 方向 | 典型信号词 |
| --- | --- | --- |
| `llm` | AI / LLM 工具与应用 | 模型发布、API、coding agent、跑分、降智、额度重置 |
| `dev` | 开发与自建 | 开源项目、VPS/homelab、Docker、CVE、工具自荐、Vibe Coding |
| `finance` | 投资 / 加密 / 财经 | 估值、IPO、裁员、监管、市场政策、加密行情、可转债 |
| `resources` | 数字权益与资源 | 福利羊毛、账号/号池、公益/中转站、节点、共享课程、软件下载导航 |

同一 `direction` 在同一轮里必须始终对应同一个 `directionName`。

## 条目 ID

导出的条目 ID 由 `<siteId>-<sourceId>` 生成，例如 `linuxdo-2633331`、
`v2ex-1229501`、`jisilu-523437`。不要按分类生成 A1、D1 等局部编号——
跨站合并时会冲突。

## 添加新站点

1. 写 `scripts/sites/<id>.mjs`，导出 `site` 对象与
   `listTargets` / `parseListRows` / `topicUrl` / `parseTopic` /
   `extractLinks` / `validateArticleUrl`。
2. 在 `config/sites.json` 注册（含 `label`、`badge`，财经站点加
   `requiredConclusionText`）。
3. 在 `test/fixtures/` 放一份列表行 HTML，`npm test` 会校验解析结果。

三个阶段 agent、导出与渲染都不需要改动。
