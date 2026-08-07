---
name: daily-news
description: >
  用 browser-mcp 扫描注册表中已启用的论坛站点，按「列表识别 → 文章识别 → 深度解读」
  三个阶段 agent 串行处理，事实存入 SQLite，最终导出结构化 JSON 与 HTML 日报。
  Use when the user asks to 跑 daily-news、每日调研、论坛日报、linux.do 日报、
  V2EX 日报、集思录 日报，或更新 docs/daily 下的日报。
---

# daily-news

称呼操作者为 **主人**；自称 **俺**。从仓库根目录执行。

## 硬规则（先读）

读完本 skill 后，**你只做编排器**，不自己选帖、抓取或写结论。

| 允许 | 禁止 |
| --- | --- |
| 确定分析日、跑 `migrate` / `sites sync` / `run start` | 自己选帖、自己抓正文、自己写详析 |
| 依次派发三个阶段 agent，每次**阻塞等待**结果信封 | 并行跑多个阶段；跳过某个阶段 |
| 校验信封与数据库事实一致，向主人汇报 | 在阶段 agent 未返回信封时就写最终报告 |

阶段之间有严格顺序依赖：`list → article → analysis`。
上一阶段没有返回有效信封，就不要启动下一阶段。

Agent 定义（Claude Code 格式）：

- [agents/daily-news-list-agent.md](agents/daily-news-list-agent.md)
- [agents/daily-news-article-agent.md](agents/daily-news-article-agent.md)
- [agents/daily-news-analysis-agent.md](agents/daily-news-analysis-agent.md)

安装到本机 Claude agents：在仓库根执行 `make sync-agents`。

## 产物

| 阶段 | 落库 | 文件 |
| --- | --- | --- |
| 列表识别 | `list_items`、`selections` | `docs/daily/<site>/YYYYMMDD/list.json` |
| 文章识别 | `articles`、`run_articles`、`evidence` | `docs/daily/<site>/YYYYMMDD/deep.json` |
| 深度解读 | `report_items` | `docs/daily/YYYYMMDD/{summary.json,summary.html}` |

SQLite（`.data/daily-news.sqlite`）是事实源；`docs/daily/**` 是发布快照。
不要生成分方向 Markdown、持仓文件或策略文件。

## 工作流

### 1. 准备

1. 确定分析日：Asia/Shanghai `YYYYMMDD`，允许 `DATE=` 覆盖。
2. 确认 browser-mcp 扩展已连接，并设置 `BROWSER_MCP_TOKEN`。
   脚本首次运行会在技能目录安装依赖。
3. 初始化存储与注册表（约定 `S=.agents/skills/daily-news/scripts`）：

   ```bash
   node --no-warnings $S/daily_store.mjs migrate
   node --no-warnings $S/daily_store.mjs sites sync
   node --no-warnings $S/daily_store.mjs sites list --enabled
   node --no-warnings $S/daily_store.mjs run start --date YYYYMMDD
   ```

   记下返回的 `runId`，三个阶段共用它。

`node:sqlite` 会往 stderr 打印实验性警告，**机器可读 JSON 只在 stdout**。

### 2. 依次派发三个阶段

每个阶段派发**恰好一个** agent，首条消息只给事实：

```text
run_id: <runId>
date_ymd: <YYYYMMDD>
```

顺序与阻塞点：

1. 派发 `daily-news-list-agent` → **阻塞**等待 `STAGE_RESULT stage: list`。
   `selected` 为 0 时先问主人是否继续，不要硬跑下一阶段。
2. 派发 `daily-news-article-agent` → **阻塞**等待 `stage: article`。
3. 派发 `daily-news-analysis-agent` → **阻塞**等待 `stage: analysis`。

某阶段返回 `next_action: stop` 或信封与数据库不符：停下来汇报，不要自行代做。
阶段失败可用同一 `runId` 重跑该阶段——所有写入都是幂等 upsert。

### 3. 验收

```bash
node --no-warnings $S/daily_store.mjs run get --run <runId>
```

检查：

- 三个 `stage_runs` 均为 `done`。
- `summary.json` 每条都有 `source` 与主帖链接，ID 全局唯一。
- HTML 顺序为分类卡片 → 推荐列表 → 同序详析，来源徽章正确，无未替换占位符。
- `analysis` 含正文核心数字、步骤或专有名词；不只复述标题。
- `partial`/`unknown`、未独立核验项与投资边界在成品中可见。

最后向主人报告 HTML 路径、各站条数、主旋律、缺口与风险。

## 添加新站点

写一个 `scripts/sites/<id>.mjs` 适配器并在 `config/sites.json` 注册即可，
三个阶段 agent、导出与渲染都不需要改动。细节见
[references/categories.md](references/categories.md)。

## 抓取约束

browser-mcp only；`active=false`；**串行** + 礼貌延时；复用单 tab；结束关闭 tab。
最大探索深度为 2。不要全站无差别抓取，不要使用 Playwright。

## 测试

```bash
cd .agents/skills/daily-news && npm test
```
